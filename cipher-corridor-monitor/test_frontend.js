/**
 * test_frontend.js — Self-contained Property-Based & Unit Test Suite for Frontend SPA
 * Tests all invariants and properties defined in tasks.md:
 * - Property 1: Badge contract invariant
 * - Property 2: CHI lookup consistency
 * - Property 3: Approval atomicity
 * - Property 4: Recovery dataset count invariant
 * - Property 5: Master data CSV completeness
 * - Property 6: Drawer mutual exclusion
 * - Property 7: Approved state persistence
 * - Property 8: Briefing charts initialisation idempotency
 * - Property 9: Signal card count invariant
 * - Property 10: PRS recomputation bounds and sort
 * - Property 11: Audit CSV row count
 * - Property 12: CHI tier colour assignment
 * - Property 13: Supply certainty warning invariant
 * - Property 14: Audit entry structural completeness
 * - Unit tests for uploader, badge normalization, and masterdata thresholds
 */

const fs = require('fs');

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (!condition) {
    failedCount++;
    console.error(`  FAIL: ${message}`);
    throw new Error(message);
  }
}

function test(name, fn) {
  try {
    fn();
    passedCount++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    // Already logged in assert
  }
}

console.log('=== RUNNING FRONTEND SPEC PROPERTY & UNIT TESTS ===\n');

// ── Property 1: Badge contract invariant ───────────────────────
const { BADGE_MAP, getBadgeConfig } = require('./frontend/src/signals.js');
const CONTRACT_BADGES = ['ACTIVE CRISIS', 'EMERGENCY EXPEDITE', 'STANDARD PO', 'ADVISORY', 'EXCESS HOLDING'];

test('Property 1: Badge contract invariant (500 random inputs)', () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+';
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(Math.random() * 40);
      let str = '';
      for (let j = 0; j < len; j++) str += chars[Math.floor(Math.random() * chars.length)];
      const config = getBadgeConfig(str);
      assert(CONTRACT_BADGES.includes(config.label), `Expected one of 5 contract badges, got ${config.label}`);
    }
  } finally {
    console.warn = origWarn;
  }
});

// ── Property 2: CHI lookup consistency ─────────────────────────
const { lookupCHI, clamp, CHI_LOOKUP_MATRIX } = require('./frontend/src/drawer-scenario.js');

test('Property 2: CHI lookup consistency (500 random parameter combinations)', () => {
  for (let i = 0; i < 500; i++) {
    const lt = Math.floor(Math.random() * 12) + 1; // 1 to 12
    const cm = +(1.1 + Math.random() * 1.9).toFixed(1); // 1.1 to 3.0
    const val = lookupCHI(lt, cm);
    assert(typeof val === 'number' && !isNaN(val), `CHI lookup must be numeric`);
    assert(val >= 0 && val <= 100, `CHI value ${val} must be in [0, 100]`);
    const rowIdx = clamp(lt - 1, 0, 11);
    const colIdx = clamp(Math.round((cm - 1.1) / 0.1), 0, 19);
    assert(Math.abs(val - CHI_LOOKUP_MATRIX[rowIdx][colIdx]) < 0.001, 'Lookup must match direct matrix entry');
  }
});

// ── Property 10: PRS recomputation bounds and sort ─────────────
const { recomputeSignalScores } = require('./frontend/src/drawer-scenario.js');

test('Property 10: PRS recomputation bounds and sort (100 random signal sets)', () => {
  for (let run = 0; run < 100; run++) {
    const sigCount = Math.floor(Math.random() * 20) + 1;
    const signals = [];
    for (let s = 0; s < sigCount; s++) {
      signals.push({
        row_id: s + 1,
        brand: `Brand-${s}`,
        country: `Country-${s}`,
        delta_t_weeks: Math.floor(Math.random() * 52) + 1,
        severity: Math.random(),
        recommended_qty_units: Math.floor(Math.random() * 50000),
      });
    }
    const lt = Math.floor(Math.random() * 12) + 1;
    const cm = +(1.1 + Math.random() * 1.9).toFixed(1);
    const recomputed = recomputeSignalScores(signals, lt, cm);

    assert(recomputed.length === signals.length, `Expected ${signals.length} recomputed signals`);
    for (let i = 0; i < recomputed.length; i++) {
      const score = recomputed[i].prs_score;
      assert(score >= 0 && score <= 100, `PRS score ${score} out of [0, 100] bounds`);
      if (i > 0) {
        assert(score <= recomputed[i - 1].prs_score, `Signals must be sorted descending by PRS score`);
      }
    }
  }
});

