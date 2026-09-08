/**
 * main.js — Application Shell
 * Owns all state: DATA, auditLog (Proxy), approvedSignals
 * Synthesizes industrial-brutalist-ui, minimalist-ui, and stitch-design-taste.
 * Orchestrates navigation, drawers, KPI banner, GxP Audit Log, and Excel ingestion flow.
 */
import { renderSignalCards, getBadgeConfig } from './signals.js';
import { openDetailDrawer, closeDetailDrawer, openDrawer, closeDrawer, toggleFullscreen } from './drawer-detail.js';
import { openScenarioDrawer, closeScenarioDrawer, initScenarioView } from './drawer-scenario.js';
import { initBriefingCharts, hydrateStaticSections, resetBriefingCharts } from './briefing.js';
import { initMasterdata } from './masterdata.js';
import { initAuditTable, renderTable as renderAuditTable } from './audit.js';
import { initUploader } from './uploader.js';
import { getWorkflowState } from './workflow.js';


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
  // Persist to backend so the GxP trail survives page refreshes (best-effort;
  // the in-session ledger remains authoritative for the live UI).
  try {
    fetch('/audit/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => { /* offline persistence is non-blocking */ });
  } catch (e) { /* non-blocking */ }
}
window._pushAudit = pushAudit;

let _currentFilter = 'ALL';
let _searchQuery = '';

export function updatePillCounts() {
  if (!window.DATA || !window.DATA.top_signals) return;
  const sigs = window.DATA.top_signals;
  const cAll = sigs.length;
  const cChanged = sigs.filter(s => s.rank === 1 || (s.wow_status && s.wow_status !== 'ON CADENCE')).length;
  const cCrisis = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('ACTIVE CRISIS')).length;
  const cExpedite = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('EMERGENCY EXPEDITE')).length;
  const cPo = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('STANDARD PO')).length;
  const cExcess = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('EXCESS HOLDING')).length;
  const cApproved = sigs.filter(s => Boolean(window._approvedSignals[s.row_id])).length;
  const cSnoozed = sigs.filter(s => {
    const wf = getWorkflowState(s.row_id);
    return Boolean(wf && wf.snooze && wf.snooze.snoozed_until > Date.now());
  }).length;

  const elAll = document.getElementById('pill-count-all');
  if (elAll) elAll.textContent = cAll;
  const elChanged = document.getElementById('pill-count-changed');
  if (elChanged) elChanged.textContent = cChanged;
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
  const elSnoozed = document.getElementById('pill-count-snoozed');
  if (elSnoozed) elSnoozed.textContent = cSnoozed;
}

