const fs = require('fs');
const failures = [];
const check = (label, pass, detail) => {
  const icon = pass ? 'OK  ' : 'FAIL';
  console.log('  ' + icon + '  ' + label + (detail ? ' -- ' + detail : ''));
  if (!pass) failures.push(label);
};

const css    = fs.readFileSync('frontend/src/style.css',  'utf8');
const html   = fs.readFileSync('frontend/index.html',     'utf8');
const allJS  = ['main','signals','drawer-detail','drawer-scenario','workflow','briefing','masterdata','audit','uploader']
               .map(f => fs.readFileSync('frontend/src/'+f+'.js','utf8')).join('\n');

const cssLines  = css.trimEnd().split('\n').length;
const htmlLines = html.trimEnd().split('\n').length;

// Line count ratchets
check('style.css lines <= 9400', cssLines <= 9400, String(cssLines));
check('index.html lines <= 1261', htmlLines <= 1261, String(htmlLines));

// Hardcoded 86.8 -- zero tolerance
const html868 = (html.match(/86\.8/g)||[]).length;
check('No hardcoded 86.8 in index.html', html868 === 0, html868 ? html868 + ' occurrences' : 'clean');

// No 86.8 as a string literal in JS (matrix values in arrays are OK)
const jsStringLit868 = (allJS.match(/['"]86\.8['"]/g)||[]).length;
check('No 86.8 string literals in JS', jsStringLit868 === 0, jsStringLit868 ? jsStringLit868 + ' string literals' : 'clean');

// Distinct hex values
const hexMatches = css.match(/#[0-9A-Fa-f]{6}\b/g) || [];
const distinctHexes = new Set(hexMatches.map(function(h){ return h.toUpperCase(); })).size;
check('Distinct hexes in style.css <= 120 (audit baseline)', distinctHexes <= 120, String(distinctHexes));
check('Distinct hexes in style.css <= 30 (target)', distinctHexes <= 30, distinctHexes <= 30 ? String(distinctHexes) : String(distinctHexes) + ' -- consolidate with CSS vars');

// [AI] boxes in briefing <= 2 (count actual container elements, not class names)
const briefMatch = html.match(/id="view-briefing"[\s\S]*?id="view-masterdata"/);
const briefSec = briefMatch ? briefMatch[0] : '';
// Count top-level AI card containers (not internal class names)
const aiBriefing = (briefSec.match(/class="ai-briefing-executive-card|class="card-ai-box|id="ai-agent-box/g)||[]).length;
check('[AI] boxes in briefing <= 2', aiBriefing <= 2, String(aiBriefing));

// No inline hex in JS string literals
const jsHexLiterals = (allJS.match(/'#[0-9A-Fa-f]{3,6}'/g)||[]).length;
check('Inline hex literals in JS <= 60', jsHexLiterals <= 60, String(jsHexLiterals));

// ── Honest hygiene gates (added: count reality, not a subset) ──

// Guard: the Google Fonts link must not download Inter (design spec says no Inter)
const fontLink = (html.match(/fonts\.googleapis\.com[^"']*/) || [''])[0];
check('No Inter in Google Fonts link', !/family=Inter/i.test(fontLink), /family=Inter/i.test(fontLink) ? 'Inter still downloaded' : 'clean');

// Cosmetic inline styles in index.html (display:none toggles are functional state anchors, allowed)
const inlineStyles = (html.match(/style="/g) || []).length;
const functionalDisplay = (html.match(/style="[^"]*display/g) || []).length;
const cosmeticInline = inlineStyles - functionalDisplay;
check('Cosmetic inline styles in index.html = 0', cosmeticInline === 0, cosmeticInline + ' cosmetic (' + functionalDisplay + ' functional display toggles)');

// Raw hex occurrences across JS, EXCLUDING style="..." attribute content (CSS context uses var())
// and excluding quoted Chart.js/canvas palette literals (counted by the gate above).
const rawJsHex = (allJS.match(/#[0-9A-Fa-f]{6}\b/g) || []).length;
const styleAttrHex = (allJS.match(/style="[^"]*"/g) || []).join('').match(/#[0-9A-Fa-f]{6}\b/g);
const jsRawHexOutsideStyles = rawJsHex - (styleAttrHex ? styleAttrHex.length : 0);
check('JS hex occurrences outside style attrs <= 60', jsRawHexOutsideStyles <= 60, String(jsRawHexOutsideStyles));

// Backend tests
const { execSync } = require('child_process');
try {
  execSync('python -m pytest backend/test_generate_dashboard_data.py -q --tb=no', { stdio: 'pipe' });
  check('Backend pytest all pass', true, '');
} catch(e) {
  const out = e.stdout ? e.stdout.toString().trim() : '';
  check('Backend pytest all pass', false, out.split('\n').pop());
}

console.log('');
console.log('=== BUDGET TEST RESULTS ===');
const result = failures.length === 0 ? 'ALL PASS' : failures.length + ' FAILED';
console.log('RESULT: ' + result);
if (failures.length) { failures.forEach(function(f){ console.log('  FAILED: ' + f); }); process.exit(1); }


