const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');

// Max file size to read into memory (10 MB)
const MAX_READ_SIZE = 10 * 1024 * 1024;

let mainWindow;

// ─── Profile Scan Paths ───────────────────────────────────────────────────────
const SCAN_PATHS = {
  synapse3: [
    path.join(os.homedir(), 'AppData', 'Roaming', 'Razer', 'Synapse3'),
    path.join(os.homedir(), 'AppData', 'Local', 'Razer', 'Synapse3'),
    path.join(os.homedir(), 'AppData', 'Local', 'Razer', 'Synapse3', 'Settings'),
  ],
  synapse4: [
    path.join(os.homedir(), 'AppData', 'Local', 'Razer', 'RazerAppEngine'),
    path.join(os.homedir(), 'AppData', 'Local', 'Razer', 'Synapse4'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Razer', 'Synapse4'),
  ],
  legacy: [
    path.join(os.homedir(), 'AppData', 'Roaming', 'Razer', 'Synapse'),
    path.join('C:', 'ProgramData', 'Razer', 'Synapse3'),
    path.join('C:', 'ProgramData', 'Razer', 'Synapse4'),
  ]
};

// Extensions to look for
const PROFILE_EXTENSIONS = ['.synapse3', '.synapse4', '.xml', '.json', '.cfg', '.dat', '.bin'];
const PROFILE_KEYWORDS = ['profile', 'macro', 'lighting', 'chroma', 'config', 'keybind', 'setting'];

// ─── Window Creation ──────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1117',
    title: 'SynapseRescue',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f1117',
      symbolColor: '#22C55E',
      height: 36
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Helper: Recursively find profile files ───────────────────────────────────
function scanDirectory(dirPath, results = [], depth = 0) {
  if (depth > 5) return results;
  try {
    if (!fs.existsSync(dirPath)) return results;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath, results, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const nameLower = entry.name.toLowerCase();
        const isProfileFile = PROFILE_EXTENSIONS.includes(ext) ||
          PROFILE_KEYWORDS.some(kw => nameLower.includes(kw));
        if (isProfileFile) {
          try {
            const stat = fs.statSync(fullPath);
            results.push({
              path: fullPath,
              name: entry.name,
              ext,
              size: stat.size,
              modified: stat.mtime.toISOString(),
              dir: dirPath
            });
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
  return results;
}

// ─── Helper: Detect profile version from path/extension ──────────────────────
function detectVersion(filePath) {
  const p = filePath.toLowerCase();
  if (p.includes('synapse4') || p.includes('razerappengine') || p.endsWith('.synapse4')) return 'synapse4';
  if (p.includes('synapse3') || p.endsWith('.synapse3')) return 'synapse3';
  if (p.includes('synapse\\') && !p.includes('3') && !p.includes('4')) return 'synapse2';
  return 'unknown';
}

// ─── Helper: Try to read profile content ─────────────────────────────────────
function readProfileContent(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_READ_SIZE) {
      return { format: 'binary', data: null, raw: null, size: stat.size };
    }
    const buf = fs.readFileSync(filePath);
    // Try JSON
    try {
      const json = JSON.parse(buf.toString('utf8'));
      return { format: 'json', data: json, raw: buf.toString('utf8') };
    } catch (_) {}
    // Try XML detection
    const str = buf.toString('utf8', 0, Math.min(200, buf.length));
    if (str.trimStart().startsWith('<')) {
      return { format: 'xml', data: null, raw: buf.toString('utf8') };
    }
    // Binary
    return { format: 'binary', data: null, raw: null, size: buf.length };
  } catch (err) {
    return { format: 'error', error: err.message };
  }
}

// ─── Helper: Extract key mappings from JSON profile ──────────────────────────
function extractKeyMappings(data) {
  const mappings = [];
  function walk(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8) return;
    for (const [key, val] of Object.entries(obj)) {
      const kl = key.toLowerCase();
      if (kl.includes('key') || kl.includes('bind') || kl.includes('map') || kl.includes('macro')) {
        if (val && typeof val === 'object') {
          mappings.push({ field: key, value: JSON.stringify(val).slice(0, 120) });
        } else if (val !== null && val !== undefined) {
          mappings.push({ field: key, value: String(val).slice(0, 120) });
        }
      }
      if (Array.isArray(val)) {
        val.slice(0, 20).forEach(item => walk(item, depth + 1));
      } else if (val && typeof val === 'object') {
        walk(val, depth + 1);
      }
    }
  }
  walk(data);
  return mappings.slice(0, 50);
}

// ─── Helper: Convert profile Synapse3 → 4 ────────────────────────────────────
function convertProfile(sourceData, fromVersion, toVersion) {
  // We create a wrapper with metadata about the conversion
  const converted = {
    _synapseRescue: true,
    _convertedFrom: fromVersion,
    _convertedTo: toVersion,
    _convertedAt: new Date().toISOString(),
    _note: `Converted by SynapseRescue. Some features may need manual adjustment in ${toVersion}.`,
    originalData: sourceData
  };

  // If JSON source, try to remap known fields
  if (sourceData && sourceData.format === 'json' && sourceData.data) {
    const orig = sourceData.data;
    if (toVersion === 'synapse4') {
      converted.profiles = orig.profiles || orig.Profiles || [orig];
      converted.deviceName = orig.deviceName || orig.DeviceName || orig.device || 'Unknown Device';
      converted.version = '4.0.0';
    } else {
      converted.profiles = orig.profiles || [orig];
      converted.version = '3.0.0';
    }
  }

  return converted;
}

// ─── Helper: Generate AutoHotkey script ──────────────────────────────────────
function generateAHK(profileData, profileName) {
  // Strip newlines/carriage returns to prevent AHK directive injection
  const safeName = String(profileName).replace(/[\r\n]/g, ' ');
  const lines = [
    `; AutoHotkey script generated by SynapseRescue`,
    `; Profile: ${safeName}`,
    `; Generated: ${new Date().toISOString()}`,
    `; NOTE: Manual adjustment required for complex macros`,
    ``,
    `#NoEnv`,
    `#SingleInstance Force`,
    `SetWorkingDir %A_ScriptDir%`,
    ``,
    `;--- Key Remaps (edit as needed) ---`,
    ``
  ];

  if (profileData.format === 'json' && profileData.data) {
    const mappings = extractKeyMappings(profileData.data);
    if (mappings.length > 0) {
      for (const m of mappings.slice(0, 20)) {
        lines.push(`; ${m.field}: ${m.value}`);
      }
    } else {
      lines.push(`; No key mappings detected in this profile format`);
      lines.push(`; Profile data is in JSON format — check the JSON export for details`);
    }
  } else {
    lines.push(`; Profile format: ${profileData.format}`);
    lines.push(`; Binary/XML profiles cannot be auto-converted to AHK`);
    lines.push(`; Use the JSON export and edit this file manually`);
  }

  lines.push(``);
  lines.push(`; Example remaps (uncomment and customize):`);
  lines.push(`; CapsLock::Ctrl`);
  lines.push(`; F13::Run, notepad.exe`);
  lines.push(`; !+s::Send, {Text}Your signature here`);
  return lines.join('\n');
}

// ─── Helper: Generate DockStation format ─────────────────────────────────────
function generateDockStationFormat(profileData, profileName) {
  return {
    _source: 'SynapseRescue',
    _format: 'dockstation-import',
    _version: '1.0',
    _createdAt: new Date().toISOString(),
    profileName,
    buttons: [],
    keyMappings: profileData.format === 'json' ? extractKeyMappings(profileData.data) : [],
    raw: profileData.raw ? profileData.raw.slice(0, 5000) : null
  };
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('scan-profiles', async () => {
  const allFiles = [];
  const allPaths = [
    ...SCAN_PATHS.synapse3,
    ...SCAN_PATHS.synapse4,
    ...SCAN_PATHS.legacy
  ];
  for (const scanPath of allPaths) {
    scanDirectory(scanPath, allFiles);
  }

  // Dedupe by path
  const seen = new Set();
  const unique = allFiles.filter(f => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });

  return unique.map(f => ({
    ...f,
    version: detectVersion(f.path),
    sizeDisplay: f.size > 1024 * 1024
      ? (f.size / 1024 / 1024).toFixed(1) + ' MB'
      : f.size > 1024
        ? (f.size / 1024).toFixed(1) + ' KB'
        : f.size + ' B'
  }));
});

ipcMain.handle('read-profile', async (event, filePath) => {
  const content = readProfileContent(filePath);
  const version = detectVersion(filePath);
  let keyMappings = [];
  if (content.format === 'json' && content.data) {
    keyMappings = extractKeyMappings(content.data);
  }
  return { content, version, keyMappings, path: filePath, name: path.basename(filePath) };
});

ipcMain.handle('convert-profile', async (event, { filePath, targetVersion }) => {
  const content = readProfileContent(filePath);
  const fromVersion = detectVersion(filePath);
  const converted = convertProfile(content, fromVersion, targetVersion);

  const { canceled, filePath: savePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Converted Profile',
    defaultPath: path.join(os.homedir(), 'Desktop',
      `${path.basename(filePath, path.extname(filePath))}_converted.${targetVersion}`),
    filters: [{ name: 'Synapse Profile', extensions: [targetVersion.replace('synapse', 'synapse')] }]
  });

  if (canceled || !savePath) return { success: false, reason: 'cancelled' };

  fs.writeFileSync(savePath, JSON.stringify(converted, null, 2), 'utf8');
  return { success: true, savedTo: savePath };
});

