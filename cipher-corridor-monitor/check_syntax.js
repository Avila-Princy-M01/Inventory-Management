// Simulate what the browser does: check for syntax errors in all JS files
const fs = require('fs');
const files = [
  'frontend/src/main.js',
  'frontend/src/signals.js',
  'frontend/src/drawer-detail.js',
  'frontend/src/drawer-scenario.js',
  'frontend/src/briefing.js',
  'frontend/src/masterdata.js',
  'frontend/src/audit.js',
  'frontend/src/uploader.js',
];

const { execSync } = require('child_process');

files.forEach(f => {
  try {
    execSync('node --check ' + f, { stdio: 'pipe' });
    console.log('OK  ', f);
  } catch(e) {
    console.log('ERR ', f, '-', e.stderr.toString().trim());
  }
});