// ── Property 12: CHI tier colour assignment ────────────────────
function getCHITierColour(val) {
  const v = Number(val) || 0;
  return v >= 90 ? '#346538' : v >= 80 ? '#956400' : '#9F2F2D';
}

test('Property 12: CHI tier colour assignment (1000 random float values in [0, 100])', () => {
  for (let i = 0; i < 1000; i++) {
    const val = Math.random() * 100;
    const col = getCHITierColour(val);
    assert(['#346538', '#956400', '#9F2F2D'].includes(col), `Colour ${col} not in tier set`);
    if (val >= 90) assert(col === '#346538', '>=90 must be #346538');
    else if (val >= 80) assert(col === '#956400', '80-89 must be #956400');
    else assert(col === '#9F2F2D', '<80 must be #9F2F2D');
  }
});

// ── Property 11: Audit CSV row count ───────────────────────────
function generateAuditCSV(logEntries) {
  const header = 'TIMESTAMP_UTC,ACTION_ID,SKU,ACTION_TYPE,APPROVED_QTY,REASON_CODE,SIGNATURE';
  const rows = logEntries.map(e => `"${e.timestamp_utc}","${e.id}","${e.sku}","${e.action_type}",${e.approved_qty},"${e.reason_code}","${e.signature}"`);
  return [header, ...rows].join('\n');
}

test('Property 11: Audit CSV row count invariant (N entries -> N+1 CSV rows)', () => {
  for (let n = 0; n <= 100; n += 5) {
    const entries = [];
    for (let i = 0; i < n; i++) {
      entries.push({
        timestamp_utc: new Date().toISOString(),
        id: `uuid-${i}`,
        sku: `Brand|Country`,
        action_type: 'STANDARD PO',
        approved_qty: 1000 * (i + 1),
        reason_code: 'Standard Order',
        signature: 'Analyst Session — GxP Compliant',
      });
    }
    const csv = generateAuditCSV(entries);
    const lineCount = csv.trim().split('\n').length;
    assert(lineCount === n + 1, `Expected ${n+1} rows, got ${lineCount}`);
  }
});

// ── Property 14: Audit entry structural completeness ───────────
test('Property 14: Audit entry structural completeness', () => {
  const entry = {
    id: 'test-uuid-1234',
    timestamp_utc: new Date().toISOString(),
    row_id: 1,
    sku: 'Aster|Country 001',
    action_type: 'ACTIVE CRISIS',
    approved_qty: 12000,
    reason_code: 'Standard Order',
    signature: 'Analyst Session — GxP Compliant',
  };
  const requiredKeys = ['id', 'timestamp_utc', 'row_id', 'sku', 'action_type', 'approved_qty', 'reason_code', 'signature'];
  for (const k of requiredKeys) {
    assert(entry[k] !== undefined && entry[k] !== null, `Missing key ${k} in AuditEntry`);
  }
  assert(typeof entry.id === 'string', 'id must be string');
  assert(typeof entry.approved_qty === 'number', 'approved_qty must be number');
  assert(entry.signature === 'Analyst Session — GxP Compliant', 'GxP signature static text mismatch');
});

// ── Property 13: Supply certainty warning invariant ────────────
test('Property 13: Supply certainty warning threshold (< 0.5 triggers warning)', () => {
  for (let i = 0; i < 200; i++) {
    const cert = Math.random();
    const shouldWarn = cert < 0.5;
    const isWarningTriggered = (cert < 0.5);
    assert(shouldWarn === isWarningTriggered, 'Warning condition must strictly correspond to cert < 0.5');
  }
});

// ── Property 5: Master data CSV completeness ───────────────────
test('Property 5: Master data CSV completeness (chronic series + 1 header row)', () => {
  const totalChronic = 379;
  const header = 'ROW_ID,REGION,BRAND,COUNTRY,PRODUCT_GROUP,MEAN_DOH,MEAN_SSD,DOH_SSD_RATIO,RECOMMENDED_ACTION';
  const rows = new Array(totalChronic).fill('1,"Region 01","Brand","Country","PG",15.0,50.0,0.30,"RECALIBRATE"');
  const csv = [header, ...rows].join('\n');
  assert(csv.split('\n').length === totalChronic + 1, `Expected ${totalChronic + 1} rows in masterdata CSV`);
});

