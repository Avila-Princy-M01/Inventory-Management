const fs = require('fs');
const br = fs.readFileSync('frontend/src/briefing.js','utf8');
const imports = [...br.matchAll(/^import .+ from '(.+)'/gm)].map(m => m[1]);
console.log('briefing.js imports:', imports.length ? imports.join(', ') : 'NONE - no imports');
console.log('Uses lookupCHI:', br.includes('lookupCHI'));
const lookupImport = br.match(/import[^;]+lookupCHI[^;]+/);
console.log('lookupCHI import line:', lookupImport ? lookupImport[0] : 'NOT IMPORTED');
