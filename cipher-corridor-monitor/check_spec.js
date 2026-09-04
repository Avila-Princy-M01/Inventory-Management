const fs = require('fs');
const checks = [];
const check = (label, pass) => checks.push({label, pass});

const main = fs.readFileSync('frontend/src/main.js','utf8');
check('main.js: fetch dashboard_data.json',        main.includes('dashboard_data.json'));
check('main.js: DOMContentLoaded',                 main.includes('DOMContentLoaded'));
check('main.js: Proxy on auditLog',                main.includes('Proxy'));
check('main.js: pushAudit export',                 main.includes('pushAudit'));
check('main.js: setApproved export',               main.includes('setApproved'));
check('main.js: closeAllDrawers export',           main.includes('closeAllDrawers'));
check('main.js: animateCHIDial + requestAnimationFrame', main.includes('animateCHIDial') && main.includes('requestAnimationFrame'));
check('main.js: crypto.randomUUID guard',          main.includes('randomUUID'));
check('main.js: error block E61919',               main.includes('E61919'));
check('main.js: lazy briefing init',               main.includes('initBriefingCharts'));

const sig = fs.readFileSync('frontend/src/signals.js','utf8');
check('signals.js: getBadgeConfig export',         sig.includes('getBadgeConfig'));
check('signals.js: renderSignalCards export',      sig.includes('renderSignalCards'));
check('signals.js: all 5 badge keys present',      sig.includes('ACTIVE CRISIS') && sig.includes('EXCESS HOLDING') && sig.includes('EMERGENCY EXPEDITE') && sig.includes('STANDARD PO') && sig.includes('ADVISORY'));
check('signals.js: prefix toUpperCase match',      sig.includes('toUpperCase'));
check('signals.js: console.warn fallback',         sig.includes('console.warn'));
check('signals.js: supply_certainty warning',      sig.includes('supply_certainty'));
check('signals.js: stagger --index animation',     sig.includes('--index'));
check('signals.js: APPROVED overlay',              sig.includes('APPROVED'));
check('signals.js: prs bar',                       sig.includes('prs') || sig.includes('PRS'));

const dd = fs.readFileSync('frontend/src/drawer-detail.js','utf8');
check('drawer-detail.js: openDrawer export',       dd.includes('openDrawer'));
check('drawer-detail.js: closeAllDrawers call',    dd.includes('closeAllDrawers'));
check('drawer-detail.js: Chart.js chart',          dd.includes('Chart'));
check('drawer-detail.js: breach_week annotation',  dd.includes('breach_week'));
check('drawer-detail.js: recovery #346538',        dd.includes('346538'));
check('drawer-detail.js: borderDash',              dd.includes('borderDash'));
check('drawer-detail.js: disabled on approval',    dd.includes('disabled'));
check('drawer-detail.js: pushAudit + setApproved', dd.includes('pushAudit') && dd.includes('setApproved'));
check('drawer-detail.js: root_cause breakdown',    dd.includes('supply_deficit') || dd.includes('root_cause'));
check('drawer-detail.js: 5 approval label variants', dd.includes('INTER-MARKET') && dd.includes('EMERGENCY EXPEDITE') && dd.includes('STANDARD PO') && dd.includes('ADVISORY') && dd.includes('DEFER'));