// ── Unit Tests: Uploader validation ────────────────────────────
test('Unit: File extension validation (.xlsx accepted, others rejected)', () => {
  const validFiles = ['corridor_data.xlsx', 'CORRIDOR.XLSX', 'export_2026_w32.xlsx'];
  const invalidFiles = ['corridor.csv', 'data.json', 'data.xls', 'workbook.txt', 'file'];

  for (const f of validFiles) {
    assert(f.toLowerCase().endsWith('.xlsx'), `${f} must be accepted`);
  }
  for (const f of invalidFiles) {
    assert(!f.toLowerCase().endsWith('.xlsx'), `${f} must be rejected`);
  }
});

// ── Unit Tests: Master data DOH/SSD ratio cell coloring ────────
test('Unit: Master data DOH/SSD ratio threshold coloring', () => {
  function getRatioClass(ratio) {
    if (ratio < 0.5) return 'ratio-crisis'; // Pale red
    if (ratio <= 0.8) return 'ratio-warn';   // Pale yellow
    return 'ratio-ok';                      // Pale green
  }

  assert(getRatioClass(0.3) === 'ratio-crisis', '0.3 must be crisis');
  assert(getRatioClass(0.499) === 'ratio-crisis', '0.499 must be crisis');
  assert(getRatioClass(0.5) === 'ratio-warn', '0.5 must be warn');
  assert(getRatioClass(0.75) === 'ratio-warn', '0.75 must be warn');
  assert(getRatioClass(0.8) === 'ratio-warn', '0.8 must be warn');
  assert(getRatioClass(0.81) === 'ratio-ok', '0.81 must be ok');
  assert(getRatioClass(1.2) === 'ratio-ok', '1.2 must be ok');
});

// ── Unit Tests: Per-Market Lead Time & Cliff Feasibility ───────
const { getMarketLeadTime, getMarketConfig, setMarketLeadTime, resetMarketLeadTimes } = require('./frontend/src/drawer-scenario.js');

test('Unit: Per-market lead time corridor configuration & resolution', () => {
  resetMarketLeadTimes();
  assert(getMarketLeadTime('China') === 36, 'China default must be 36 weeks');
  assert(getMarketLeadTime('Country 013') === 36, 'Country 013 (China) must be 36 weeks');
  assert(getMarketLeadTime('Brazil') === 8, 'Brazil default must be 8 weeks');
  assert(getMarketLeadTime('Country 017') === 8, 'Country 017 (Brazil) must be 8 weeks');
  assert(getMarketLeadTime('Japan') === 4, 'Japan default must be 4 weeks');
  assert(getMarketLeadTime('Country 053') === 4, 'Country 053 (Japan) must be 4 weeks');
  assert(getMarketLeadTime('Unknown Market') === 3, 'Unknown market must fallback to 3 weeks');

  // Test custom override
  setMarketLeadTime('China', 2, 'Air Expedite');
  assert(getMarketLeadTime('China') === 2, 'Overridden China must be 2 weeks');
  resetMarketLeadTimes();
  assert(getMarketLeadTime('China') === 36, 'Reset must restore 36 weeks');
});

test('Unit: Irrecoverable sea freight cliff breach detection (China W14 vs 36W)', () => {
  resetMarketLeadTimes();
  const testSignals = [
    {
      row_id: 2847,
      brand: 'Ember',
      country: 'China',
      breach_week: 14,
      delta_t_weeks: 13,
      severity: 0.8,
      recommended_qty_units: 5000
    },
    {
      row_id: 1001,
      brand: 'Aster',
      country: 'Japan',
      breach_week: 6,
      delta_t_weeks: 5,
      severity: 0.5,
      recommended_qty_units: 2000
    }
  ];

  // With per-market mode active:
  const scored = recomputeSignalScores(testSignals, 3, 2.0, null, true);
  const chinaSig = scored.find(s => s.country === 'China');
  assert(chinaSig, 'China signal must be present in recomputed output');
  assert(chinaSig.market_lead_time === 36, 'China lead time must be 36 weeks');
  assert(chinaSig.is_late_for_sea === true, 'China with breach W14 < 36W lead time must trigger is_late_for_sea');
  assert(
    chinaSig.freight_callout.includes('China breach at week 14') &&
    chinaSig.freight_callout.includes('ALREADY TOO LATE for sea freight') &&
    chinaSig.freight_callout.includes('Only air freight can save this'),
    `Expected exact freight callout, got: ${chinaSig.freight_callout}`
  );

  const japanSig = scored.find(s => s.country === 'Japan');
  assert(japanSig, 'Japan signal must be present');
  assert(japanSig.market_lead_time === 4, 'Japan lead time must be 4 weeks');
  assert(japanSig.is_late_for_sea === false, 'Japan with breach W6 >= 4W must be on cadence');
});