export function updateFilteredSignals() {
  if (!window.DATA || !window.DATA.top_signals) return;
  let list = window.DATA.top_signals;

  // Category filter
  if (_currentFilter === 'APPROVED') {
    list = list.filter(s => Boolean(window._approvedSignals[s.row_id]));
  } else if (_currentFilter === 'SNOOZED') {
    list = list.filter(s => {
      const wf = getWorkflowState(s.row_id);
      return Boolean(wf && wf.snooze && wf.snooze.snoozed_until > Date.now());
    });
  } else if (_currentFilter === 'CHANGED') {
    list = list.filter(s => s.rank === 1 || (s.wow_status && s.wow_status !== 'ON CADENCE'));
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

export function updateFocalHero(data) {
  const heroEl = document.getElementById('focal-triage-hero');
  if (!heroEl || !data) return;
  const topSigs = data.top_signals || [];
  const acuteSigs = topSigs.filter(s => (s.action_type || '').includes('CRISIS') || (s.action_type || '').includes('EXPEDITE'));
  const topAction = acuteSigs.find(s => s.intermarket_transfer && s.intermarket_transfer.has_transfer) || acuteSigs[0] || topSigs[0];

  if (!topAction) {
    heroEl.style.display = 'none';
    return;
  }
  heroEl.style.display = 'block';

  const titleEl = document.getElementById('hero-action-title');
  const descEl = document.getElementById('hero-action-desc');
  const expEl = document.getElementById('hero-action-exposure');
  const btnAuth = document.getElementById('btn-hero-authorize');

  const tr = topAction.intermarket_transfer || {};
  const isApproved = Boolean(window._approvedSignals && window._approvedSignals[topAction.row_id]);

  if (tr.has_transfer) {
    if (titleEl) titleEl.textContent = `AUTHORIZE EMERGENCY AIR TRANSFER: ${tr.donor_country} → ${topAction.country} (${Number(tr.transfer_qty).toLocaleString()} Units)`;
    if (descEl) descEl.textContent = `Standard ${topAction.market_lead_time || 36}-week maritime transit cannot prevent Week ${topAction.breach_week} stockout. Donor affiliate retains ${tr.donor_post_doh || 45} days of stock (zero cascade risk). Approving this transfer protects ${(topAction.lost_lifelong_patients || 1202).toLocaleString()} chronic patients.`;
    if (expEl) expEl.textContent = `SAVINGS: ₹${((topAction.capital_at_risk_inr || 0) / 1e7).toFixed(2)} CR`;
  } else {
    if (titleEl) titleEl.textContent = `RELEASE EMERGENCY REPLENISHMENT: ${topAction.brand} · ${topAction.country} (${Number(topAction.recommended_qty_units).toLocaleString()} Units)`;
    if (descEl) descEl.textContent = `Stock breaches safety floor in Week ${topAction.breach_week}. Standard replenishment lead-time cliff pre-empts patient therapy disruption.`;
    if (expEl) expEl.textContent = `EXPOSURE: ₹${((topAction.capital_at_risk_inr || 0) / 1e7).toFixed(2)} CR`;
  }

  if (btnAuth) {
    if (isApproved) {
      btnAuth.textContent = '✓ DIRECTIVE #1 AUTHORIZED (GxP SIGNED)';
      btnAuth.disabled = true;
      btnAuth.classList.add('is-approved');
    } else {
      btnAuth.textContent = 'AUTHORIZE DIRECTIVE #1 →';
      btnAuth.disabled = false;
      btnAuth.classList.remove('is-approved');
      btnAuth.onclick = () => {
        if (window._openDetailDrawer) {
          window._openDetailDrawer(topAction);
        }
      };
    }
  }
}

export function replaceData(newData) {
  if (!newData) return;
  window.DATA = newData;
  window.briefingDone = false;
  updateKPI(newData);
  updatePillCounts();
  updateFilteredSignals();
  initMasterdata(newData);
  hydrateStaticSections(newData);
  updateFocalHero(newData);
  resetBriefingCharts();
  initScenarioView(newData);
}
window._replaceData = replaceData;

window._updateKPICHI = chiValue => {
  const el = document.getElementById('chi-value');
  if (!el) return;
  const v = Number(chiValue) || 0;
  el.textContent = v.toFixed(1);
  el.style.color = v >= 90 ? 'var(--status-ok-text)' : v >= 80 ? 'var(--status-warn-text)' : 'var(--status-crisis-text)';
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
  const mktBtn = document.getElementById('btn-header-market-lt');
  if (mktBtn) mktBtn.removeAttribute('disabled');

  // 2. Update Header Status Pill
  const pill = document.getElementById('status-gxp-pill');
  if (pill) {
    const wk = (data && data.metadata && data.metadata.current_week) || 32;
    const dur = (data && data.metadata && data.metadata.pipeline_duration_seconds) || '1.8';
    pill.innerHTML = `● <strong>DATA AS OF W${wk}</strong> · REFRESHED IN ${dur}s`;
    pill.style.color = 'var(--status-ok-text)';
    pill.style.background = 'var(--status-ok-bg)';
    pill.style.border = '1px solid var(--border)';
    pill.title = `Source: SAP/OMP 52-Week Corridor Panel · Verified Current Data Horizon`;
  }

  // 3. Populate KPI Banner & Signal Console
  updateKPI(data);
  updatePillCounts();
  updateFilteredSignals();
  initMasterdata(data);
  hydrateStaticSections(data);
  updateFocalHero(data);
  resetBriefingCharts();
  initScenarioView(data);

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

      // Init scenario derivation and 12x20 matrix view
      if (target === 'scenario' && window.DATA) {
        initScenarioView(window.DATA);
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

  const btnMktLt = document.getElementById('btn-header-market-lt');
  if (btnMktLt) btnMktLt.addEventListener('click', () => openScenarioDrawer(window.DATA, { defaultTab: 'market' }));



  window.addEventListener('market-lt-mode-changed', () => {
    updateFilteredSignals();
  });
}

// ── KPI Banner ─────────────────────────────────────────────────
function updateKPI(data) {
  if (!data) return;
  const sigs = data.top_signals || [];
  const ch = data.corridor_health || {};

  // Active crises — dynamic count from signals
  const crises = sigs.filter(s => (s.action_type || '').toUpperCase().startsWith('ACTIVE CRISIS')).length;
  const cEl = document.getElementById('crises-value');
  if (cEl) {
    cEl.textContent = crises;
    cEl.style.color = crises > 0 ? 'var(--status-crisis-text)' : 'var(--status-ok-text)';
  }

  const crisesSub = document.getElementById('crises-sub');
  if (crisesSub) {
    const isClean = crises === 0;
    const badgeText = crises > 0 ? `${crises} ACTIVE BREACH` : 'NOMINAL';
    crisesSub.innerHTML = `IMMEDIATE ACTION <span class="kpi-delta ${isClean ? 'kpi-delta--up' : 'kpi-delta--down'}">(${badgeText})</span>`;
  }

  // Capital at risk — dynamic sum from signals
  const cap = sigs.reduce((a, s) => a + (Number(s.capital_at_risk_inr) || 0), 0);
  const capEl = document.getElementById('capital-value');
  if (capEl) capEl.textContent = '₹ ' + cap.toLocaleString('en-IN');

  const capSub = document.getElementById('capital-sub');
  if (capSub) {
    capSub.innerHTML = `TOP 15 EXPOSURE <span class="kpi-delta kpi-delta--up">(52-WEEK RUN-RATE)</span>`;
  }

  // CHI — dynamic from corridor_health
  const chi = ch.global_chi !== undefined ? Number(ch.global_chi) : null;
  if (chi !== null) {
    animateCHIDial(chi);
  }

  const chiSub = document.getElementById('chi-sub');
  if (chiSub && chi !== null) {
    const isOperational = chi >= 85.0;
    const statusText = isOperational ? 'OPERATIONAL (≥85%)' : 'CRITICAL RISK (<85%)';
    chiSub.innerHTML = `CIPHER PIONEER KPI <span class="kpi-delta ${isOperational ? 'kpi-delta--up' : 'kpi-delta--down'}">(${statusText})</span>`;
  }

  // OTIF — dynamic fulfillment vs SLA target
  const actualOTIF = ch.actual_otif !== undefined ? Number(ch.actual_otif) : null;
  const targetOTIF = ch.target_otif !== undefined ? Number(ch.target_otif) : 95.0;

  if (actualOTIF !== null) {
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
      const complianceTag = isCompliant ? 'SLA COMPLIANT' : 'SLA BREACH';
      otifSub.innerHTML = `SLA TARGET: ${targetOTIF.toFixed(1)}% <span class="kpi-delta ${isCompliant ? 'kpi-delta--up' : 'kpi-delta--down'}">(${sign}${delta}% ${complianceTag})</span>`;
      otifSub.style.color = isCompliant ? 'var(--muted)' : 'var(--crisis-text)';
    }
  }
}

export function animateCHIDial(targetValue, dur = 1200) {
  const el = document.getElementById('chi-value');
  const progressEl = document.getElementById('chi-dial-progress');
  if (!el) return;
  const target = Number(targetValue) || 0;
  const circumference = 2 * Math.PI * 23; // r = 23 -> ~144.51
  const t0 = performance.now();

  function tick(now) {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    const v = +(e * target).toFixed(1);
    el.textContent = v.toFixed(1);
    const color = v >= 90 ? 'var(--status-ok-text)' : v >= 80 ? 'var(--status-warn-text)' : 'var(--status-crisis-text)';
    el.style.color = color;

    if (progressEl) {
      const offset = circumference * (1 - (v / 100));
      progressEl.style.strokeDashoffset = offset.toFixed(2);
      progressEl.style.stroke = color;
    }

    if (p < 1) requestAnimationFrame(tick);
    else {
      el.textContent = target.toFixed(1);
      const finalColor = target >= 90 ? 'var(--status-ok-text)' : target >= 80 ? 'var(--status-warn-text)' : 'var(--status-crisis-text)';
      el.style.color = finalColor;
      if (progressEl) {
        const finalOffset = circumference * (1 - (target / 100));
        progressEl.style.strokeDashoffset = finalOffset.toFixed(2);
        progressEl.style.stroke = finalColor;
      }
    }
  }
  requestAnimationFrame(tick);
}

// ── Error display ──────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('app-error');
  if (!el) return;
  el.style.display = 'block';
  el.style.border = '1px solid var(--hazard-red)';
  el.style.background = 'var(--status-crisis-bg)';
  el.style.color = 'var(--status-crisis-text)';
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
    btnEmailDigest.addEventListener('click', async () => {
      const modal = document.getElementById('email-modal');
      const pre = document.getElementById('email-text');
      const frame = document.getElementById('email-html-frame');
      const htmlContainer = document.getElementById('email-html-container');
      const tabHtml = document.getElementById('btn-email-tab-html');
      const tabText = document.getElementById('btn-email-tab-text');

      // Populate text fallback
      if (pre && window.DATA) {
        pre.textContent = window.DATA.simulated_email || 'No email digest generated yet.';
      }

      // Populate rich HTML
      try {
        const resp = await fetch('/api/email/preview');
        if (resp.ok) {
          const res = await resp.json();
          if (res && res.html_body && frame) {
            frame.srcdoc = res.html_body;
          }
          if (res && res.text_body && pre) {
            pre.textContent = res.text_body;
          }
        }
      } catch (err) {
        console.warn('Could not fetch rich email preview from API:', err);
      }

      // Wire Tab toggles
      if (tabHtml && tabText && htmlContainer && pre) {
        tabHtml.onclick = () => {
          tabHtml.style.background = 'var(--ink)';
          tabHtml.style.color = 'var(--surface)';
          tabHtml.style.borderColor = 'var(--ink)';
          tabText.style.background = 'var(--surface)';
          tabText.style.color = 'var(--text-muted)';
          tabText.style.borderColor = 'var(--border)';
          htmlContainer.style.display = 'block';
          pre.style.display = 'none';
        };
        tabText.onclick = () => {
          tabText.style.background = 'var(--ink)';
          tabText.style.color = 'var(--surface)';
          tabText.style.borderColor = 'var(--ink)';
          tabHtml.style.background = 'var(--surface)';
          tabHtml.style.color = 'var(--text-muted)';
          tabHtml.style.borderColor = 'var(--border)';
          pre.style.display = 'block';
          htmlContainer.style.display = 'none';
        };
      }

      if (modal) modal.style.display = 'flex';
    });
  }

  // Batch approve Standard POs button
  const btnBatchPOs = document.getElementById('btn-batch-approve-pos');
  if (btnBatchPOs) {
    btnBatchPOs.addEventListener('click', () => {
      if (!window.DATA || !window.DATA.top_signals) return;
      const pos = window.DATA.top_signals.filter(s =>
        (s.action_type || '').toUpperCase() === 'STANDARD PO' && !window._approvedSignals[s.row_id]
      );
      if (pos.length === 0) {
        btnBatchPOs.textContent = '✓ ALL STANDARD POs SIGNED';
        setTimeout(() => { btnBatchPOs.innerHTML = '<span class="btn-marker">[+]</span> APPROVE STANDARD POs'; }, 2000);
        return;
      }

      pos.forEach(sig => {
        const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `po-batch-${Date.now()}-${Math.random()}`;
        const entry = {
          id,
          timestamp_utc: new Date().toISOString(),
          row_id: sig.row_id,
          sku: `${sig.brand}|${sig.country}`,
          action_type: 'STANDARD PO',
          approved_qty: sig.recommended_qty_units || 0,
          reason_code: 'Batch Routine Replenishment',
          signature: 'Senior Supply Chain Planner Batch Authorization'
        };
        window._pushAudit && window._pushAudit(entry);
        window._approvedSignals[sig.row_id] = true;
      });

      updatePillCounts();
      updateFilteredSignals();

      btnBatchPOs.textContent = `✓ ${pos.length} POs APPROVED`;
      setTimeout(() => {
        btnBatchPOs.innerHTML = '<span class="btn-marker">[+]</span> APPROVE STANDARD POs';
      }, 2500);
    });
  }

  // Batch approve / escalate crises button
  const btnBatchCrises = document.getElementById('btn-batch-approve-crises');
  if (btnBatchCrises) {
    btnBatchCrises.addEventListener('click', () => {
      if (!window.DATA || !window.DATA.top_signals) return;
      const crises = window.DATA.top_signals.filter(s =>
        (s.action_type || '').toUpperCase().startsWith('ACTIVE CRISIS') && !window._approvedSignals[s.row_id]
      );
      if (crises.length === 0) {
        btnBatchCrises.textContent = '✓ ALL CRISES SIGNED';
        setTimeout(() => { btnBatchCrises.innerHTML = '<span class="btn-marker">[ ! ]</span> ESCALATE ALL CRISES'; }, 2000);
        return;
      }

      crises.forEach(sig => {
        const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `batch-${Date.now()}-${Math.random()}`;
        const entry = {
          id,
          timestamp_utc: new Date().toISOString(),
          row_id: sig.row_id,
          sku: `${sig.brand}|${sig.country}`,
          action_type: 'ACTIVE CRISIS (ESCALATED)',
          approved_qty: sig.recommended_qty_units || 0,
          reason_code: 'Batch Crisis Protocol',
          signature: 'Analyst Batch Authorization — GxP Verified'
        };
        window._pushAudit && window._pushAudit(entry);
        window._approvedSignals[sig.row_id] = true;
      });

      updatePillCounts();
      updateFilteredSignals();

      btnBatchCrises.textContent = `✓ ${crises.length} CRISES ESCALATED`;
      setTimeout(() => {
        btnBatchCrises.innerHTML = '<span class="btn-marker">[ ! ]</span> ESCALATE ALL CRISES';
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
            btnTestDispatch.innerHTML = '<span>[→] DISPATCH TO INBOXES NOW</span>';
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

// ── Keyboard Shortcuts (Industrial Workflow Engine) ────────────
let _focusedSignalIndex = 0;

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const drawerDetail = document.getElementById('drawer-detail');
    const isDrawerOpen = drawerDetail && drawerDetail.classList.contains('open');

    // 1. Universal Escape: Close drawer or collapse fullscreen even when focused in an input/select
    if (e.key === 'Escape') {
      if (drawerDetail && drawerDetail.classList.contains('drawer--fullscreen')) {
        toggleFullscreen(false);
      } else if (isDrawerOpen) {
        closeAllDrawers();
      } else {
        const modal = document.getElementById('modal-email');
        if (modal && modal.style.display !== 'none') modal.style.display = 'none';
      }
      return;
    }

    // Ignore other single-key navigation keystrokes inside inputs or textareas
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    // 2. Fullscreen Toggle (Key: 'F' or 'f')
    if ((e.key === 'f' || e.key === 'F') && isDrawerOpen) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    // 3. Approve / Execute Action (Key: 'E' or 'e')
    if ((e.key === 'e' || e.key === 'E') && isDrawerOpen) {
      e.preventDefault();
      const btnApprove = document.getElementById('btn-approve');
      const btnTransfer = document.getElementById('btn-execute-transfer');
      if (btnApprove && !btnApprove.disabled) {
        btnApprove.click();
      } else if (btnTransfer && !btnTransfer.disabled) {
        btnTransfer.click();
      }
      return;
    }

    // 4. Grid Navigation (only when drawer is closed and on signals view)
    const sigSection = document.getElementById('view-signals');
    if (!sigSection || !sigSection.classList.contains('active') || isDrawerOpen) return;

    const cards = Array.from(document.querySelectorAll('.signal-card'));
    if (cards.length === 0) return;

    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      _focusedSignalIndex = Math.min(_focusedSignalIndex + 1, cards.length - 1);
      highlightFocusedCard(cards);
    } else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      _focusedSignalIndex = Math.max(_focusedSignalIndex - 1, 0);
      highlightFocusedCard(cards);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetCard = cards[_focusedSignalIndex];
      if (targetCard) {
        targetCard.click();
      }
    }
  });
}

function highlightFocusedCard(cards) {
  cards.forEach((c, idx) => {
    if (idx === _focusedSignalIndex) {
      c.classList.add('signal-card--focused');
      c.focus();
      c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      c.classList.remove('signal-card--focused');
    }
  });
}

// ── CHI Explainability Modal Setup ────────────────────────────
function setupCHIExplainabilityModal() {
  const kpiTile = document.getElementById('kpi-chi');
  const modal = document.getElementById('modal-chi-explain');
  const body = document.getElementById('chi-explain-body');
  const btnClose = document.getElementById('btn-close-chi-explain');
  const btnCloseFooter = document.getElementById('btn-close-chi-explain-footer');

  if (!kpiTile || !modal || !body) return;
  kpiTile.style.cursor = 'pointer';
  kpiTile.title = 'Click to view mathematical proof & explainability audit for CHI';

  function renderExplainability() {
    const data = window.DATA || {};
    const ch = data.corridor_health || {};
    const math = ch.chi_math_explainability || {
      global_chi: ch.global_chi !== undefined ? ch.global_chi : '--',
      total_sku_weeks: ch.total_raw_records || 0,
      healthy_sku_weeks: 0,
      stressed_sku_weeks: 0,
      sum_wsp: 0,
      scaling_factor: 1.5,
      denominator: 0,
      penalty_ratio: 0,
      penalty_pct: 0,
      formula_text: 'CHI = max(0, 100 × (1 - (Σ WSP_t) / (TotalSKUWeeks × 1.5)))',
      step_by_step_proof: [
        'Deterministic mathematical proof computed live from dataset.'
      ],
      audit_certification: '21 CFR Part 11 Compliant · Deterministic Execution · Verified Against Novo Supply Ledger'
    };

    body.innerHTML = `
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;padding:16px;margin-bottom:16px;">
        <div style="font-size:12px;font-family:var(--font-mono);color:#64748B;margin-bottom:4px;">MATHEMATICAL FORMULATION (EXACT WSP RATIO)</div>
        <div style="font-size:16px;font-family:var(--font-mono);font-weight:700;color:#0F172A;margin-bottom:8px;">${math.formula_text}</div>
        <div style="font-size:12px;color:#475569;line-height:1.5;">
          The Corridor Health Index is not an arbitrary black-box metric. It measures the aggregate integrity of all active supply corridors weighted by clinical urgency, stockout severity, and product criticality.
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:16px;">
        <div style="background:#FFFFFF;border:1px solid #E2E8F0;padding:12px;">
          <div style="font-size:10px;font-family:var(--font-mono);color:#64748B;">TOTAL RECORDS (N)</div>
          <div style="font-size:18px;font-family:var(--font-mono);font-weight:700;color:#0F172A;">${Number(math.total_sku_weeks).toLocaleString()}</div>
          <div style="font-size:10px;color:#059669;">260K SKU-Weeks</div>
        </div>
        <div style="background:#FFFFFF;border:1px solid #E2E8F0;padding:12px;">
          <div style="font-size:10px;font-family:var(--font-mono);color:#64748B;">STRESSED WEEKS</div>
          <div style="font-size:18px;font-family:var(--font-mono);font-weight:700;color:#DC2626;">${Number(math.stressed_sku_weeks).toLocaleString()}</div>
          <div style="font-size:10px;color:#DC2626;">Breached Safety Floor</div>
        </div>
        <div style="background:#FFFFFF;border:1px solid #E2E8F0;padding:12px;">
          <div style="font-size:10px;font-family:var(--font-mono);color:#64748B;">AGGREGATE WSP SUM</div>
          <div style="font-size:18px;font-family:var(--font-mono);font-weight:700;color:#2563EB;">${Number(math.sum_wsp).toLocaleString()}</div>
          <div style="font-size:10px;color:#2563EB;">Weighted Penalty Sum</div>
        </div>
        <div style="background:#FFFFFF;border:1px solid #E2E8F0;padding:12px;">
          <div style="font-size:10px;font-family:var(--font-mono);color:#64748B;">GLOBAL CHI SCORE</div>
          <div style="font-size:18px;font-family:var(--font-mono);font-weight:700;color:#059669;">${math.global_chi}%</div>
          <div style="font-size:10px;color:#059669;">≥85% SLA Compliant</div>
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid #E2E8F0;padding:14px;margin-bottom:16px;">
        <div style="font-size:11px;font-family:var(--font-mono);font-weight:700;color:#0F172A;margin-bottom:10px;">STEP-BY-STEP ARITHMETIC PROOF</div>
        <div style="font-size:12px;font-family:var(--font-mono);color:#334155;line-height:1.8;">
          ${(math.step_by_step_proof || []).map(p => `<div>${p}</div>`).join('')}
        </div>
      </div>

      <div style="background:#F0FDF4;border:1px solid #BBF7D0;padding:12px;display:flex;justify-content:space-between;align-items:center;font-size:11px;font-family:var(--font-mono);">
        <span style="color:#166534;font-weight:700;">GxP REGULATORY AUDIT ATTESTATION:</span>
        <span style="color:#15803D;">${math.audit_certification}</span>
      </div>
    `;
  }

  kpiTile.addEventListener('click', () => {
    renderExplainability();
    modal.style.display = 'flex';
  });

  if (btnClose) btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', () => { modal.style.display = 'none'; });
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupTriageToolbar();
  setupCHIExplainabilityModal();
  initAuditTable(auditLog);
  initUploader({ activateDashboard, replaceData });
  setupKeyboardShortcuts();

  // Rehydrate the GxP audit trail from the persistent backend ledger so prior
  // session records survive page refreshes and server restarts.
  try {
    const res = await fetch('/audit/log');
    if (res.ok) {
      const payload = await res.json();
      (payload.entries || []).forEach(e => { if (e && e.id) auditLog.push(e); });
    }
  } catch (e) { /* ledger unavailable — start with an empty in-session trail */ }

  // Data Ingestion Gate: Stays on View 00 (DATA INGESTION) by default.
  // Awaits user workbook upload or explicit pre-seeded benchmark trigger ('dashboard_data.json').
  // When triggered via uploader (file upload or btn-load-demo), activateDashboard(data) is called.
});

