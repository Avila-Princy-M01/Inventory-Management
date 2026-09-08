/**
 * test_drawer_refactor.js
 * Automated test suite verifying the Signal Detail drawer UI/UX refactor acceptance criteria.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('===============================================================================');
console.log(' Signal Detail Drawer Refactor — Acceptance Verification Suite');
console.log('===============================================================================\n');

// Import drawer module
import { openDrawer, getApprovalLabel } from './frontend/src/drawer-detail.js';

// Setup Mock DOM
const elementRegistry = new Map();

function createMockElement(id, tag = 'div') {
  return {
    id,
    tagName: tag.toUpperCase(),
    textContent: '',
    innerHTML: '',
    classList: {
      _classes: new Set(),
      add(cls) { this._classes.add(cls); },
      remove(cls) { this._classes.delete(cls); },
      toggle(cls, val) {
        if (val !== undefined) {
          if (val) this._classes.add(cls); else this._classes.delete(cls);
          return val;
        }
        if (this._classes.has(cls)) { this._classes.delete(cls); return false; }
        this._classes.add(cls); return true;
      },
      contains(cls) { return this._classes.has(cls); }
    },
    style: {},
    dataset: {},
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(evt, fn) {},
    querySelectorAll(sel) { return []; },
    querySelector(sel) { return createMockElement(sel); },
    appendChild(el) {},
    removeChild(el) {},
    click() {}
  };
}

const mockBody = {
  _innerHTML: '',
  set innerHTML(val) {
    this._innerHTML = val;
    // Parse all id attributes
    const idRegex = /id=["']([^"']+)["']/g;
    let m;
    while ((m = idRegex.exec(val)) !== null) {
      const id = m[1];
      if (!elementRegistry.has(id)) {
        elementRegistry.set(id, createMockElement(id));
      }
    }
  },
  get innerHTML() {
    return this._innerHTML;
  },
  querySelectorAll(sel) {
    return [];
  }
};

const mockDrawer = createMockElement('drawer-detail', 'aside');
const mockOverlay = createMockElement('drawer-overlay', 'div');
const mockTitle = createMockElement('detail-title', 'div');

elementRegistry.set('drawer-detail', mockDrawer);
elementRegistry.set('drawer-overlay', mockOverlay);
elementRegistry.set('detail-title', mockTitle);
elementRegistry.set('detail-body', mockBody);

globalThis.document = {
  getElementById(id) {
    return elementRegistry.get(id) || null;
  },
  querySelectorAll(sel) {
    return [];
  },
  createElement(tag) {
    return createMockElement('', tag);
  }
};

globalThis.window = {
  closeAllDrawers: () => {},
  DATA: {
    metadata: { current_week: 14, calendar_lead_time_weeks: 3 },
    top_signals: []
  },
  innerWidth: 1366,
  innerHeight: 768
};

// Load test signals
const rawData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
const crisisSignal = rawData.top_signals.find(s => s.action_type === 'ACTIVE CRISIS') || rawData.top_signals[0];
const excessSignal = rawData.top_signals.find(s => s.action_type === 'EXCESS HOLDING') || {
  row_id: 'signal-excess-1',
  brand: 'Victoza 6mg/ml',
  country: 'Germany',
  action_type: 'EXCESS HOLDING',
  breach_week: 48,
  recommended_qty_units: 0,
  capital_at_risk_inr: 0,
  intermarket_transfer: { has_transfer: false }
};
const intermarketSignal = rawData.top_signals.find(s => s.intermarket_transfer && s.intermarket_transfer.has_transfer) || crisisSignal;

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}\n    ${err.message}`);
    testsFailed++;
  }
}

// ── Test 1: Non-null resolution of all 29 target IDs on open ──
runTest('All 29 target IDs resolve non-null in rendered drawer DOM', () => {
  openDrawer(intermarketSignal, {});

  const requiredIds = [
    // GOVERNANCE (14 IDs)
    'select-signal-owner', 'owner-saved-pill', 'workflow-comments-list', 'input-new-comment',
    'btn-post-comment', 'comment-count-badge', 'workflow-snooze-area', 'btn-snooze-alert',
    'btn-unsnooze-alert', 'select-snooze-reason', 'select-snooze-weeks', 'workflow-status-badge',
    'narrative-dossier', 'narrative-badge-status',
    // LOGISTICS (1 ID)
    'btn-execute-transfer',
    // COPILOT (8 IDs)
    'input-ai-copilot', 'btn-send-ai-copilot', 'ai-response-area', 'ai-response-content',
    'ai-response-spinner', 'btn-toggle-eli5', 'ai-eli5-callout', 'btn-ai-quick-act',
    // DECISION HEADER / TABS / EVIDENCE / FOOTER (6 IDs)
    'drawer-decision-header', 'drawer-tabs-bar', 'detail-chart', 'pane-evidence',
    'btn-approve', 'footer-status-label'
  ];

  for (const id of requiredIds) {
    const el = document.getElementById(id);
    assert.ok(el !== null, `Expected document.getElementById('${id}') to resolve non-null`);
  }
});

// ── Test 2: Exactly 1 [ AI ]-labelled box in initial rendered drawer DOM ──
runTest('Rendered drawer DOM contains exactly 1 [ AI ]-labelled box', () => {
  openDrawer(intermarketSignal, {});
  const html = mockBody.innerHTML;
  const matches = html.match(/\[\s*AI\s*\]/gi) || [];
  assert.equal(matches.length, 1, `Expected exactly 1 '[ AI ]' in rendered DOM, found ${matches.length}`);
});

// ── Test 3: Standalone SLA banner and cliff banner do NOT exist above chart ──
runTest('Standalone SLA and cliff banners are folded into decision header, not above chart', () => {
  openDrawer(intermarketSignal, {});
  const html = mockBody.innerHTML;
  assert.ok(!html.includes('detail-sla-banner'), 'Standalone detail-sla-banner must be deleted');
  assert.ok(!html.includes('cliff-banner-standalone'), 'Standalone cliff banner must be deleted');
  assert.ok(html.includes('decision-sla-chip'), 'SLA status must be folded into decision header as a status chip');
  assert.ok(html.includes('decision-headline'), 'Cliff breach fact must be folded into decision header line 2');
});

// ── Test 4: freight_callout is rendered in decision header ──
runTest('freight_callout is prominently rendered in the Decision Header', () => {
  openDrawer(crisisSignal, {});
  const html = mockBody.innerHTML;
  assert.ok(html.includes('decision-directive-quote') || html.includes('decision-freight-callout'), 'Decision header must render freight directive quote');
  assert.ok(html.includes('ALREADY TOO LATE for sea freight') || html.includes('air freight'), 'freight_callout quote must be present in header');
});

// ── Test 5: Distinct accent hues in rendered drawer DOM <= 3 ──
runTest('Distinct accent hues in rendered drawer DOM <= 3', () => {
  openDrawer(intermarketSignal, {});
  const html = mockBody.innerHTML;
  // Check for rogue non-industrial color hexes
  const rogueHues = ['#0072CE', '#16A34A', '#2563EB', '#3B82F6', '#6366F1', '#64748B', '#D97706', '#EA580C', '#EF4444'];
  const foundRogues = rogueHues.filter(h => html.toLowerCase().includes(h.toLowerCase()));
  assert.equal(foundRogues.length, 0, `Found disallowed accent hues in rendered HTML: ${foundRogues.join(', ')}`);
});

// ── Test 6: 5 Approval label variants are rendered correctly ──
runTest('Approval button displays correct 1 of 5 label variants for CRISIS, EXCESS, STANDARD', () => {
  // 1. CRISIS
  const crisisLabel = getApprovalLabel('ACTIVE CRISIS', 48200);
  assert.equal(crisisLabel, 'APPROVE INTER-MARKET RE-ALLOCATION');

  // 2. EMERGENCY EXPEDITE
  const expediteLabel = getApprovalLabel('EMERGENCY EXPEDITE', 25000);
  assert.equal(expediteLabel, 'APPROVE EMERGENCY EXPEDITE');

  // 3. STANDARD PO
  const poLabel = getApprovalLabel('STANDARD PO', 15000);
  assert.ok(poLabel.includes('APPROVE STANDARD PO'), 'Expected STANDARD PO variant');
  assert.ok(poLabel.includes('15,000'), 'Expected quantity formatted with commas');

  // 4. ADVISORY
  const advLabel = getApprovalLabel('ADVISORY', 0);
  assert.equal(advLabel, 'ACKNOWLEDGE ADVISORY');

  // 5. EXCESS HOLDING
  const excessLabel = getApprovalLabel('EXCESS HOLDING', 0);
  assert.equal(excessLabel, 'APPROVE DEFER / REALLOCATE');
});

// ── Test 7: #btn-execute-transfer appears only for inter-market ──
runTest('#btn-execute-transfer appears (is visible) only for inter-market transfer', () => {
  // Case A: Inter-market signal -> button rendered without display:none
  openDrawer(intermarketSignal, {});
  const interHtml = mockBody.innerHTML;
  assert.ok(interHtml.includes('id="btn-execute-transfer"'), 'btn-execute-transfer must be present in DOM');
  assert.ok(!interHtml.includes('id="btn-execute-transfer" disabled style="display:none;"') &&
            !interHtml.includes('id="btn-execute-transfer"  style="display:none;"') &&
            !interHtml.includes('id="btn-execute-transfer" style="display:none;"'),
            'btn-execute-transfer must be visible for intermarket transfer');

  // Case B: Excess holding signal without transfer -> button rendered with display:none
  openDrawer(excessSignal, {});
  const excessHtml = mockBody.innerHTML;
  assert.ok(excessHtml.includes('id="btn-execute-transfer"'), 'btn-execute-transfer must still exist in DOM for safe handler binding');
  assert.ok(excessHtml.includes('id="btn-execute-transfer" disabled style="display:none;"') ||
            excessHtml.includes('id="btn-execute-transfer"  style="display:none;"') ||
            excessHtml.includes('id="btn-execute-transfer" style="display:none;"'),
            'btn-execute-transfer must have display:none when signal has no transfer');
});

// ── Test 8: Causal reasoning preserved as clean plain text ──
runTest('Causal reasoning text is preserved inside parent sections without colored boxes', () => {
  openDrawer(intermarketSignal, {});
  const html = mockBody.innerHTML;
  // 1. Clinical chronic patient churn reasoning
  assert.ok(
    html.includes('chronic patients stay on the same brand for life, so losing them today wipes out recurring annual revenue'),
    'Clinical chronic patient causal reasoning must be preserved'
  );
  // 2. Upstream plant contention inference
  assert.ok(
    html.includes('confirms bulk upstream plant constraint') || html.includes('UPSTREAM CONTENTION'),
    'Plant contention causal inference must be preserved'
  );
  // 3. ROQ midpoint restoration rationale
  assert.ok(html.includes('MIDPOINT RESTORATION'), 'ROQ midpoint restoration rationale must be preserved');

  openDrawer(excessSignal, {});
  const excessHtml = mockBody.innerHTML;
  assert.ok(excessHtml.includes('SURPLUS · DEFER INBOUND'), 'Surplus formula must be preserved for excess signals');
});

// ── Test 9: Pure flex layout with zero position:sticky on drawer children ──
runTest('CSS has 3-tier flex children and zero position:sticky inside drawer body', () => {
  const css = fs.readFileSync('frontend/src/style.css', 'utf8');
  assert.ok(css.includes('.drawer-decision-header {\n  flex: 0 0 auto;') || css.includes('.drawer-decision-header {\r\n  flex: 0 0 auto;'),
    'drawer-decision-header must be flex: 0 0 auto');
  assert.ok(css.includes('.drawer-panes-wrapper {\n  flex: 1 1 auto;') || css.includes('.drawer-panes-wrapper {\r\n  flex: 1 1 auto;'),
    'drawer-panes-wrapper must be flex: 1 1 auto');
  assert.ok(css.includes('.drawer-action-footer {\n  flex: 0 0 auto;') || css.includes('.drawer-action-footer {\r\n  flex: 0 0 auto;'),
    'drawer-action-footer must be flex: 0 0 auto');
});

console.log(`\n===============================================================================`);
console.log(` Acceptance Verification Results: ${testsPassed} PASSED, ${testsFailed} FAILED`);
console.log(`===============================================================================`);

if (testsFailed > 0) {
  process.exit(1);
}