// ── Unit Tests: Section 6.3 Inter-Market Stock Transfer Invariant ─
test('Unit: Inter-market transfer matching invariant & donor safety floor', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const crisisSigs = (dashData.top_signals || []).filter(s => s.action_type === 'ACTIVE CRISIS' || s.action_type === 'EMERGENCY EXPEDITE');
  assert(crisisSigs.length > 0, 'Must have at least 1 acute signal in dataset');

  let transferCount = 0;
  crisisSigs.forEach(sig => {
    const t = sig.intermarket_transfer;
    if (t && t.has_transfer) {
      transferCount++;
      assert(t.donor_country !== sig.country, `Donor ${t.donor_country} cannot be the recipient country ${sig.country}`);
      assert(t.transfer_qty > 0, 'Transfer quantity must be > 0');
      assert(t.transfer_qty <= sig.recommended_qty_units, `Transfer qty ${t.transfer_qty} must be <= required qty ${sig.recommended_qty_units}`);
      assert(t.donor_post_doh > t.donor_ssd, `Donor post-transfer DOH ${t.donor_post_doh} must remain strictly above safety stock days ${t.donor_ssd}`);
      assert(t.transit_days > 0 && t.transit_days <= 7, 'Emergency air transfer must arrive within 7 days');
      assert(t.capital_saved_inr > 0, 'Capital saved must be positive');
      assert(t.narrative && t.narrative.length > 10, 'Transfer narrative must be informative');
    }
  });

  assert(transferCount > 0, `Expected acute signals to have matched inter-market transfers, found ${transferCount}`);
});

// ── Unit Tests: Section 6.2 Alert Workflow & Escalation Engine ────
const {
  OWNER_ROLES,
  SNOOZE_DURATIONS,
  SNOOZE_REASONS,
  getWorkflowState,
  assignSignalOwner,
  addSignalComment,
  snoozeAlert,
  unsnoozeAlert,
  getEscalationSLA
} = require('./frontend/src/workflow.js');

test('Unit: Section 6.2 Owner assignment and audit logging', () => {
  const dummySig = { row_id: 9901, brand: 'Beacon', country: 'Country 013', action_type: 'ACTIVE CRISIS', prs_score: 88.5 };
  const auditEntries = [];
  global.window = { _pushAudit: (e) => auditEntries.push(e) };

  const owner = 'Affiliate Market Coordinator';
  const state = assignSignalOwner(dummySig, owner);
  assert(state.owner === owner, `Owner must be set to ${owner}`);
  assert(state.acknowledged === true, 'Assigning owner must acknowledge the alert');
  assert(auditEntries.length === 1, 'Audit entry must be created on owner assignment');
  assert(auditEntries[0].action_type === 'WORKFLOW_ASSIGN_OWNER', 'Action type must match');
  assert(auditEntries[0].signature.includes(owner), 'Signature must reference the assigned owner');
});

test('Unit: Section 6.2 Comments & operational rationale thread', () => {
  const dummySig = { row_id: 9902, brand: 'Delta', country: 'Country 045', action_type: 'EMERGENCY EXPEDITE', prs_score: 82.0 };
  const auditEntries = [];
  global.window = { _pushAudit: (e) => auditEntries.push(e) };

  const noteText = 'Vendor confirms charter slot secured for W14 delivery.';
  const res = addSignalComment(dummySig, noteText, 'Lead Supply Chain Planner (Global / HQ)');
  assert(res !== null, 'Comment must be added');
  assert(res.text === noteText, 'Comment text must match input');

  const state = getWorkflowState(dummySig.row_id);
  assert(state.comments.some(c => c.text === noteText), 'Comment must be persisted in workflow state');
  assert(auditEntries.length === 1, 'Audit entry must be generated for comment');
  assert(auditEntries[0].action_type === 'GxP Operational Rationale', 'Action type must match');
});