ipcMain.handle('export-profile', async (event, { filePath, format }) => {
  const content = readProfileContent(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  let defaultExt, filterName, fileData;

  if (format === 'json') {
    defaultExt = 'json';
    filterName = 'JSON Export';
    fileData = JSON.stringify({ _source: 'SynapseRescue', originalPath: filePath, content }, null, 2);
  } else if (format === 'ahk') {
    defaultExt = 'ahk';
    filterName = 'AutoHotkey Script';
    fileData = generateAHK(content, baseName);
  } else if (format === 'dockstation') {
    defaultExt = 'json';
    filterName = 'DockStation Import';
    fileData = JSON.stringify(generateDockStationFormat(content, baseName), null, 2);
  } else {
    return { success: false, reason: 'unknown format' };
  }

  const { canceled, filePath: savePath } = await dialog.showSaveDialog(mainWindow, {
    title: `Export as ${format.toUpperCase()}`,
    defaultPath: path.join(os.homedir(), 'Desktop', `${baseName}.${defaultExt}`),
    filters: [{ name: filterName, extensions: [defaultExt] }]
  });

  if (canceled || !savePath) return { success: false, reason: 'cancelled' };
  fs.writeFileSync(savePath, fileData, 'utf8');
  return { success: true, savedTo: savePath };
});

// Allowed root dirs for backup path validation
const ALLOWED_BACKUP_ROOTS = [
  path.join(os.homedir(), 'AppData'),
  path.join('C:', 'ProgramData', 'Razer'),
];

function isAllowedBackupPath(filePath) {
  const normalized = path.normalize(filePath);
  return ALLOWED_BACKUP_ROOTS.some(root => normalized.startsWith(root));
}

ipcMain.handle('backup-all', async (event, profilePaths) => {
  if (!Array.isArray(profilePaths)) return { success: false, reason: 'invalid input' };

  const { canceled, filePath: savePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Profile Backup',
    defaultPath: path.join(os.homedir(), 'Desktop',
      `SynapseRescue_Backup_${new Date().toISOString().slice(0, 10)}.zip`),
    filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
  });

  if (canceled || !savePath) return { success: false, reason: 'cancelled' };

  try {
    const output = fs.createWriteStream(savePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      for (const p of profilePaths) {
        if (!isAllowedBackupPath(p)) continue;
        if (fs.existsSync(p)) {
          // Preserve relative structure from AppData
          const rel = p.replace(os.homedir(), '').replace(/\\/g, '/').replace(/^\//, '');
          archive.file(p, { name: rel });
        }
      }
      archive.finalize();
    });

    return { success: true, savedTo: savePath, count: profilePaths.length };
  } catch (err) {
    return { success: false, reason: err.message };
  }
});

ipcMain.handle('import-profile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Profile',
    filters: [
      { name: 'Synapse Profiles', extensions: ['synapse3', 'synapse4', 'json'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile', 'multiSelections']
  });

  if (canceled || !filePaths.length) return { success: false, reason: 'cancelled' };

  const imported = filePaths.map(p => {
    const content = readProfileContent(p);
    let size = 0;
    try { size = fs.statSync(p).size; } catch (_) {}
    return {
      path: p,
      name: path.basename(p),
      version: detectVersion(p),
      content,
      size
    };
  });

  return { success: true, profiles: imported };
});

ipcMain.handle('open-in-explorer', async (event, filePath) => {
  shell.showItemInFolder(filePath);
  return { success: true };
});

ipcMain.handle('get-scan-paths', async () => {
  return SCAN_PATHS;
});

ipcMain.handle('check-razer-installed', async () => {
  const checks = [
    path.join('C:', 'Program Files (x86)', 'Razer'),
    path.join('C:', 'Program Files', 'Razer'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Razer'),
    path.join(os.homedir(), 'AppData', 'Local', 'Razer'),
  ];
  const found = {};
  for (const p of checks) {
    found[p] = fs.existsSync(p);
  }
  return found;
});
