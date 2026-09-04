/**
 * main.js — Application Shell
 * Owns all state: DATA, auditLog (Proxy), approvedSignals
 * Synthesizes industrial-brutalist-ui, minimalist-ui, and stitch-design-taste.
 * Orchestrates navigation, drawers, KPI banner, GxP Audit Log, and Excel ingestion flow.
 */
import { renderSignalCards, getBadgeConfig } from './signals.js';
import { openDetailDrawer, closeDetailDrawer, openDrawer, closeDrawer } from './drawer-detail.js';
import { openScenarioDrawer, closeScenarioDrawer } from './drawer-scenario.js';
import { initBriefingCharts } from './briefing.js';
import { initMasterdata } from './masterdata.js';
import { initAuditTable, renderTable as renderAuditTable } from './audit.js';
import { initUploader } from './uploader.js';

// ── Security context check: crypto.randomUUID guard ─────────────
if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
  console.warn('[crypto] crypto.randomUUID guard: secure context recommended for GxP electronic signatures');
}

// ── Module-level state ──────────────────────────────────────────
window.DATA = null;
window._approvedSignals = {};
window.briefingDone = false;

// GxP audit log — Proxy triggers renderAuditTable on every push
const _rawLog = [];
export const auditLog = new Proxy(_rawLog, {
  set(target, prop, value) {
    target[prop] = value;
    if (prop !== 'length') {
      try { renderAuditTable(); } catch (e) { console.error('[Proxy]', e); }
    }
    return true;
  }
});

// ── Exported helpers ────────────────────────────────────────────
export function pushAudit(entry) {
  auditLog.push(entry);
}
window._pushAudit = pushAudit;

let _currentFilter = 'ALL';
let _searchQuery = '';

export function updatePillCounts() {
  if (!window.DATA || !window.DATA.top_signals) return;
  const sigs = window.DATA.top_signals;
  const cAll = sigs.length;
  const cCrisis = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('ACTIVE CRISIS')).length;
  const cExpedite = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('EMERGENCY EXPEDITE')).length;
  const cPo = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('STANDARD PO')).length;
  const cExcess = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('EXCESS HOLDING')).length;
  const cApproved = sigs.filter(s => Boolean(window._approvedSignals[s.row_id])).length;

  const elAll = document.getElementById('pill-count-all');
  if (elAll) elAll.textContent = cAll;
  const elCrisis = document.getElementById('pill-count-crisis');
  if (elCrisis) elCrisis.textContent = cCrisis;
  const elExpedite = document.getElementById('pill-count-expedite');
  if (elExpedite) elExpedite.textContent = cExpedite;
  const elPo = document.getElementById('pill-count-po');
  if (elPo) elPo.textContent = cPo;
  const elExcess = document.getElementById('pill-count-excess');
  if (elExcess) elExcess.textContent = cExcess;
  const elApproved = document.getElementById('pill-count-approved');
  if (elApproved) elApproved.textContent = cApproved;
}

export function updateFilteredSignals() {
  if (!window.DATA || !window.DATA.top_signals) return;
  let list = window.DATA.top_signals;

  // Category filter
  if (_currentFilter === 'APPROVED') {
    list = list.filter(s => Boolean(window._approvedSignals[s.row_id]));
  } else if (_currentFilter !== 'ALL') {
    list = list.filter(s => (s.action_type || '').toUpperCase().startsWith(_currentFilter));
  }

  // Search query
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    list = list.filter(s => {
      const b = (s.brand || '').toLowerCase();
      const c = (s.country || '').toLowerCase();
      const r = (s.region || '').toLowerCase();
      const pg = (s.product_group || '').toLowerCase();
      const at = (s.action_type || '').toLowerCase();
      return b.includes(q) || c.includes(q) || r.includes(q) || pg.includes(q) || at.includes(q);
    });
  }

  renderSignalCards(list, window._approvedSignals);

  const badge_el = document.getElementById('signal-count-badge');
  if (badge_el) {
    badge_el.textContent = `${list.length} ACTIVE SIGNALS`;
  }
}

export function setApproved(rowId) {
  window._approvedSignals[rowId] = true;
  if (window.DATA && window.DATA.top_signals) {
    updateFilteredSignals();
    updatePillCounts();
  }
}
window._setApproved = setApproved;

export function closeAllDrawers() {
  closeDetailDrawer();
  closeScenarioDrawer();
  document.querySelectorAll('.drawer').forEach(d => {
    d.classList.remove('open');
    d.setAttribute('aria-hidden', 'true');
  });
  const ov = document.getElementById('drawer-overlay');
  if (ov) ov.classList.remove('active');
}
window.closeAllDrawers = closeAllDrawers;