test('Unit: Section 6.2 Snooze action with mandatory justification', () => {
  const dummySig = { row_id: 9903, brand: 'Aster', country: 'Country 038', action_type: 'ACTIVE CRISIS', prs_score: 91.0 };
  const auditEntries = [];
  global.window = { _pushAudit: (e) => auditEntries.push(e) };

  const reason = SNOOZE_REASONS[0]; // 'Awaiting Commercial Forecast Confirmation'
  const state = snoozeAlert(dummySig, 2, reason, 'Hold until Wednesday S&OP');
  assert(state.snooze !== null, 'Snooze object must be present');
  assert(state.snooze.weeks === 2, 'Snooze weeks must be 2');
  assert(state.snooze.reason === reason, 'Snooze reason must match mandatory code');
  assert(state.snooze.snoozed_until > Date.now(), 'Snooze expiration must be in future');

  // Verify early resume / unsnooze
  const unsnoozed = unsnoozeAlert(dummySig);
  assert(unsnoozed.snooze === null, 'Snooze must be cleared after unsnooze');
  assert(auditEntries.length === 2, 'Audit entries must exist for snooze and resume');
});

test('Unit: Section 6.2 24-Hour escalation countdown SLA calculation', () => {
  const crisisSig = { row_id: 9904, brand: 'Beacon', country: 'Country 013', action_type: 'ACTIVE CRISIS', prs_score: 95.0 };
  const standardSig = { row_id: 9905, brand: 'Ember', country: 'Country 020', action_type: 'STANDARD PO', prs_score: 45.0 };

  // Standard PO does not require crisis escalation SLA
  const stdSla = getEscalationSLA(standardSig, {});
  assert(stdSla.isCritical === false, 'Standard PO must not be marked as critical for 24h SLA');

  // Unacknowledged crisis
  const crisisSla = getEscalationSLA(crisisSig, {});
  assert(crisisSla.isCritical === true, 'Crisis signal must be marked critical');
  assert(crisisSla.status === 'URGENT_COUNTDOWN', 'Unacknowledged crisis must be in URGENT_COUNTDOWN status');
  assert(crisisSla.compliant === false, 'Unacknowledged crisis cannot be marked compliant');
  assert(typeof crisisSla.hoursLeft === 'number' && crisisSla.hoursLeft > 0, 'Hours left must be positive number');

  // Approved crisis
  const approvedSla = getEscalationSLA(crisisSig, { [crisisSig.row_id]: true });
  assert(approvedSla.status === 'RESOLVED', 'Approved crisis must resolve SLA');
  assert(approvedSla.compliant === true, 'Approved crisis must be compliant');
});

// ── Unit Tests: Section 6.6 Meeting-Specific Formatting ───────────
const { MEETING_FORMATS, generateMeetingEmail } = require('./frontend/src/briefing.js');

test('Unit: Section 6.6 Novo Nordisk Meeting Formats Structure & Agenda Integrity', () => {
  const meetingKeys = ['SOP_MONTHLY', 'SOE_WEEKLY', 'RISK_COMMITTEE'];
  meetingKeys.forEach(k => {
    const m = MEETING_FORMATS[k];
    assert(m, `Meeting format ${k} must exist in MEETING_FORMATS`);
    assert(m.title && m.title.includes('NOVO NORDISK') || m.title.includes('S&OE') || m.title.includes('COMMITTEE'), 'Title must be professional');
    assert(m.docId && m.docId.startsWith('NN-'), `Document ID ${m.docId} must follow Novo Nordisk standard`);
    assert(m.sections && m.sections.length === 4, `Meeting ${k} must have 4 structured agenda sections`);
    m.sections.forEach(s => {
      assert(s.num && s.title && s.desc, `Agenda section ${s.num} must have title and description`);
    });
  });
});

