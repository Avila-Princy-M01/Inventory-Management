/**
 * runtime_smoke_test.js — Executes the briefing render paths with a mocked DOM.
 *
 * Catches ReferenceErrors / TypeErrors inside template-literal render code that
 * string-based checkers (check_spec, test_frontend) cannot see, because those
 * paths only execute on user interaction in the browser.
 *
 * Run:  node runtime_smoke_test.js
 */

let failures = 0;
const runTest = (label, fn) => {
  try {
    fn();
    console.log(`  ✓ PASS: ${label}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ FAIL: ${label}`);
    console.log(`      ${err.constructor.name}: ${err.message}`);
  }
};

// ── Minimal DOM mock ─────────────────────────────────────────────
const elements = {};
const makeEl = (id) => ({
  id,
  innerHTML: '',
  textContent: '',
  style: {},
  classList: {
    _set: new Set(),
    add(c) { this._set.add(c); },
    remove(c) { this._set.delete(c); },
    contains(c) { return this._set.has(c); },
  },
  addEventListener: () => {},
  appendChild: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  dataset: {},
});

globalThis.document = {
  getElementById: (id) => {
    if (!elements[id]) elements[id] = makeEl(id);
    return elements[id];
  },
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {},
  createElement: () => makeEl('created'),
  body: { appendChild: () => {}, classList: { add() {}, remove() {} } },
  addEventListener: () => {},
};
globalThis.window = {
  addEventListener: () => {},
  DATA: null,
};
globalThis.Chart = undefined; // force the no-Chart guard paths
globalThis.performance = { now: () => Date.now() };

// ── Load payload ─────────────────────────────────────────────────
const fs = require('fs');
const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));

// ── Import the modules under test ────────────────────────────────
import('./frontend/src/briefing.js').then((briefing) => {
  console.log('=== RUNTIME SMOKE TESTS (mocked DOM, real payload) ===\n');

  runTest('hydrateStaticSections(benchmark payload) executes without ReferenceError', () => {
    briefing.hydrateStaticSections(dashData);
  });

  runTest('renderMeetingGovernance(SOP_MONTHLY) executes', () => {
    briefing.renderMeetingGovernance('SOP_MONTHLY', dashData);
  });

  runTest('generateMeetingEmail(SOP_MONTHLY) executes and renders figures', () => {
    const email = briefing.generateMeetingEmail('SOP_MONTHLY', dashData);
    if (!email.includes('EXECUTIVE MINUTES')) throw new Error('missing header');
    if (!email.includes('86.8')) throw new Error('CHI missing from email');
  });

  runTest('generateMeetingEmail with EMPTY payload renders "--" (no crash, no fake numbers)', () => {
    const email = briefing.generateMeetingEmail('SOP_MONTHLY', {});
    if (!email) throw new Error('empty email');
    if (email.includes('1,498.7') || email.includes('19,708')) throw new Error('frozen numbers resurfaced');
  });

  runTest('renderSlide(0..4) all slides execute with payload', () => {
    for (let i = 0; i < 5; i++) briefing.renderSlide(i, dashData);
  });

  runTest('renderSlide with EMPTY payload does not crash', () => {
    for (let i = 0; i < 5; i++) briefing.renderSlide(i, {});
  });

  runTest('initPresentationDeck(empty) does not crash', () => {
    briefing.initPresentationDeck({});
  });

  runTest('initBriefingCharts(full activation path) executes without ReferenceError', () => {
    briefing.resetBriefingCharts();
    briefing.initBriefingCharts(dashData);
  });

  // Cross-check against the backend suite import paths too
  import('./frontend/src/signals.js').then((signals) => {
    runTest('getBadgeConfig resolves all 5 contract keys', () => {
      for (const k of ['ACTIVE CRISIS', 'EMERGENCY EXPEDITE', 'STANDARD PO', 'ADVISORY', 'EXCESS HOLDING']) {
        const cfg = signals.getBadgeConfig(k);
        if (!cfg || !cfg.label) throw new Error(`badge ${k} unresolved`);
      }
    });

    console.log(failures === 0 ? '\nRESULT: ALL RUNTIME SMOKE TESTS PASS\n' : `\nRESULT: ${failures} RUNTIME SMOKE TEST(S) FAILED\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
});
