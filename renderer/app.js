'use strict';

// ─── State ─────────────────────────────────────────────────────────────────
let allProfiles = [];
let filteredProfiles = [];
let selectedProfile = null;
let activeFilter = 'all';
let isScanning = false;

// ─── DOM Refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const profileList   = $('profile-list');
const emptyState    = $('empty-state');
const profileDetail = $('profile-detail');
const detailContent = $('detail-content');
const statusText    = $('status-text');
const statusCount   = $('status-count');
const statusDot     = $('status-dot');

// ─── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Status ─────────────────────────────────────────────────────────────────
function setStatus(msg, dotClass = '') {
  statusText.textContent = msg;
  statusDot.className = 'status-dot' + (dotClass ? ' ' + dotClass : '');
}

// ─── Filter ─────────────────────────────────────────────────────────────────
function applyFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === filter);
  });
  if (filter === 'all') {
    filteredProfiles = [...allProfiles];
  } else {
    filteredProfiles = allProfiles.filter(p => p.version === filter);
  }
  renderList();
}

// ─── Render Profile List ─────────────────────────────────────────────────────
function renderList() {
  if (allProfiles.length === 0) {
    profileList.innerHTML = `<div class="no-profiles" id="list-placeholder">
      Click <strong>Scan Profiles</strong> to find<br>Razer Synapse profiles on this PC.
    </div>`;
    $('btn-backup-all').style.display = 'none';
    statusCount.textContent = '';
    return;
  }

  $('btn-backup-all').style.display = '';
  statusCount.textContent = `${filteredProfiles.length} / ${allProfiles.length} profiles`;

  if (filteredProfiles.length === 0) {
    profileList.innerHTML = `<div class="no-profiles">No profiles match this filter.</div>`;
    return;
  }

  profileList.innerHTML = '';
  for (const p of filteredProfiles) {
    const el = document.createElement('div');
    el.className = 'profile-item' + (selectedProfile && selectedProfile.path === p.path ? ' selected' : '');
    el.dataset.path = p.path;

    const iconClass = p.version === 'synapse3' ? 's3' : p.version === 'synapse4' ? 's4' : 'unknown';
    const iconLabel = p.version === 'synapse3' ? 'S3' : p.version === 'synapse4' ? 'S4' : '?';
    const dateStr = p.modified ? new Date(p.modified).toLocaleDateString() : '—';

    el.innerHTML = `
      <div class="profile-icon ${iconClass}">${iconLabel}</div>
      <div class="profile-info">
        <div class="profile-name" title="${escHtml(p.path)}">${escHtml(p.name)}</div>
        <div class="profile-meta">${escHtml(p.sizeDisplay)} &bull; ${dateStr} &bull; ${escHtml(p.ext || '')}</div>
      </div>
    `;
    el.addEventListener('click', () => selectProfile(p));
    profileList.appendChild(el);
  }
}

// ─── Select & Load Profile ───────────────────────────────────────────────────
async function selectProfile(p) {
  selectedProfile = p;
  renderList(); // update selected highlight

  emptyState.style.display = 'none';
  profileDetail.classList.add('visible');

  $('detail-filename').textContent = p.name;
  $('detail-path').textContent = p.path;
  $('detail-path').title = 'Click to open folder: ' + p.path;

  const badgeClass = p.version === 'synapse3' ? 's3' : p.version === 'synapse4' ? 's4' : 'unknown';
  const badgeLabel = p.version === 'synapse3' ? 'Synapse 3' : p.version === 'synapse4' ? 'Synapse 4' : 'Unknown';
  $('detail-version-badge').className = `version-badge ${badgeClass}`;
  $('detail-version-badge').textContent = badgeLabel;

  // Update convert buttons
  $('btn-convert-s4').disabled = p.version === 'synapse4';
  $('btn-convert-s3').disabled = p.version === 'synapse3';

  detailContent.innerHTML = `<div style="display:flex;align-items:center;gap:10px;color:var(--text-muted);">
    <div class="spinner"></div> Loading profile...
  </div>`;

  setStatus('Reading profile...', 'yellow');

  try {
    const detail = await window.synapseAPI.readProfile(p.path);
    renderDetail(p, detail);
    setStatus('Profile loaded.');
  } catch (err) {
    detailContent.innerHTML = `<div style="color:var(--red);">Error reading profile: ${escHtml(err.message)}</div>`;
    setStatus('Error reading profile.', 'red');
  }
}