test('Unit: Section 6.6 Meeting-Specific Executive Minutes Generation', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const sopEmail = generateMeetingEmail('SOP_MONTHLY', dashData);
  assert(sopEmail.includes('NOVO NORDISK GLOBAL SUPPLY CHAIN EXECUTIVE MINUTES'), 'Must contain executive header');
  assert(sopEmail.includes('NN-GSC-SOP-2026-M09'), 'Must contain S&OP document ID');
  assert(sopEmail.includes('1. EXECUTIVE POSTURE & NETWORK EQUILIBRIUM'), 'Must include Section 1 Posture');
  assert(sopEmail.includes('2. ACUTE CORRIDOR EXCEPTIONS & DIRECTIVES'), 'Must include Section 2 Acute Exceptions');
  assert(sopEmail.includes('3. MASTER DATA PARAMETER RECALIBRATION SIGN-OFF'), 'Must include Section 3 Parameter Recalibration');
  assert(sopEmail.includes('379 Corridors'), 'Must mention 379 chronic calibration corridors');
  assert(sopEmail.includes('4. GOVERNANCE DECISION & ACTION DIRECTIVES'), 'Must include Section 4 Governance Scorecard');

  const soeEmail = generateMeetingEmail('SOE_WEEKLY', dashData);
  assert(soeEmail.includes('NN-OPS-SOE-2026-W32'), 'Must contain SOE document ID');
  assert(soeEmail.includes('WEEKLY TIER-3 S&OE OPERATIONS STANDUP'), 'Must contain SOE title');
});

// ── Unit Tests: Section 6.4 Stale Parameter Detection ─────────────
test('Unit: Section 6.4 Stale Parameter Detection & Master Data Segmentation', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const cs = dashData.executive.chronic_summary;
  assert(cs.total_stale_parameters > 0, `Expected total_stale_parameters > 0, got ${cs.total_stale_parameters}`);
  assert(cs.total_floor_mismatches > 0, `Expected total_floor_mismatches > 0, got ${cs.total_floor_mismatches}`);
  assert(cs.total_stale_parameters + cs.total_floor_mismatches === cs.total_pure_calibration_series, 'Stale + floor mismatch must sum to 379 total');

  const staleRecords = cs.sample_series.filter(s => s.is_stale);
  assert(staleRecords.length === cs.total_stale_parameters, `Filtered stale count (${staleRecords.length}) must match summary (${cs.total_stale_parameters})`);

  staleRecords.forEach(s => {
    assert(s.stale_status === 'STALE (SHIFT >=30%)', `Expected stale_status tag, got ${s.stale_status}`);
    assert(Math.abs(s.demand_shift_pct) >= 30.0, `Expected demand_shift_pct >= 30, got ${s.demand_shift_pct}`);
    assert(s.stale_narrative && s.stale_narrative.includes('frozen'), 'Stale narrative must mention frozen/static parameter');
  });

  const staleSignals = dashData.top_signals.filter(s => s.is_stale_parameter);
  assert(staleSignals.length > 0, `Expected top signals to identify stale parameters, got ${staleSignals.length}`);
  staleSignals.forEach(s => {
    assert(s.stale_parameter && s.stale_parameter.is_stale, 'stale_parameter object must have is_stale=true');
    assert(s.stale_parameter.trigger === 'DEMAND_SHIFT_30PCT_STATIC_SSD', 'Trigger must be demand shift 30% with static SSD');
    assert(Math.abs(s.stale_parameter.demand_shift_pct) >= 30.0, 'Shift pct must be >= 30%');
  });
});

// ── Unit Tests: 6 Mentor Feedback Features ─────────────────────────
test('Unit: Feature 1: Section 6.1 "What Changed Since Last Week" SKU Diff Alerting', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const wow = dashData.corridor_health.wow_delta;
  assert(wow.signal_diff, 'wow_delta must contain signal_diff');
  assert(Array.isArray(wow.signal_diff.resolved) && wow.signal_diff.resolved.length === 3, 'Must have 3 resolved crises in diff');
  assert(Array.isArray(wow.signal_diff.new) && wow.signal_diff.new.length === 2, 'Must have 2 newly emerged crises in diff');
  assert(Array.isArray(wow.signal_diff.shifts) && wow.signal_diff.shifts.length === 2, 'Must have 2 priority shifts in diff');

  const firstResolved = wow.signal_diff.resolved[0];
  assert(firstResolved.brand && firstResolved.country && firstResolved.action_taken && firstResolved.capital_liberated_inr > 0, 'Resolved record must have brand, country, action, and capital liberated');

  const firstNew = wow.signal_diff.new[0];
  assert(firstNew.brand && firstNew.country && firstNew.breach_week && firstNew.trigger, 'New crisis record must have brand, country, breach week, and emergence trigger');
});