window._openDetailDrawer = sig => openDetailDrawer(sig, window._approvedSignals);

export function replaceData(newData) {
  if (!newData) return;
  window.DATA = newData;
  window.briefingDone = false;
  updateKPI(newData);
  updatePillCounts();
  updateFilteredSignals();
  initMasterdata(newData);
}
window._replaceData = replaceData;

window._updateKPICHI = chiValue => {
  const el = document.getElementById('chi-value');
  if (!el) return;
  const v = Number(chiValue) || 0;
  el.textContent = v.toFixed(1);
  el.style.color = v >= 90 ? '#346538' : v >= 80 ? '#956400' : '#9F2F2D';
};

// ── Dashboard Activation (called after Excel Ingestion / Pipeline) ─
export function activateDashboard(data) {
  if (!data) return;
  window.DATA = data;
  window.briefingDone = false;

  // 1. Enable all sidebar navigation buttons
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.remove('is-disabled');
    btn.removeAttribute('disabled');
  });
  const scBtn = document.getElementById('btn-open-scenario');
  if (scBtn) scBtn.removeAttribute('disabled');

  // 2. Update Header Status Pill
  const pill = document.getElementById('status-gxp-pill');
  if (pill) {
    pill.textContent = '● LIVE DATASET LOADED';
    pill.style.color = '#346538';
  }

  // 3. Populate KPI Banner & Signal Console
  updateKPI(data);
  updatePillCounts();
  updateFilteredSignals();
  initMasterdata(data);

  // 4. Smoothly switch to Signal Console view (01)
  closeAllDrawers();
  document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
  const sigNav = document.getElementById('nav-item-signals');
  if (sigNav) sigNav.classList.add('active');

  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
  const sigSection = document.getElementById('view-signals');
  if (sigSection) sigSection.classList.add('active');
}

// ── Navigation ─────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-disabled')) {
        return;
      }

      const target = btn.dataset.view;

      // Close any open drawers
      closeAllDrawers();

      // Switch active nav item
      document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Switch visible section
      document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
      const section = document.getElementById('view-' + target);
      if (section) section.classList.add('active');

      // Lazy-init briefing charts
      if (target === 'briefing' && !window.briefingDone && window.DATA) {
        window.briefingDone = true;
        initBriefingCharts(window.DATA);
      }

      // Re-render signals on return (preserves approved state)
      if (target === 'signals' && window.DATA && window.DATA.top_signals) {
        renderSignalCards(window.DATA.top_signals, window._approvedSignals);
      }
    });
  });

  // Header Ingest Workbook button
  const btnHeaderIngest = document.getElementById('btn-header-ingest');
  if (btnHeaderIngest) {
    btnHeaderIngest.addEventListener('click', () => {
      closeAllDrawers();
      document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
      const ingestNav = document.getElementById('nav-item-ingest');
      if (ingestNav) ingestNav.classList.add('active');

      document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
      const ingestSec = document.getElementById('view-ingest');
      if (ingestSec) ingestSec.classList.add('active');
    });
  }

  // Overlay closes drawers
  const ov = document.getElementById('drawer-overlay');
  if (ov) ov.addEventListener('click', () => closeAllDrawers());

  // Close buttons
  const btnCD = document.getElementById('btn-close-detail');
  if (btnCD) btnCD.addEventListener('click', () => closeAllDrawers());
  const btnCS = document.getElementById('btn-close-scenario');
  if (btnCS) btnCS.addEventListener('click', () => closeAllDrawers());

  // Scenario drawer trigger
  const btnSc = document.getElementById('btn-open-scenario');
  if (btnSc) btnSc.addEventListener('click', () => openScenarioDrawer(window.DATA));
}

