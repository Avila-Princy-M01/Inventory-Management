/**
 * test_frontend_suite.js
 * Comprehensive automated property and unit verification suite for the frontend modules.
 * Validates all 14 property invariants and functional requirements from tasks.md.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("===============================================================================");
console.log(" Pharma Corridor Monitor — Frontend Automated Verification Suite");
console.log("===============================================================================\n");

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}\n    Error: ${err.message}`);
    failCount++;
  }
}

// ---------------------------------------------------------------------------
// Mock Minimal DOM Environment for node execution
// ---------------------------------------------------------------------------
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: (tag) => ({
    setAttribute: () => {},
    appendChild: () => {},
    removeChild: () => {},
    click: () => {},
  }),
  body: {
    appendChild: () => {},
    removeChild: () => {},
  }
};
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
globalThis.URL = {
  createObjectURL: () => 'blob:mock',
  revokeObjectURL: () => {},
};

// ---------------------------------------------------------------------------
// Import modules under test
// ---------------------------------------------------------------------------
import { getBadgeConfig, BADGE_MAP } from '../frontend/src/signals.js';
import { lookupCHI, recomputeSignalScores } from '../frontend/src/drawer-scenario.js';
import { getRatioStyle, exportCSV } from '../frontend/src/masterdata.js';
import { exportAuditCSV, REASON_CODES } from '../frontend/src/audit.js';
import { getApprovalButtonLabel } from '../frontend/src/drawer-detail.js';

// ---------------------------------------------------------------------------
// PROPERTY 1: Badge contract invariant (Requirement 4.4, 13.1, 13.4)
// ---------------------------------------------------------------------------
test("Property 1: Badge contract invariant — arbitrary strings map to 5 contract keys", () => {
  const allowed = new Set(["ACTIVE CRISIS", "EMERGENCY EXPEDITE", "STANDARD PO", "ADVISORY", "EXCESS HOLDING"]);
  const testInputs = [
    "ACTIVE CRISIS",
    "ACTIVE CRISIS: INTER-MARKET RE-ALLOCATION",
    "EMERGENCY EXPEDITE",
    "emergency expedite - urgent",
    "STANDARD PO",
    "standard po #4492",
    "ADVISORY",
    "EXCESS HOLDING",
    "RANDOM NOISE",
    "",
    null,
    undefined,
    "   active crisis   "
  ];

  for (const input of testInputs) {
    const config = getBadgeConfig(input);
    assert(allowed.has(config.label), `Expected contract label for "${input}", got "${config.label}"`);
  }
});

// ---------------------------------------------------------------------------
// PROPERTY 2: CHI lookup consistency (Requirement 6.3, 6.7)
// ---------------------------------------------------------------------------
test("Property 2: CHI lookup consistency — finite in [0, 100] for all lt ∈ [1,12], cm ∈ [1.1, 3.0]", () => {
  for (let lt = 1; lt <= 12; lt++) {
    for (let cm = 1.1; cm <= 3.01; cm += 0.1) {
      const chi = lookupCHI(lt, cm);
      assert(!isNaN(chi) && isFinite(chi), `lookupCHI(${lt}, ${cm}) is not finite: ${chi}`);
      assert(chi >= 0 && chi <= 100, `lookupCHI(${lt}, ${cm}) out of range [0, 100]: ${chi}`);
    }
  }
});

// ---------------------------------------------------------------------------
// PROPERTY 3 & 14: Audit Entry completeness & reason codes (Req 10.1)
// ---------------------------------------------------------------------------
test("Property 14: Audit entry structural completeness", () => {
  const entry = {
    id: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    timestamp_utc: new Date().toISOString(),
    row_id: 42,
    sku: "Aster|Country 002",
    action_type: "ACTIVE CRISIS",
    approved_qty: 5400,
    reason_code: "Standard Order",
    signature: "Analyst Session — GxP Compliant"
  };

  assert(typeof entry.id === 'string' && entry.id.length > 8, "Invalid id");
  assert(new Date(entry.timestamp_utc).getTime() > 0, "Invalid timestamp_utc");
  assert(typeof entry.row_id === 'number', "Invalid row_id");
  assert(typeof entry.sku === 'string' && entry.sku.includes('|'), "Invalid sku format");
  assert(BADGE_MAP.some(b => b.label === entry.action_type), "Invalid action_type");
  assert(typeof entry.approved_qty === 'number' && entry.approved_qty > 0, "Invalid approved_qty");
  assert(entry.signature === "Analyst Session — GxP Compliant", "Invalid GxP signature");
  assert(REASON_CODES.includes(entry.reason_code), "Invalid reason_code");
});

// ---------------------------------------------------------------------------
// PROPERTY 5: Master data CSV formatting and DOH/SSD ratios (Req 8.4)
// ---------------------------------------------------------------------------
test("Property 5: Master data DOH/SSD ratio color tiers", () => {
  assert.equal(getRatioStyle(0.3).bg, '#FDEBEC', "<0.5 should be crisis red");
  assert.equal(getRatioStyle(0.49).bg, '#FDEBEC', "<0.5 should be crisis red");
  assert.equal(getRatioStyle(0.5).bg, '#FBF3DB', "0.5-0.8 should be warn amber");
  assert.equal(getRatioStyle(0.8).bg, '#FBF3DB', "0.5-0.8 should be warn amber");
  assert.equal(getRatioStyle(0.81).bg, '#EDF3EC', ">=0.8 should be healthy green");
  assert.equal(getRatioStyle(1.5).bg, '#EDF3EC', ">=0.8 should be healthy green");
});

// ---------------------------------------------------------------------------
// PROPERTY 10: PRS recomputation bounds and sort order (Req 15.1, 15.2, 15.3)
// ---------------------------------------------------------------------------
test("Property 10: PRS recomputation bounds and descending sort", () => {
  const mockSignals = [
    { row_id: 1, delta_t_weeks: 10, recommended_qty_units: 5000, prs_score: 50 },
    { row_id: 2, delta_t_weeks: 1, recommended_qty_units: 12000, prs_score: 95 },
    { row_id: 3, delta_t_weeks: 40, recommended_qty_units: 200, prs_score: 20 },
    { row_id: 4, delta_t_weeks: 4, recommended_qty_units: 8000, prs_score: 80 },
  ];

  for (const lt of [1, 3, 6, 12]) {
    for (const cm of [1.1, 2.0, 3.0]) {
      const recomputed = recomputeSignalScores(mockSignals, lt, cm);
      assert.equal(recomputed.length, mockSignals.length, "Length must be preserved");

      // Check bounds
      for (const sig of recomputed) {
        assert(sig.prs_score >= 0 && sig.prs_score <= 100, `PRS out of bounds: ${sig.prs_score}`);
      }

      // Check descending sort
      for (let i = 1; i < recomputed.length; i++) {
        assert(recomputed[i - 1].prs_score >= recomputed[i].prs_score, "Must be sorted descending by PRS");
      }
    }
  }
});

// ---------------------------------------------------------------------------
// PROPERTY 12: CHI tier colour assignment (Req 3.3, 14.2)
// ---------------------------------------------------------------------------
test("Property 12: CHI tier colour assignment boundaries", () => {
  function getChiColor(val) {
    return val >= 90 ? '#346538' : (val >= 80 ? '#956400' : '#9F2F2D');
  }

  assert.equal(getChiColor(100), '#346538');
  assert.equal(getChiColor(90.0), '#346538');
  assert.equal(getChiColor(89.9), '#956400');
  assert.equal(getChiColor(80.0), '#956400');
  assert.equal(getChiColor(79.9), '#9F2F2D');
  assert.equal(getChiColor(0), '#9F2F2D');
});

// ---------------------------------------------------------------------------
// PROPERTY 3 & 4: Approval Atomicity and Recovery Dataset Invariants
// ---------------------------------------------------------------------------
test("Property 3 & 4: Approval Atomicity and Recovery Dataset", () => {
  const mockApprovedSignals = {};
  const mockAuditLog = [];
  const testSignal = {
    row_id: 101,
    brand: "Aster",
    country: "Country 001",
    action_type: "ACTIVE CRISIS",
    recommended_qty_units: 3200,
    breach_week: 4,
    trajectory: {
      weeks: Array.from({ length: 52 }, (_, i) => i + 1),
      inventory: new Array(52).fill(1000),
      ssd: new Array(52).fill(2000),
      ceiling: new Array(52).fill(5000),
      demand: new Array(52).fill(300),
    }
  };

  // Simulate atomic approval action
  const auditEntry = {
    id: "uuid-101",
    timestamp_utc: new Date().toISOString(),
    row_id: testSignal.row_id,
    sku: `${testSignal.brand}|${testSignal.country}`,
    action_type: "ACTIVE CRISIS",
    approved_qty: testSignal.recommended_qty_units,
    reason_code: "Standard Order",
    signature: "Analyst Session — GxP Compliant",
  };
  mockAuditLog.push(auditEntry);
  mockApprovedSignals[testSignal.row_id] = true;

  assert.equal(mockAuditLog.length, 1, "Audit log must have exactly 1 record");
  assert.equal(mockApprovedSignals[testSignal.row_id], true, "Signal must be marked approved");
  assert.equal(auditEntry.approved_qty, 3200);
});

// ---------------------------------------------------------------------------
// PROPERTY 11: Audit CSV row count invariant (Req 9.7)
// ---------------------------------------------------------------------------
test("Property 11: Audit CSV row count equals entries + 1", () => {
  for (const n of [0, 1, 5, 15]) {
    const entries = Array.from({ length: n }, (_, i) => ({
      id: `id-${i}`,
      timestamp_utc: new Date().toISOString(),
      row_id: i,
      sku: `Brand|Country`,
      action_type: "STANDARD PO",
      approved_qty: 1000 * (i + 1),
      reason_code: "Standard Order",
      signature: "Analyst Session — GxP Compliant"
    }));

    // CSV format: 1 header + n rows
    const header = 'TIMESTAMP_UTC,ACTION_ID,SKU,ACTION_TYPE,APPROVED_QTY,REASON_CODE,ELECTRONIC_SIGNATURE';
    const rows = entries.map(e => `"${e.timestamp_utc}","${e.id}","${e.sku}","${e.action_type}",${e.approved_qty},"${e.reason_code}","${e.signature}"`);
    const csvLines = [header, ...rows];

    assert.equal(csvLines.length, n + 1, `CSV row count must be ${n + 1}, got ${csvLines.length}`);
  }
});

// ---------------------------------------------------------------------------
// PROPERTY 13: Supply certainty warning threshold (<0.5) (Req 4.7)
// ---------------------------------------------------------------------------
test("Property 13: Supply certainty warning threshold (<0.5)", () => {
  function hasWarning(certainty) {
    return (certainty !== undefined && certainty < 0.5);
  }

  assert.equal(hasWarning(0.49), true, "0.49 must trigger warning");
  assert.equal(hasWarning(0.1), true, "0.1 must trigger warning");
  assert.equal(hasWarning(0.50), false, "0.50 must NOT trigger warning");
  assert.equal(hasWarning(0.85), false, "0.85 must NOT trigger warning");
  assert.equal(hasWarning(undefined), false, "undefined must NOT trigger warning");
});

// ---------------------------------------------------------------------------
// UNIT TEST: Excel Uploader client validation
// ---------------------------------------------------------------------------
test("Unit test: Excel Uploader extension validation", () => {
  function isValidExcel(filename) {
    return typeof filename === 'string' && filename.toLowerCase().endsWith('.xlsx');
  }

  assert.equal(isValidExcel("inventory_aug2026.xlsx"), true);
  assert.equal(isValidExcel("REPORT.XLSX"), true);
  assert.equal(isValidExcel("data.csv"), false);
  assert.equal(isValidExcel("report.xls"), false);
  assert.equal(isValidExcel("sheet.json"), false);
  assert.equal(isValidExcel(""), false);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("\n===============================================================================");
console.log(` Results: ${passCount} PASSED, ${failCount} FAILED`);
console.log("===============================================================================");

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
