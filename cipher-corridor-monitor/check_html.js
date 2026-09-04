const fs = require('fs');
const html = fs.readFileSync('frontend/index.html','utf8');

// nav button data-view attributes
const navMatches = [];
let m;
const navRe = /data-view="([^"]+)"/g;
while ((m = navRe.exec(html)) !== null) navMatches.push(m[1]);
console.log('Nav data-view values:', navMatches);

// view section IDs
const viewMatches = [];
const viewRe = /id="(view-[^"]+)"/g;
while ((m = viewRe.exec(html)) !== null) viewMatches.push(m[1]);
console.log('View section IDs:', viewMatches);

// Check match
const allMatch = navMatches.every(v => viewMatches.includes(v));
console.log('All nav data-view match a view id?', allMatch);

// upload container
console.log('upload-container present:', html.includes('upload-container'));
console.log('btn-open-scenario present:', html.includes('btn-open-scenario'));
console.log('signal-grid present:', html.includes('signal-grid'));

// Check for any unclosed script or syntax issues near module import
const scriptTag = html.indexOf('type="module"');
console.log('module script tag position:', scriptTag);
console.log('module script src:', html.substring(scriptTag, scriptTag+60));