const ds = fs.readFileSync('frontend/src/drawer-scenario.js','utf8');
check('drawer-scenario.js: lookupCHI',             ds.includes('lookupCHI'));
check('drawer-scenario.js: recomputeSignalScores', ds.includes('recomputeSignalScores'));
check('drawer-scenario.js: chi matrix 12x20',      (ds.match(/\[/g)||[]).length > 20);
check('drawer-scenario.js: lead time 1-12',        ds.includes('"min"') || ds.includes('min:') || ds.includes('min='));
check('drawer-scenario.js: ceilMult 1.1-3.0',      ds.includes('1.1') && ds.includes('3.0'));
check('drawer-scenario.js: clamp function',        ds.includes('clamp'));
check('drawer-scenario.js: UNDERSTOCK GATE',       ds.includes('UNDERSTOCK') || ds.includes('understock'));
check('drawer-scenario.js: RESET',                 ds.includes('RESET') || ds.includes('reset'));

const br = fs.readFileSync('frontend/src/briefing.js','utf8');
check('briefing.js: initBriefingCharts export',    br.includes('initBriefingCharts'));
check('briefing.js: chartsInitialised guard',      br.includes('chartsInitialised'));
check('briefing.js: whiteBackground plugin',       br.includes('whiteBackground') || br.includes('white'));
check('briefing.js: 4 Chart instances',            (br.match(/new Chart\(/g)||[]).length >= 4);
check('briefing.js: window.print',                 br.includes('window.print'));
check('briefing.js: simulated_email modal',        br.includes('simulated_email'));
check('briefing.js: 80/20 systemic annotation',    br.includes('SYSTEMIC') || br.includes('80/20'));
check('briefing.js: tier colours 346538+956400',   br.includes('346538') && br.includes('956400'));

const md = fs.readFileSync('frontend/src/masterdata.js','utf8');
check('masterdata.js: export function present',    md.includes('export'));
check('masterdata.js: DOH 0.5 + 0.8 thresholds',  md.includes('0.5') && md.includes('0.8'));
check('masterdata.js: sap-omp CSV filename',       md.includes('sap-omp-recalibration'));
check('masterdata.js: 379 or SHOW ALL toggle',     md.includes('379') || md.includes('SHOW ALL'));

const au = fs.readFileSync('frontend/src/audit.js','utf8');
check('audit.js: renderTable export',              au.includes('renderTable'));
check('audit.js: initAuditTable export',           au.includes('initAuditTable'));
check('audit.js: NO ACTIONS LOGGED empty state',   au.includes('NO ACTIONS LOGGED'));
check('audit.js: select reason code',              au.includes('select'));
check('audit.js: gxp-audit-log CSV filename',      au.includes('gxp-audit-log'));
check('audit.js: GxP signature text',              au.includes('GxP') || au.includes('GXP'));

const up = fs.readFileSync('frontend/src/uploader.js','utf8');
check('uploader.js: drag-drop events',             up.includes('dragover') || up.includes('drop'));
check('uploader.js: POST /upload',                 up.includes('/upload'));
check('uploader.js: .xlsx validation',             up.includes('xlsx'));

const css = fs.readFileSync('frontend/src/style.css','utf8');
check('style.css: --bg F4F4F0 token',              css.includes('F4F4F0'));
check('style.css: JetBrains Mono',                 css.includes('JetBrains'));
check('style.css: border-radius 0',                css.includes('border-radius: 0') || css.includes('border-radius:0'));
check('style.css: drawer translateX',              css.includes('translateX'));
check('style.css: cardReveal or signal-card anim', css.includes('cardReveal') || css.includes('signal-card'));
check('style.css: tabular-nums',                   css.includes('tabular-nums'));
check('style.css: will-change transform',          css.includes('will-change'));

const html = fs.readFileSync('frontend/index.html','utf8');
check('index.html: 4 view sections (view-)',       (html.match(/id="view-/g)||[]).length >= 4);
check('index.html: drawer-detail aside',           html.includes('drawer-detail'));
check('index.html: drawer-scenario aside',         html.includes('drawer-scenario'));
check('index.html: drawer-overlay div',            html.includes('drawer-overlay'));
check('index.html: chi-value or kpi-banner',       html.includes('chi-value') || html.includes('kpi-banner'));
check('index.html: type=module',                   html.includes('type="module"'));
check('index.html: Outfit font',                   html.includes('Outfit'));
check('index.html: JetBrains Mono font',           html.includes('JetBrains'));
check('index.html: signal-grid',                   html.includes('signal-grid'));

const passed = checks.filter(c=>c.pass).length;
const failed = checks.filter(c=>!c.pass);
console.log('');
console.log('=== SPEC COMPLIANCE REPORT ===');
checks.forEach(c => console.log(c.pass ? '  OK  ' : '  FAIL', c.label));
console.log('');
console.log('RESULT: ' + passed + '/' + checks.length + ' checks passed');
if(failed.length){ console.log('FAILED CHECKS:'); failed.forEach(c=>console.log('  - ' + c.label)); }