// ─── Render Detail Content ───────────────────────────────────────────────────
function renderDetail(p, detail) {
  const { content, keyMappings } = detail;
  const dateStr = p.modified ? new Date(p.modified).toLocaleString() : '—';
  const formatLabel = content.format === 'json' ? 'JSON' : content.format === 'xml' ? 'XML' : content.format === 'binary' ? 'Binary' : 'Error';
  const formatColor = content.format === 'json' ? 'green' : content.format === 'xml' ? 'blue' : 'yellow';

  let html = `
    <div class="info-grid">
      <div class="info-card">
        <div class="info-card-label">Version</div>
        <div class="info-card-value ${p.version === 'synapse3' ? 'blue' : p.version === 'synapse4' ? 'green' : ''}">${escHtml(p.version)}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">Format</div>
        <div class="info-card-value ${formatColor}">${escHtml(formatLabel)}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">Size</div>
        <div class="info-card-value">${escHtml(p.sizeDisplay)}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">Modified</div>
        <div class="info-card-value" style="font-size:12px;">${escHtml(dateStr)}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">Extension</div>
        <div class="info-card-value">${escHtml(p.ext || '—')}</div>
      </div>
      <div class="info-card">
        <div class="info-card-label">Key Mappings</div>
        <div class="info-card-value ${keyMappings.length > 0 ? 'green' : ''}">${keyMappings.length > 0 ? keyMappings.length + ' found' : 'None'}</div>
      </div>
    </div>
  `;

  // Convert hint
  html += `
    <div class="convert-hint">
      <strong>Migration Notice:</strong> Synapse 3→4 migration is often broken in the official tool.
      Use <em>Convert → Synapse 4</em> to create a converted copy, or <em>Export → JSON</em> to get a readable backup first.
      <br>Binary format profiles cannot be fully auto-converted but <strong>can always be backed up</strong>.
    </div>
  `;

  // Key mappings section
  if (keyMappings.length > 0) {
    html += `
      <div class="section">
        <div class="section-header">
          Key Mappings / Bindings
          <span style="color:var(--green);font-size:12px;">${keyMappings.length} entries</span>
        </div>
        <div class="section-body">
          <div class="mapping-list">
    `;
    for (const m of keyMappings) {
      html += `
        <div class="mapping-item">
          <span class="mapping-key">${escHtml(m.field)}</span>
          <span class="mapping-val">${escHtml(m.value)}</span>
        </div>
      `;
    }
    html += `</div></div></div>`;
  }

  // Raw preview
  if (content.raw) {
    const preview = content.raw.slice(0, 800);
    html += `
      <div class="section">
        <div class="section-header">Raw Content Preview</div>
        <div class="section-body">
          <div class="raw-preview">${escHtml(preview)}${content.raw.length > 800 ? '\n... (truncated)' : ''}</div>
        </div>
      </div>
    `;
  } else if (content.format === 'binary') {
    html += `
      <div class="section">
        <div class="section-header">Binary File</div>
        <div class="section-body">
          <div style="color:var(--text-muted);font-size:13px;line-height:1.7;">
            This profile is in binary format — it cannot be displayed as text.<br>
            You can still <strong>back it up</strong> or use the official Synapse migration tool.
            The binary may include lighting effects, macro sequences, or encrypted config.
          </div>
        </div>
      </div>
    `;
  }

  // File location section
  html += `
    <div class="section">
      <div class="section-header">File Location</div>
      <div class="section-body" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <code style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);word-break:break-all;">${escHtml(p.path)}</code>
        <button class="btn btn-ghost btn-sm" onclick="openFolder()">Open Folder</button>
      </div>
    </div>
  `;

  detailContent.innerHTML = html;
}

// ─── Scan ────────────────────────────────────────────────────────────────────
async function runScan() {
  if (isScanning) return;
  isScanning = true;

  const btnScan = $('btn-scan');
  const btnHero = $('btn-scan-hero');
  btnScan.disabled = true;
  btnScan.innerHTML = '<div class="spinner"></div> Scanning...';
  if (btnHero) btnHero.disabled = true;

  setStatus('Scanning for Synapse profiles...', 'yellow');
  profileList.innerHTML = `<div class="no-profiles"><div class="spinner" style="margin:0 auto 10px;"></div>Scanning AppData folders...</div>`;

  try {
    const profiles = await window.synapseAPI.scanProfiles();
    allProfiles = profiles;
    applyFilter(activeFilter);

    if (profiles.length === 0) {
      setStatus('No Razer Synapse profiles found on this PC.');
      toast('No profiles found — is Razer Synapse installed?', 'info');
    } else {
      setStatus(`Found ${profiles.length} profile file${profiles.length !== 1 ? 's' : ''}.`);
      toast(`Found ${profiles.length} profile${profiles.length !== 1 ? 's' : ''}!`);
    }
  } catch (err) {
    setStatus('Scan failed.', 'red');
    toast('Scan error: ' + err.message, 'error');
    profileList.innerHTML = `<div class="no-profiles" style="color:var(--red);">Scan error: ${escHtml(err.message)}</div>`;
  } finally {
    isScanning = false;
    btnScan.disabled = false;
    btnScan.innerHTML = '&#x1F50D; Scan Profiles';
    if (btnHero) btnHero.disabled = false;
  }
}

