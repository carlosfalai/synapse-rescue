'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = 'nfp_MHncB8Hr3wj4T2mrbFRDoNjbcB1W9SPve0b1';
const SITE_NAME = 'synapse-rescue';
const DIR = path.join(__dirname, 'site');

function request(method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.netlify.com',
      path: urlPath,
      method,
      headers: { 'Authorization': 'Bearer ' + TOKEN, ...headers }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function findOrCreateSite() {
  // Site already created: cb2f0705-5142-476b-8176-870a444ff2dc
  return 'cb2f0705-5142-476b-8176-870a444ff2dc';
}

async function main() {
  const siteId = await findOrCreateSite();

  // Build file manifest
  const files = {};
  const hashToPath = {};
  const entries = fs.readdirSync(DIR);

  for (const f of entries) {
    const fp = path.join(DIR, f);
    if (!fs.statSync(fp).isFile()) continue;
    const hash = crypto.createHash('sha1').update(fs.readFileSync(fp)).digest('hex');
    files['/' + f] = hash;
    hashToPath[hash] = fp;
  }

  console.log('Files to deploy:', Object.keys(files).join(', '));

  // Create deploy
  const body = JSON.stringify({ files });
  const deploy = await request('POST', `/api/v1/sites/${siteId}/deploys`, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }, body);

  console.log('Deploy ID:', deploy.id);
  console.log('State:', deploy.state);
  console.log('Required uploads:', (deploy.required || []).length);

  // Upload required files
  const required = deploy.required || [];
  for (let i = 0; i < required.length; i++) {
    const hash = required[i];
    const filePath = hashToPath[hash];
    const urlKey = Object.keys(files).find(k => files[k] === hash);

    if (!filePath || !urlKey) {
      console.log('Skip unknown hash:', hash);
      continue;
    }

    const data = fs.readFileSync(filePath);
    await request('PUT', `/api/v1/deploys/${deploy.id}/files${urlKey}`, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': data.length
    }, data);

    console.log(`Uploaded ${i + 1}/${required.length}: ${urlKey}`);
  }

  console.log('\nDone! Live at: https://synapse-rescue.netlify.app');
}

main().catch(e => console.error('Fatal:', e.message));