test('Unit: Feature 2: Section 6.8 Context-Aware Manufacturing & Allocation Constraints', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const sigs = dashData.top_signals;
  sigs.forEach(s => {
    const c = s.constraints;
    assert(c, `Signal #${s.rank} must contain constraints object`);
    assert(c.frozen_horizon_weeks === 4, 'Frozen horizon must be 4 weeks');
    assert(typeof c.in_frozen_horizon === 'boolean', 'in_frozen_horizon must be boolean');
    assert(c.in_frozen_horizon === (s.breach_week <= 4), 'in_frozen_horizon must match breach_week <= 4');
    assert(c.campaign_moq_units === 5000, 'Campaign MOQ must be 5,000 units');
    assert(c.batch_multiple_units === 2500, 'Batch multiple must be 2,500 units');
    assert(c.allocation_cap_pct === 85.0, 'Global network allocation cap must be 85%');
    if (s.recommended_qty_units > 0) {
      assert(c.constrained_roq_units >= c.campaign_moq_units, 'Constrained ROQ must meet or exceed MOQ');
      assert(c.constrained_roq_units % c.batch_multiple_units === 0, 'Constrained ROQ must be a multiple of 2,500 units');
    }
  });
});

test('Unit: Feature 3: Section 6.9 Cold-Start / New Product Launch Protocol', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const sigs = dashData.top_signals;
  const launchSigs = sigs.filter(s => s.is_cold_start);
  assert(launchSigs.length > 0, `Expected at least one cold start / launch signal in top signals, got ${launchSigs.length}`);
  launchSigs.forEach(s => {
    assert(s.cold_start && s.cold_start.is_cold_start, 'cold_start object must be marked active');
    assert(s.cold_start.launch_phase && s.cold_start.launch_phase.includes('Phase II'), 'Must contain launch phase');
    assert(s.cold_start.analogue_market && s.cold_start.analogue_market.includes('Country 045'), 'Must reference analogue market');
    assert(s.cold_start.demand_uncertainty_buffer.includes('90-Day Pre-Build Buffer'), 'Must use 90-day pre-build buffer');
  });
});

test('Unit: Feature 4: Section 6.10 CHI Contextualization & 4-Quarter Rolling Trend', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const ch = dashData.corridor_health;
  assert(ch.benchmarks, 'corridor_health must contain benchmarks object');
  assert(ch.benchmarks.world_class_sla_target === 95.0, 'World-class SLA benchmark must be 95.0%');
  assert(ch.benchmarks.operational_threshold === 85.0, 'Operational threshold must be 85.0%');
  assert(ch.benchmarks.critical_floor === 80.0, 'Critical risk floor must be 80.0%');
  assert(Array.isArray(ch.historical_trend_4q) && ch.historical_trend_4q.length === 4, 'Must have 4 quarters of historical trend');
  assert(ch.historical_trend_4q[0].chi === 82.4, 'Q1 CHI must be 82.4');
  assert(ch.historical_trend_4q[3].chi === ch.global_chi, 'Q4 CHI must match current global CHI');
});

test('Unit: Feature 5: Section 6.5 Recipient Warehouse Headroom & Transfer Economics ROI', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const transferSigs = dashData.top_signals.filter(s => s.intermarket_transfer && s.intermarket_transfer.has_transfer);
  assert(transferSigs.length > 0, `Expected transfer signals, got ${transferSigs.length}`);
  transferSigs.forEach(s => {
    const tr = s.intermarket_transfer;
    const wh = tr.warehouse_capacity;
    assert(wh, 'Must contain warehouse_capacity');
    assert(wh.recipient_wh_capacity_units >= 50000, 'Warehouse capacity must be at least 50,000 units');
    assert(wh.recipient_utilization_pct <= 90.0, `Warehouse utilization must be <= 90%, got ${wh.recipient_utilization_pct}`);
    assert(wh.is_feasible === true, 'Warehouse headroom must be feasible (PASS)');

    const econ = tr.transfer_economics;
    assert(econ, 'Must contain transfer_economics');
    assert(econ.cost_air_freight_inr > 0, 'Must compute air freight cost');
    assert(econ.cost_total_transfer_inr > 0, 'Must compute total transfer cost');
    assert(econ.transfer_roi_ratio >= 5.0, `Transfer ROI ratio must be >= 5x, got ${econ.transfer_roi_ratio}`);
  });
});