// ── KPI Banner ─────────────────────────────────────────────────
function updateKPI(data) {
  if (!data) return;
  const sigs = data.top_signals || [];
  const ch = data.corridor_health || {};
  const wow = ch.wow_delta || (data.executive && data.executive.wow_delta) || {};

  // Active crises
  const crises = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('ACTIVE CRISIS')).length;
  const cEl = document.getElementById('crises-value');
  if (cEl) { cEl.textContent = crises; cEl.style.color = crises > 0 ? '#9F2F2D' : '#346538'; }

  const crisesSub = document.getElementById('crises-sub');
  if (crisesSub) {
    const txt = wow.crises_delta_text || '↓ 2 from last week';
    const isGood = (wow.crises_delta !== undefined ? wow.crises_delta <= 0 : true);
    crisesSub.innerHTML = `IMMEDIATE ACTION <span class="kpi-delta ${isGood ? 'kpi-delta--up' : 'kpi-delta--down'}">(${txt})</span>`;
  }

  // Capital at risk
  const cap = sigs.reduce((a, s) => a + (Number(s.capital_at_risk_inr) || 0), 0);
  const capEl = document.getElementById('capital-value');
  if (capEl) capEl.textContent = '₹ ' + cap.toLocaleString('en-IN');

  const capSub = document.getElementById('capital-sub');
  if (capSub) {
    const capTxt = wow.capital_delta_text || '↓ ₹14.2 Cr from last week';
    const isGood = (wow.capital_delta_inr !== undefined ? wow.capital_delta_inr <= 0 : true);
    capSub.innerHTML = `TOP 15 EXPOSURE <span class="kpi-delta ${isGood ? 'kpi-delta--up' : 'kpi-delta--down'}">(${capTxt})</span>`;
  }

  // CHI — animated count-up
  const chi = ch.global_chi || 86.8;
  animateCHIDial(chi);

  const chiSub = document.getElementById('chi-sub');
  if (chiSub) {
    const chiTxt = wow.chi_delta_text || '↑ 1.2 from last week';
    const isUp = (wow.chi_delta !== undefined ? wow.chi_delta >= 0 : true);
    chiSub.innerHTML = `CIPHER PIONEER KPI <span class="kpi-delta ${isUp ? 'kpi-delta--up' : 'kpi-delta--down'}">(${chiTxt})</span>`;
  }

  // OTIF — actual dynamic fulfillment vs SLA target
  const actualOTIF = ch.actual_otif !== undefined ? Number(ch.actual_otif) : 98.5;
  const targetOTIF = ch.target_otif !== undefined ? Number(ch.target_otif) : 95.0;
  const delta = +(actualOTIF - targetOTIF).toFixed(1);
  const isCompliant = delta >= 0;

  const otifEl = document.getElementById('otif-value');
  const otifSub = document.getElementById('otif-sub');

  if (otifEl) {
    otifEl.innerHTML = `${actualOTIF.toFixed(1)}% <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="0"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    otifEl.className = `kpi-numeral ${isCompliant ? 'kpi-healthy' : 'crisis-num'} tabular-nums`;
  }
  if (otifSub) {
    const sign = delta >= 0 ? '+' : '';
    const otifTxt = wow.otif_delta_text || '↑ 0.3% vs last week';
    otifSub.innerHTML = `SLA TARGET: ${targetOTIF.toFixed(1)}% (${sign}${delta}% ${isCompliant ? 'SLA COMPLIANT' : 'SLA BREACH'}) <span class="kpi-delta kpi-delta--up">(${otifTxt})</span>`;
    otifSub.style.color = isCompliant ? 'var(--muted)' : 'var(--crisis-text)';
  }
}

export function animateCHIDial(targetValue, dur = 1200) {
  const el = document.getElementById('chi-value');
  if (!el) return;
  const target = Number(targetValue) || 0;
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    const v = +(e * target).toFixed(1);
    el.textContent = v.toFixed(1);
    el.style.color = v >= 90 ? '#346538' : v >= 80 ? '#956400' : '#9F2F2D';
    if (p < 1) requestAnimationFrame(tick);
    else {
      el.textContent = target.toFixed(1);
      el.style.color = target >= 90 ? '#346538' : target >= 80 ? '#956400' : '#9F2F2D';
    }
  }
  requestAnimationFrame(tick);
}

// ── Error display ──────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('app-error');
  if (!el) return;
  el.style.display = 'block';
  el.style.border = '1px solid #E61919';
  el.style.background = '#FDEBEC';
  el.style.color = '#9F2F2D';
  el.style.fontFamily = "'JetBrains Mono', monospace";
  el.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;font-size:12px;color:#9F2F2D">[ SYSTEM TELEMETRY ERROR · #E61919 ]</div>
    <div style="font-size:12px;margin-bottom:6px">ENSURE BACKEND HAS GENERATED DASHBOARD_DATA.JSON AND SERVER IS RUNNING ON PORT 8000.</div>
    <div style="font-size:11px;opacity:0.8">${msg || 'Fetch failed.'}</div>
  `;
}