// ─── Convert ─────────────────────────────────────────────────────────────────
async function convertProfile(targetVersion) {
  if (!selectedProfile) return;
  const btn = targetVersion === 'synapse4' ? $('btn-convert-s4') : $('btn-convert-s3');
  btn.disabled = true;
  setStatus('Converting...', 'yellow');
  try {
    const result = await window.synapseAPI.convertProfile({
      filePath: selectedProfile.path,
      targetVersion
    });
    if (result.success) {
      toast(`Converted! Saved to: ${result.savedTo.split('\\').pop()}`);
      setStatus('Conversion complete.');
    } else if (result.reason !== 'cancelled') {
      toast('Conversion failed: ' + result.reason, 'error');
      setStatus('Conversion failed.', 'red');
    } else {
      setStatus('Conversion cancelled.');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
    setStatus('Error.', 'red');
  } finally {
    btn.disabled = selectedProfile.version === targetVersion;
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────
async function exportProfile(format) {
  if (!selectedProfile) return;
  setStatus(`Exporting as ${format.toUpperCase()}...`, 'yellow');
  try {
    const result = await window.synapseAPI.exportProfile({
      filePath: selectedProfile.path,
      format
    });
    if (result.success) {
      toast(`Exported! ${result.savedTo.split('\\').pop()}`);
      setStatus('Export complete.');
    } else if (result.reason !== 'cancelled') {
      toast('Export failed: ' + result.reason, 'error');
      setStatus('Export failed.', 'red');
    } else {
      setStatus('Export cancelled.');
    }
  } catch (err) {
    toast('Error: ' + err.message, 'error');
    setStatus('Error.', 'red');
  }
}

// ─── Backup All ──────────────────────────────────────────────────────────────
async function backupAll() {
  if (allProfiles.length === 0) return;
  const btn = $('btn-backup-all');
  btn.disabled = true;
  setStatus('Creating backup ZIP...', 'yellow');
  try {
    const paths = allProfiles.map(p => p.path);
    const result = await window.synapseAPI.backupAll(paths);
    if (result.success) {
      toast(`Backup saved! ${result.count} files → ${result.savedTo.split('\\').pop()}`);
      setStatus(`Backup complete — ${result.count} files.`);
    } else if (result.reason !== 'cancelled') {
      toast('Backup failed: ' + result.reason, 'error');
      setStatus('Backup failed.', 'red');
    } else {
      setStatus('Backup cancelled.');
    }
  } catch (err) {
    toast('Backup error: ' + err.message, 'error');
    setStatus('Error.', 'red');
  } finally {
    btn.disabled = false;
  }
}

// ─── Import ──────────────────────────────────────────────────────────────────
async function importProfile() {
  setStatus('Opening file picker...', 'yellow');
  try {
    const result = await window.synapseAPI.importProfile();
    if (!result.success) {
      setStatus('Import cancelled.');
      return;
    }
    // Add imported profiles to the list
    const newProfiles = result.profiles.map(p => ({
      path: p.path,
      name: p.name,
      ext: p.path.split('.').pop(),
      size: p.size,
      sizeDisplay: p.size > 1024 ? (p.size / 1024).toFixed(1) + ' KB' : p.size + ' B',
      modified: new Date().toISOString(),
      version: p.version,
      dir: p.path.split('\\').slice(0, -1).join('\\')
    }));

    // Dedupe
    for (const np of newProfiles) {
      if (!allProfiles.find(ep => ep.path === np.path)) {
        allProfiles.unshift(np);
      }
    }
    applyFilter(activeFilter);
    toast(`Imported ${newProfiles.length} profile${newProfiles.length !== 1 ? 's' : ''}!`);
    setStatus(`Imported ${newProfiles.length} profile${newProfiles.length !== 1 ? 's' : ''}.`);

    // Auto-select first imported
    if (newProfiles.length > 0) selectProfile(newProfiles[0]);
  } catch (err) {
    toast('Import error: ' + err.message, 'error');
    setStatus('Import error.', 'red');
  }
}

// ─── Open Folder ─────────────────────────────────────────────────────────────
async function openFolder() {
  if (!selectedProfile) return;
  await window.synapseAPI.openInExplorer(selectedProfile.path);
}

// ─── Escape HTML ─────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Wire Up Events ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('btn-scan').addEventListener('click', runScan);
  $('btn-scan-hero').addEventListener('click', runScan);
  $('btn-import').addEventListener('click', importProfile);
  $('btn-backup-all').addEventListener('click', backupAll);

  $('btn-convert-s4').addEventListener('click', () => convertProfile('synapse4'));
  $('btn-convert-s3').addEventListener('click', () => convertProfile('synapse3'));

  $('btn-export-json').addEventListener('click', () => exportProfile('json'));
  $('btn-export-ahk').addEventListener('click', () => exportProfile('ahk'));
  $('btn-export-dock').addEventListener('click', () => exportProfile('dockstation'));

  $('btn-open-folder').addEventListener('click', openFolder);
  $('detail-path').addEventListener('click', openFolder);

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => applyFilter(chip.dataset.filter));
  });

  setStatus('Ready — click Scan to find profiles');
});