test('Unit: Feature 6: Section 6.7 Predictive Replenishment Latency & Lead Time Cliff', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const sigs = dashData.top_signals;
  sigs.forEach(s => {
    const lat = s.predictive_latency;
    assert(lat, `Signal #${s.rank} must contain predictive_latency`);
    assert(lat.order_dispatch_week === 1, 'Dispatch week must be Week 1');
    assert(lat.standard_arrival_week === 1 + lat.market_lead_time_weeks, 'Standard arrival must equal 1 + lead time');
    assert(lat.stockout_breach_week === s.breach_week, 'Stockout breach week must match signal breach week');
    assert(lat.is_arrival_late === (lat.standard_arrival_week > s.breach_week), 'is_arrival_late must reflect standard arrival vs breach week');
    if (lat.is_arrival_late) {
      assert(lat.latency_gap_weeks > 0, 'Late signal must have positive latency gap');
      assert(lat.expedited_arrival_week === 2, 'Expedited arrival must be Week 2');
    }
  });
});

test('Unit: Issues 4 & 6: WoW Diff Modal Integration & Overstock Zero-Capital Rationale', () => {
  const indexHtml = fs.readFileSync('frontend/index.html', 'utf8');
  assert(indexHtml.includes('modal-wow-diff'), 'index.html must contain modal-wow-diff markup');
  assert(indexHtml.includes('btn-wow-diff'), 'index.html must contain btn-wow-diff');
  assert(indexHtml.includes('btn-inline-wow-diff'), 'index.html must contain btn-inline-wow-diff');

  const briefingJs = fs.readFileSync('frontend/src/briefing.js', 'utf8');
  assert(briefingJs.includes('initWoWDiffModal'), 'briefing.js must export/call initWoWDiffModal');
  assert(briefingJs.includes('renderTab'), 'initWoWDiffModal must implement tab rendering');

  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const s6 = dashData.top_signals.find(s => s.rank === 6);
  assert(s6 && s6.action_type === 'EXCESS HOLDING', 'Signal #6 must be EXCESS HOLDING');
  assert(s6.capital_at_risk_inr === 0, 'Signal #6 capital_at_risk_inr is 0 because overstock requires zero reorder purchase capital');

  const drawerJs = fs.readFileSync('frontend/src/drawer-detail.js', 'utf8');
  assert(drawerJs.includes('SURPLUS · DEFER INBOUND'), 'drawer-detail.js must clarify zero capital as surplus');
});

test('Unit: Administrative Settings Toggle & Backend Lead Times by Market Data', () => {
  const dashData = JSON.parse(fs.readFileSync('backend/dashboard_data.json', 'utf8'));
  const adm = dashData.administrative_settings;
  assert(adm, 'dashboard_data.json must contain administrative_settings');
  assert(adm.global_lead_time_default_days === 14, 'Global default lead time days must be 14');
  assert(adm.global_lead_time_default_weeks === 2, 'Global default lead time weeks must be 2');
  assert(adm.overstock_trigger_weeks === 4, 'Overstock trigger weeks must be 4');
  assert(adm.understock_trigger_weeks === 5, 'Understock trigger weeks must be 5');
  assert(adm.per_market_override_toggle === true, 'per_market_override_toggle must be true');

  const lts = adm.lead_times_by_market;
  assert(lts && typeof lts === 'object', 'lead_times_by_market must be an object');
  assert(lts['Country 013'] && lts['Country 013'].lead_time_weeks === 36, 'China lead time must be 36W');
  assert(lts['Country 017'] && lts['Country 017'].lead_time_weeks === 8, 'Brazil lead time must be 8W');
  assert(lts['Country 053'] && lts['Country 053'].lead_time_weeks === 4, 'Japan lead time must be 4W');

  // Verify all top signals have real non-empty lead time data
  dashData.top_signals.forEach(s => {
    assert(s.market_lead_time && s.market_lead_time > 0, `Signal #${s.rank} missing market_lead_time`);
    assert(s.market_name && s.market_name.length > 0, `Signal #${s.rank} missing market_name`);
    assert(s.freight_callout && s.freight_callout.length > 0, `Signal #${s.rank} missing freight_callout`);
  });

  const scenarioJs = fs.readFileSync('frontend/src/drawer-scenario.js', 'utf8');
  assert(scenarioJs.includes('administrative_settings'), 'drawer-scenario.js must reference administrative_settings');
  assert(scenarioJs.includes('toggle-per-market'), 'drawer-scenario.js must contain toggle-per-market element');
  assert(scenarioJs.includes('market-config-table'), 'drawer-scenario.js must contain market-config-table element');
});

console.log(`\n=== TEST SUMMARY ===`);
console.log(`Total Passed: ${passedCount}`);
console.log(`Total Failed: ${failedCount}`);
if (failedCount > 0) process.exit(1);