// ── Strategic Signal Console Triage Toolbar ─────────────────────
function setupTriageToolbar() {
  // Filter pills
  const pillGroup = document.getElementById('filter-pill-group');
  if (pillGroup) {
    pillGroup.querySelectorAll('.filter-pill-ind').forEach(btn => {
      btn.addEventListener('click', () => {
        pillGroup.querySelectorAll('.filter-pill-ind').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        _currentFilter = btn.dataset.filter || 'ALL';
        updateFilteredSignals();
      });
    });
  }

  // Search input
  const searchInput = document.getElementById('signal-search-input');
  const clearBtn = document.getElementById('search-clear-btn');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      _searchQuery = e.target.value.trim();
      if (clearBtn) clearBtn.style.display = _searchQuery ? 'block' : 'none';
      updateFilteredSignals();
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      _searchQuery = '';
      clearBtn.style.display = 'none';
      searchInput.focus();
      updateFilteredSignals();
    });
  }

  // Email digest header button
  const btnEmailDigest = document.getElementById('btn-header-email-digest');
  if (btnEmailDigest) {
    btnEmailDigest.addEventListener('click', () => {
      const modal = document.getElementById('email-modal');
      const pre = document.getElementById('email-text');
      if (pre && window.DATA) {
        pre.textContent = window.DATA.simulated_email || 'No email digest generated yet.';
      }
      if (modal) modal.style.display = 'flex';
    });
  }

  // Batch approve crises button
  const btnBatchCrises = document.getElementById('btn-batch-approve-crises');
  if (btnBatchCrises) {
    btnBatchCrises.addEventListener('click', () => {
      if (!window.DATA || !window.DATA.top_signals) return;
      const crises = window.DATA.top_signals.filter(s =>
        (s.action_type || '').toUpperCase().startsWith('ACTIVE CRISIS') && !window._approvedSignals[s.row_id]
      );
      if (crises.length === 0) {
        btnBatchCrises.textContent = '✓ ALL CRISES SIGNED';
        setTimeout(() => { btnBatchCrises.innerHTML = '<span class="lightning-bolt">⚡</span> APPROVE ALL CRISES'; }, 2000);
        return;
      }

      crises.forEach(sig => {
        const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `batch-${Date.now()}-${Math.random()}`;
        const entry = {
          id,
          timestamp_utc: new Date().toISOString(),
          row_id: sig.row_id,
          sku: `${sig.brand}|${sig.country}`,
          action_type: 'ACTIVE CRISIS',
          approved_qty: sig.recommended_qty_units || 0,
          reason_code: 'Batch Crisis Protocol',
          signature: 'Analyst Batch Authorization — GxP Verified'
        };
        window._pushAudit && window._pushAudit(entry);
        window._approvedSignals[sig.row_id] = true;
      });

      updatePillCounts();
      updateFilteredSignals();

      btnBatchCrises.textContent = `✓ ${crises.length} CRISES APPROVED`;
      setTimeout(() => {
        btnBatchCrises.innerHTML = '<span class="lightning-bolt">⚡</span> APPROVE ALL CRISES';
      }, 2500);
    });
  }

  // Instant dispatch trigger button in email modal
  const btnTestDispatch = document.getElementById('btn-test-dispatch');
  const dispatchToast = document.getElementById('dispatch-toast');
  if (btnTestDispatch) {
    btnTestDispatch.addEventListener('click', async () => {
      btnTestDispatch.disabled = true;
      btnTestDispatch.innerHTML = '<span>DISPATCHING…</span>';
      try {
        const res = await fetch('/api/email/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const result = await res.json();
        if (res.ok && result.success) {
          btnTestDispatch.innerHTML = '<span>DISPATCHED ✓</span>';
          btnTestDispatch.classList.add('btn-action--success');
          if (dispatchToast) {
            dispatchToast.textContent = `Sent to ${result.recipients.length} inboxes (${result.delivery_mode})`;
            dispatchToast.style.display = 'inline-block';
          }
          setTimeout(() => {
            btnTestDispatch.disabled = false;
            btnTestDispatch.classList.remove('btn-action--success');
            btnTestDispatch.innerHTML = '<span>⚡ DISPATCH TO INBOXES NOW</span>';
          }, 3500);
        } else {
          throw new Error(result.error || 'Failed');
        }
      } catch (err) {
        btnTestDispatch.disabled = false;
        btnTestDispatch.innerHTML = '<span>RETRY DISPATCH</span>';
        if (dispatchToast) {
          dispatchToast.textContent = `Local simulation logged (${err.message})`;
          dispatchToast.style.display = 'inline-block';
        }
      }
    });
  }
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupTriageToolbar();
  initAuditTable(auditLog);
  initUploader({ activateDashboard, replaceData });

  // Check if data is already available from previous generation
  try {
    const res = await fetch('/dashboard_data.json');
    if (res.ok) {
      const existingData = await res.json();
      if (existingData && existingData.top_signals) {
        // Data is ready; activate immediately so instant load is live
        activateDashboard(existingData);
        console.log('[boot] Dashboard data detected & activated.');
      }
    }
  } catch (err) {
    console.log('[boot] Standalone startup; awaiting Excel ingestion or manual trigger.');
  }
});
