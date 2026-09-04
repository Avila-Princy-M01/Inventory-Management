/**
 * drawer-detail.js — 52-week trajectory chart + GxP approval flow
 */
import { getBadgeConfig, renderSignalCards } from './signals.js';
import {
  OWNER_ROLES,
  SNOOZE_DURATIONS,
  SNOOZE_REASONS,
  getWorkflowState,
  assignSignalOwner,
  addSignalComment,
  snoozeAlert,
  unsnoozeAlert,
  getEscalationSLA,
  getInitialComments
} from './workflow.js';

let _chart = null;
let _sig = null;

function buildSnoozeHtml(wf) {
  const isSnoozed = Boolean(wf.snooze && wf.snooze.snoozed_until > Date.now());
  if (isSnoozed) {
    return `
      <div class="workflow-active-snooze">
        <div class="active-snooze-left">
          <span class="active-snooze-icon">💤</span>
          <div>
            <div class="active-snooze-title">ALERT SNOOZED (${wf.snooze.weeks} WEEKS)</div>
            <div class="active-snooze-meta">Justification: <strong>${wf.snooze.reason}</strong>${wf.snooze.note ? ' · ' + wf.snooze.note : ''}</div>
          </div>
        </div>
        <button class="btn-unsnooze" id="btn-unsnooze-alert">RESUME ALERT EARLY ▶</button>
      </div>
    `;
  }
  return `
    <div class="workflow-snooze-form">
      <div class="workflow-field-label">SNOOZE ALERT (MANDATORY JUSTIFICATION):</div>
      <div class="workflow-snooze-grid">
        <select class="workflow-select" id="select-snooze-weeks">
          ${SNOOZE_DURATIONS.map(d => `<option value="${d.weeks}">${d.label}</option>`).join('')}
        </select>
        <select class="workflow-select" id="select-snooze-reason">
          ${SNOOZE_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
        <input type="text" class="workflow-input" id="input-snooze-note" placeholder="Operational rationale..." />
        <button class="btn-snooze" id="btn-snooze-alert">💤 SNOOZE</button>
      </div>
    </div>
  `;
}

function buildCommentsHtml(comments) {
  if (!comments || comments.length === 0) {
    return '<div class="workflow-no-comments">[ NO OPERATIONAL COMMENTS LOGGED ]</div>';
  }
  return comments.map(c => {
    const d = c.timestamp ? new Date(c.timestamp) : new Date();
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `
      <div class="workflow-comment-item">
        <div class="workflow-comment-meta">
          <span class="workflow-comment-author">${c.author}</span>
          <span class="workflow-comment-role">${c.role || 'Planner'}</span>
          <span class="workflow-comment-time">${dateStr} ${timeStr}</span>
        </div>
        <div class="workflow-comment-text">${c.text}</div>
      </div>
    `;
  }).join('');
}

function getApprovalLabel(actionType, qty) {
  const b = getBadgeConfig(actionType);
  const q = Number(qty || 0).toLocaleString('en-IN');
  switch (b.label) {
    case 'ACTIVE CRISIS': return 'APPROVE INTER-MARKET RE-ALLOCATION';
    case 'EMERGENCY EXPEDITE': return 'APPROVE EMERGENCY EXPEDITE';
    case 'STANDARD PO': return `APPROVE STANDARD PO — ${q} UNITS`;
    case 'ADVISORY': return 'ACKNOWLEDGE ADVISORY';
    case 'EXCESS HOLDING': return 'APPROVE DEFER / REALLOCATE';
    default: return 'APPROVE ACTION';
  }
}

function buildRecovery(sig) {
  const data = window.DATA || {};
  const curWk = (data.metadata && data.metadata.current_week) || 32;
  const leadWks = sig.market_lead_time || (data.metadata && data.metadata.calendar_lead_time_weeks) || 2;
  const inv = (sig.trajectory || {}).inventory || [];
  const ssd = (sig.trajectory || {}).ssd || [];
  const startInv = inv[curWk - 1] || 0;
  const endWk = Math.min(sig.breach_week + leadWks, 52);
  const target = sig.midpoint_target_units || (ssd[0] || 0) * 1.5;
  const pts = new Array(52).fill(null);
  for (let w = curWk; w <= endWk; w++) {
    const t = (w - curWk) / Math.max(1, endWk - curWk);
    pts[w - 1] = Math.round(startInv + t * (target - startInv));
  }
  return {
    label: 'Recovery (projected)', data: pts, borderColor: '#346538',
    borderDash: [6, 3], borderWidth: 2, pointRadius: 0, fill: false, yAxisID: 'y'
  };
}

export function openDetailDrawer(sig, approvedSignals) {
  window.closeAllDrawers && window.closeAllDrawers();
  _sig = sig;

  const drawer = document.getElementById('drawer-detail');
  const overlay = document.getElementById('drawer-overlay');
  const title = document.getElementById('detail-title');
  const body = document.getElementById('detail-body');
  if (!drawer || !body) return;

  const badge = getBadgeConfig(sig.action_type);
  const approved = Boolean((approvedSignals || {})[sig.row_id]);
  const rc = sig.root_cause || {};
  const sd = Math.round(rc.supply_deficit_pct || 45);
  const ds = Math.round(rc.demand_surge_pct || 35);
  const fs = Math.round(rc.floor_shock_pct || 20);
  const cert = Math.round((sig.supply_certainty || 0.8) * 100);
  const btnLabel = getApprovalLabel(sig.action_type, sig.recommended_qty_units);

  // Section 6.2 Workflow & SLA State
  const wf = getWorkflowState(sig.row_id);
  if (!wf.comments || wf.comments.length === 0) {
    wf.comments = getInitialComments(sig);
  }
  const sla = getEscalationSLA(sig, approvedSignals);

  if (title) title.textContent = `${(sig.brand || '').toUpperCase()} · ${(sig.country || '').toUpperCase()}`;

  const leadWks = sig.market_lead_time || (window.DATA && window.DATA.metadata && window.DATA.metadata.calendar_lead_time_weeks) || 3;
  const modeName = sig.market_mode || 'Sea Freight';
  const isLateForSea = Boolean(sig.is_late_for_sea);
  const countryDisplayName = sig.market_name || sig.country || 'China';
  const freightCallout = sig.freight_callout || `${countryDisplayName} breach at week ${sig.breach_week} — with ${leadWks}-week lead time, this is ALREADY TOO LATE for sea freight. Only air freight can save this.`;

  const slaBannerHtml = sla.isCritical
    ? `<div class="detail-sla-banner ${sla.cls}">
         <div class="sla-banner-inner">
           <span class="sla-pill-badge">${sla.status === 'RESOLVED' ? '✓ GxP COMPLIANT' : (sla.status === 'SNOOZED' ? '💤 SNOOZED' : '⏱ 24H SLA ESCALATION')}</span>
           <span class="sla-title">${sla.label}</span>
         </div>
         <div class="sla-subtext">Corporate Governance Standard: Critical corridor crises must be triaged / actioned within 24h of Monday 08:00 UTC cycle.</div>
       </div>`
    : '';

  const cliffBannerHtml = isLateForSea
    ? `<div class="detail-cliff-banner">
         <div class="cliff-banner-badge">🚨 IRRECOVERABLE SEA FREIGHT CLIFF</div>
         <div class="cliff-banner-quote">&ldquo;${freightCallout}&rdquo;</div>
       </div>`
    : '';

  const transfer = sig.intermarket_transfer || {};
  const transferCardHtml = transfer.has_transfer
    ? `
      <div class="transfer-corridor-box">
        <div class="transfer-corridor-header">
          <div class="detail-section-label" style="margin-bottom:0">INTER-MARKET STOCK RE-ALLOCATION CORRIDOR (SECTION 6.3)</div>
          <span class="transfer-badge">MATCHED SURPLUS ROUTE ✓</span>
        </div>
        
        <div class="transfer-visualizer">
          <div class="transfer-node transfer-node--donor">
            <div class="transfer-node-role">SURPLUS DONOR</div>
            <div class="transfer-node-market">${transfer.donor_country}</div>
            <div class="transfer-node-sub">${transfer.donor_region} · DOH ${transfer.donor_pre_doh}d</div>
          </div>
          <div class="transfer-arrow-block">
            <div class="transfer-arrow-line">
              <span class="transfer-arrow-pill">${Number(transfer.transfer_qty).toLocaleString()} UNITS</span>
              <span class="transfer-arrow-mode">✈️ ${transfer.transit_days}D AIR CHARTER</span>
            </div>
            <div class="transfer-arrow-head">▶</div>
          </div>
          <div class="transfer-node transfer-node--recipient">
            <div class="transfer-node-role">ACUTE RECIPIENT</div>
            <div class="transfer-node-market">${sig.country}</div>
            <div class="transfer-node-sub">Breach W${sig.breach_week} · Deficit ${Number(sig.recommended_qty_units).toLocaleString()} U</div>
          </div>
        </div>

        <div class="transfer-impact-grid">
          <div class="transfer-impact-item">
            <span class="transfer-impact-k">DONOR POST-TRANSFER DOH</span>
            <span class="transfer-impact-v" style="color:var(--ok-text)">${transfer.donor_post_doh} DAYS (SAFE)</span>
            <span class="transfer-impact-sub">SSD floor: ${transfer.donor_ssd}d (0 collateral risk)</span>
          </div>
          <div class="transfer-impact-item">
            <span class="transfer-impact-k">STOCKOUT RESOLUTION</span>
            <span class="transfer-impact-v" style="color:var(--ok-text)">RESTORED IN ${transfer.transit_days} DAYS</span>
            <span class="transfer-impact-sub">Prevents clinical penalty &amp; breach</span>
          </div>
          <div class="transfer-impact-item">
            <span class="transfer-impact-k">CAPITAL PRESERVED</span>
            <span class="transfer-impact-v">₹${(transfer.capital_saved_inr / 1e7).toFixed(2)} CR</span>
            <span class="transfer-impact-sub">Consumes idle stock without new PO</span>
          </div>
        </div>

        <button class="btn-primary btn-transfer-execute" id="btn-execute-transfer" ${approved ? 'disabled' : ''}>
          ${approved ? 'TRANSFER APPROVED & EXECUTED ✓' : `⚡ EXECUTE INTER-MARKET STOCK TRANSFER (${Number(transfer.transfer_qty).toLocaleString()} UNITS)`}
        </button>
      </div>
    `
    : '';

  const workflowSectionHtml = `
    <div class="workflow-box" id="workflow-container">
      <div class="workflow-header">
        <div class="detail-section-label" style="margin-bottom:0">ALERT WORKFLOW &amp; ESCALATION (SECTION 6.2)</div>
        <span class="workflow-status-badge ${wf.owner !== 'Unassigned' ? 'workflow-status-badge--active' : ''}" id="workflow-status-badge">
          ${wf.owner !== 'Unassigned' ? 'OWNER ASSIGNED ✓' : 'TRIAGE PENDING'}
        </span>
      </div>

      <!-- Owner Assignment -->
      <div class="workflow-row">
        <div class="workflow-field-label">SUPPLY CHAIN OWNER / GOVERNANCE LEAD:</div>
        <div class="workflow-select-wrap">
          <select class="workflow-select" id="select-signal-owner">
            ${OWNER_ROLES.map(r => `<option value="${r}" ${wf.owner === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
          <span class="workflow-saved-pill" id="owner-saved-pill" style="display:none">SAVED ✓</span>
        </div>
      </div>

      <!-- Snooze Area -->
      <div id="workflow-snooze-area">
        ${buildSnoozeHtml(wf)}
      </div>

      <!-- Planner Comments & Rationale Thread -->
      <div class="workflow-comments-block">
        <div class="workflow-comments-header">
          <span class="workflow-field-label" style="margin-bottom:0">PLANNER OPERATIONAL RATIONALE &amp; AUDIT TRAIL</span>
          <span class="workflow-count-badge tabular-nums" id="comment-count-badge">${(wf.comments || []).length} ENTRIES</span>
        </div>
        <div class="workflow-comments-list" id="workflow-comments-list">
          ${buildCommentsHtml(wf.comments)}
        </div>
        <div class="workflow-comment-input-row">
          <textarea class="workflow-textarea" id="input-new-comment" rows="2" placeholder="Record operational rationale (e.g. Flight capacity booked on LH Cargo for W14 delivery)..."></textarea>
          <button class="btn-workflow-comment" id="btn-post-comment">+ POST RATIONALE</button>
        </div>
      </div>
    </div>
  `;

  const staleParam = sig.stale_parameter || {};
  const isStale = Boolean(sig.is_stale_parameter || staleParam.is_stale);
  const staleAlertHtml = isStale ? `
    <div class="stale-param-alert-box" id="stale-param-alert">
      <div class="stale-param-top">
        <span class="stale-alert-badge">⚠️ STALE MASTER DATA DETECTED · SECTION 6.4</span>
        <span class="stale-alert-tag">DEMAND SHIFT ${staleParam.demand_shift_pct > 0 ? '+' : ''}${staleParam.demand_shift_pct}%</span>
      </div>
      <div class="stale-param-title">Safety Stock Days Static at ${staleParam.current_ssd || 42}d with Significant Demand Velocity Drift</div>
      <p class="stale-param-desc">
        The master planning parameter (SSD) in SAP/OMP has remained frozen at <strong>${staleParam.current_ssd || 42} days</strong> while observed rolling demand shifted by <strong>${staleParam.demand_shift_pct > 0 ? '+' : ''}${staleParam.demand_shift_pct}%</strong> across the horizon. This static configuration creates uncalibrated safety buffers, driving artificial corridor alarms.
      </p>
      <div class="stale-param-action">
        <strong>Recommended Master Data Recalibration:</strong> Initiate master data recalibration ticket in SAP/OMP to align corridor SSD with observed demand velocity.
      </div>
    </div>
  ` : '';

  body.innerHTML = `
    ${slaBannerHtml}
    ${cliffBannerHtml}
    ${staleAlertHtml}
    ${transferCardHtml}
    <div>
      <div class="detail-section-label">SIGNAL METADATA</div>
      <div class="detail-meta-grid">
        <div class="detail-meta-item"><span class="detail-meta-key">ACTION</span><span class="badge ${badge.cls}" style="display:inline-block;margin-top:2px">${badge.label}</span></div>
        <div class="detail-meta-item"><span class="detail-meta-key">BREACH HORIZON</span><span class="detail-meta-val" style="color:var(--crisis-text)">WEEK ${sig.breach_week}</span></div>
        <div class="detail-meta-item"><span class="detail-meta-key">MARKET LEAD TIME</span><span class="detail-meta-val tabular-nums" style="color:${isLateForSea ? 'var(--crisis-text)' : 'inherit'}">${leadWks} WEEKS (${modeName.split(' ')[0]})</span></div>
        <div class="detail-meta-item"><span class="detail-meta-key">RECOMMENDED QTY</span><span class="detail-meta-val tabular-nums">${Number(sig.recommended_qty_units || 0).toLocaleString('en-IN')} UNITS</span></div>
        <div class="detail-meta-item"><span class="detail-meta-key">CAPITAL AT RISK</span><span class="detail-meta-val tabular-nums">₹${Number(sig.capital_at_risk_inr || 0).toLocaleString('en-IN')}</span></div>
        <div class="detail-meta-item"><span class="detail-meta-key">52W OTIF / FULFILLMENT</span><span class="detail-meta-val tabular-nums" style="color:${(sig.otif_pct !== undefined ? sig.otif_pct : 98.5) >= 95 ? 'var(--ok-text)' : 'var(--crisis-text)'}">${sig.otif_pct !== undefined ? sig.otif_pct : 98.5}% (SLA: 95.0%)</span></div>
      </div>
    </div>
    ${workflowSectionHtml}
    <div class="narrative-box" id="narrative-container">
      <div class="narrative-header">
        <div class="detail-section-label" style="margin-bottom:0;">EXECUTIVE STRATEGIC DOSSIER</div>
        <span class="narrative-badge" id="narrative-badge-status">${approved ? 'APPROVED & SIGNED ✓' : 'SYNTHESIZED ✓'}</span>
      </div>
      <div class="narrative-dossier" id="narrative-dossier"></div>
    </div>
    <div>
      <div class="detail-section-label">52-WEEK INVENTORY TRAJECTORY</div>
      <div class="chart-container"><canvas id="detail-chart"></canvas></div>
    </div>
    <div>
      <div class="detail-section-label">ROOT-CAUSE ATTRIBUTION</div>
      <div class="rc-bar-row">
        <div class="rc-bar-header"><span class="rc-bar-label">SUPPLY DEFICIT</span><span class="rc-bar-val tabular-nums">${sd}%</span></div>
        <div class="rc-track"><div class="rc-fill" style="width:${sd}%;background:var(--crisis-text)"></div></div>
      </div>
      <div class="rc-bar-row">
        <div class="rc-bar-header"><span class="rc-bar-label">DEMAND SURGE</span><span class="rc-bar-val tabular-nums">${ds}%</span></div>
        <div class="rc-track"><div class="rc-fill" style="width:${ds}%;background:var(--warn-text)"></div></div>
      </div>
      <div class="rc-bar-row">
        <div class="rc-bar-header"><span class="rc-bar-label">FLOOR SHOCK</span><span class="rc-bar-val tabular-nums">${fs}%</span></div>
        <div class="rc-track"><div class="rc-fill" style="width:${fs}%;background:#2563EB"></div></div>
      </div>
    </div>
    <div>
      <div class="detail-section-label">SUPPLY CERTAINTY</div>
      <div class="rc-bar-row">
        <div class="rc-bar-header"><span class="rc-bar-label">CONFIRMED PO COMMITMENT</span><span class="rc-bar-val tabular-nums">${cert}%</span></div>
        <div class="rc-track"><div class="rc-fill" style="width:${cert}%;background:#2563EB"></div></div>
      </div>
    </div>
    <div>
      <button class="approval-btn ${approved ? 'approval-btn--approved' : ''}" id="btn-approve"
        ${approved ? 'disabled' : ''}>
        ${approved ? '■ ORDER APPROVED — GxP LOGGED' : btnLabel}
      </button>
    </div>
  `;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  if (overlay) overlay.classList.add('active');

  renderChart(sig, approved);

  // Wire Owner Selection
  const selectOwner = document.getElementById('select-signal-owner');
  const ownerPill = document.getElementById('owner-saved-pill');
  const wfBadge = document.getElementById('workflow-status-badge');
  if (selectOwner) {
    selectOwner.addEventListener('change', () => {
      const newOwner = selectOwner.value;
      assignSignalOwner(sig, newOwner);
      if (ownerPill) {
        ownerPill.style.display = 'inline-block';
        setTimeout(() => { if (ownerPill) ownerPill.style.display = 'none'; }, 2500);
      }
      if (wfBadge) {
        wfBadge.textContent = newOwner !== 'Unassigned' ? 'OWNER ASSIGNED ✓' : 'TRIAGE PENDING';
        wfBadge.className = `workflow-status-badge ${newOwner !== 'Unassigned' ? 'workflow-status-badge--active' : ''}`;
      }
      if (window.DATA && window.DATA.top_signals) {
        renderSignalCards(window.DATA.top_signals, window._approvedSignals || {});
      }
    });
  }

  // Wire Comments Posting
  const btnComment = document.getElementById('btn-post-comment');
  const txtComment = document.getElementById('input-new-comment');
  const commentsList = document.getElementById('workflow-comments-list');
  const commentCount = document.getElementById('comment-count-badge');
  if (btnComment && txtComment) {
    btnComment.addEventListener('click', () => {
      const text = txtComment.value.trim();
      if (!text) return;
      const currentOwner = (selectOwner ? selectOwner.value : 'Lead Supply Chain Planner (Global / HQ)');
      const author = currentOwner !== 'Unassigned' ? currentOwner : 'Lead Supply Chain Planner (Global / HQ)';
      addSignalComment(sig, text, author);
      txtComment.value = '';
      const updatedWf = getWorkflowState(sig.row_id);
      if (commentsList) commentsList.innerHTML = buildCommentsHtml(updatedWf.comments);
      if (commentCount) commentCount.textContent = `${(updatedWf.comments || []).length} ENTRIES`;
      if (window.DATA && window.DATA.top_signals) {
        renderSignalCards(window.DATA.top_signals, window._approvedSignals || {});
      }
    });
  }

  // Wire Snooze / Unsnooze
  function bindSnoozeEvents() {
    const btnSnooze = document.getElementById('btn-snooze-alert');
    const selectWeeks = document.getElementById('select-snooze-weeks');
    const selectReason = document.getElementById('select-snooze-reason');
    const inputNote = document.getElementById('input-snooze-note');
    const snoozeArea = document.getElementById('workflow-snooze-area');

    if (btnSnooze && selectWeeks && selectReason) {
      btnSnooze.addEventListener('click', () => {
        const weeks = parseInt(selectWeeks.value, 10) || 1;
        const reason = selectReason.value;
        const note = inputNote ? inputNote.value : '';
        snoozeAlert(sig, weeks, reason, note);
        const updatedWf = getWorkflowState(sig.row_id);
        if (snoozeArea) {
          snoozeArea.innerHTML = buildSnoozeHtml(updatedWf);
          bindSnoozeEvents();
        }
        if (window.DATA && window.DATA.top_signals) {
          renderSignalCards(window.DATA.top_signals, window._approvedSignals || {});
        }
      });
    }

    const btnUnsnooze = document.getElementById('btn-unsnooze-alert');
    if (btnUnsnooze) {
      btnUnsnooze.addEventListener('click', () => {
        unsnoozeAlert(sig);
        const updatedWf = getWorkflowState(sig.row_id);
        if (snoozeArea) {
          snoozeArea.innerHTML = buildSnoozeHtml(updatedWf);
          bindSnoozeEvents();
        }
        if (window.DATA && window.DATA.top_signals) {
          renderSignalCards(window.DATA.top_signals, window._approvedSignals || {});
        }
      });
    }
  }
  bindSnoozeEvents();

  const narrativeDossierEl = document.getElementById('narrative-dossier');
  if (narrativeDossierEl) {
    renderDossier(sig, narrativeDossierEl, false);
  }

  const btnApprove = document.getElementById('btn-approve');
  if (btnApprove && !approved) {
    btnApprove.addEventListener('click', () => handleApproval(sig, btnApprove));
  }

  const btnTransfer = document.getElementById('btn-execute-transfer');
  if (btnTransfer && !approved) {
    btnTransfer.addEventListener('click', () => {
      btnTransfer.disabled = true;
      btnTransfer.textContent = '■ TRANSFER APPROVED — GxP LOGGED';
      btnTransfer.classList.add('approval-btn--approved');

      const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `transfer-${Date.now()}`;
      const entry = {
        id, timestamp_utc: new Date().toISOString(),
        row_id: sig.row_id,
        sku: `${sig.brand}|${sig.country}`,
        action_type: 'INTER-MARKET RE-ALLOCATION',
        approved_qty: transfer.transfer_qty || sig.recommended_qty_units || 0,
        reason_code: 'EMERGENCY_INTERMARKET_TRANSFER',
        signature: 'Analyst Session — GxP Compliant (Sec 6.3)',
      };

      window._pushAudit && window._pushAudit(entry);
      window._setApproved && window._setApproved(sig.row_id);

      if (_chart) {
        _chart.data.datasets.push(buildRecovery(sig));
        _chart.update();
      }

      const badgeStatus = document.getElementById('narrative-badge-status');
      if (badgeStatus) badgeStatus.textContent = 'APPROVED & SIGNED ✓';
      if (btnApprove) {
        btnApprove.disabled = true;
        btnApprove.textContent = '■ ORDER APPROVED — GxP LOGGED';
        btnApprove.classList.add('approval-btn--approved');
      }
    });
  }
}

function generateDossier(sig) {
  const brand = sig.brand || 'Product';
  const country = sig.country || 'Global';
  const breachLen = sig.breach_length_weeks || Math.max(3, sig.delta_t_weeks || 4);
  const cert = Math.round((sig.supply_certainty || 0.8) * 100);
  const unconfirmedPct = 100 - cert;
  const recQty = Number(sig.recommended_qty_units || 0).toLocaleString('en-IN');
  const capRisk = `₹${Number(sig.capital_at_risk_inr || 0).toLocaleString('en-IN')}`;
  const recoveryWks = sig.recovery_weeks || 2;
  const standardWks = Math.max(recoveryWks + 2, Math.round(recoveryWks * 2.5));
  const rc = sig.root_cause || {};
  const primaryCause = rc.primary_cause || 'Supply Deficit';
  const supDeficit = rc.supply_deficit_pct !== undefined ? `${rc.supply_deficit_pct}%` : '50%';
  const demSurge = rc.demand_surge_pct !== undefined ? `${rc.demand_surge_pct}%` : '30%';
  const floorShock = rc.floor_shock_pct !== undefined ? `${rc.floor_shock_pct}%` : '20%';
  const mrpInfo = sig.mrp ? ` [MRP: ${sig.mrp}]` : '';

  // Dynamic clinical diagnosis based on the exact root cause mechanism
  let diagnosisText = '';
  if (primaryCause === 'Supply Deficit') {
    diagnosisText = `Critical pipeline disruption: Upstream supply shortfall (${supDeficit} deficit component) triggers corridor breach at W${sig.breach_week || 1}. Unhedged deficit threatens product continuity for ${brand} in ${country}${mrpInfo}.`;
  } else if (primaryCause === 'Demand Surge') {
    diagnosisText = `Demand-driven corridor erosion: Commercial acceleration (+${demSurge} above baseline run-rate) outpaces replenishment cadence for ${brand} in ${country}${mrpInfo}, projecting a ${breachLen}-week corridor deficit.`;
  } else {
    diagnosisText = `Dynamic safety floor recalibration: Variable demand patterns triggered a ${floorShock} floor-shock shift for ${brand} in ${country}${mrpInfo}, elevating safety stock requirements above active inventory coverage.`;
  }

  // Pipeline bottleneck assessment
  const bottleneckText = cert < 70
    ? `Severe supply pipeline fragility: Pipeline certainty at ${cert}% (${unconfirmedPct}% uncommitted / in-transit risk). Inbound deliveries insufficient without expedited allocation prior to W${sig.arrival_target_week || 4}.`
    : `Pipeline commitments verified at ${cert}% (${unconfirmedPct}% pending transit confirmation). Optimal replenishment arrival window targets W${sig.arrival_target_week || 4}.`;

  // Context-specific strategic action
  let actionText = '';
  const leadWks = sig.market_lead_time || 3;
  if (sig.is_late_for_sea) {
    actionText = `Authorize Emergency Air-Freight Procurement: ${country} breach at week ${sig.breach_week || 1} — with ${leadWks}-week lead time, this is ALREADY TOO LATE for sea freight. Only air freight can save this. Inject ${recQty} units via priority charter directly into ${country} hub by W${sig.arrival_target_week || 4}.`;
  } else if (sig.action_type === 'ACTIVE CRISIS') {
    actionText = `Execute Immediate Inter-Affiliate Stock Transfer & Emergency Air Expedite: Authorize priority dispatch of ${recQty} units to prevent imminent stockout and avoid clinical non-fulfillment penalties.`;
  } else if (sig.action_type === 'EMERGENCY EXPEDITE') {
    actionText = `Authorize Priority Air-Freight Procurement: Advance inbound shipment schedule to inject ${recQty} units directly into the ${country} regional depot by W${sig.arrival_target_week || 4}.`;
  } else if (sig.action_type === 'EXCESS HOLDING') {
    actionText = `Halt Inbound PO Commitments & Reallocate Quota: Suppress planned purchase orders to absorb excess working capital (${capRisk}) and burn down inventory toward corridor ceiling.`;
  } else if (sig.action_type === 'STANDARD PO') {
    actionText = `Release Scheduled Corridor Replenishment PO: Standard purchase order for ${recQty} units to re-establish nominal corridor equilibrium within normal lead-time (${leadWks}W).`;
  } else {
    actionText = `Maintain Monitored Buffer: Continue corridor tracking for ${brand} (${country}) with no immediate capital deployment required.`;
  }

  // Projected clinical and financial outcome
  const outcomeText = `Expedited deployment achieves corridor equilibrium within ${recoveryWks} weeks (saving ${standardWks - recoveryWks} weeks vs. standard lead time), restoring CHI ≥ 95% and safeguarding patient availability.`;

  return [
    { label: 'DIAGNOSIS', text: diagnosisText },
    { label: 'SUPPLY BOTTLENECK', text: bottleneckText },
    { label: 'RECOMMENDED ACTION', text: actionText, highlight: true },
    { label: 'CAPITAL AT RISK', text: `${capRisk} total working capital exposure across ${country} corridor inventory.` },
    { label: 'PROJECTED OUTCOME', text: outcomeText }
  ];
}

function renderDossier(sig, containerEl, animate = false) {
  if (!containerEl) return;
  const items = generateDossier(sig);
  containerEl.innerHTML = '';

  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = `dossier-row ${item.highlight ? 'dossier-row--highlight' : ''}`;
    row.innerHTML = `
      <span class="dossier-label">${item.label}</span>
      <span class="dossier-text" id="dossier-text-${idx}"></span>
    `;
    containerEl.appendChild(row);

    const textEl = row.querySelector(`#dossier-text-${idx}`);
    if (animate) {
      setTimeout(() => {
        typeChars(item.text, textEl);
      }, idx * 220);
    } else {
      textEl.textContent = item.text;
    }
  });
}

function typeChars(text, el) {
  if (!el) return;
  let i = 0;
  const cursor = document.createElement('span');
  cursor.className = 'narrative-cursor';
  el.appendChild(cursor);

  function tick() {
    if (i < text.length) {
      cursor.insertAdjacentText('beforebegin', text.charAt(i));
      i++;
      setTimeout(tick, 9);
    } else {
      setTimeout(() => cursor.remove(), 1200);
    }
  }
  tick();
}

function renderChart(sig, approved) {
  const canvas = document.getElementById('detail-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_chart) { _chart.destroy(); _chart = null; }

  const traj = sig.trajectory || {};
  const weeks = traj.weeks || Array.from({ length: 52 }, (_, i) => i + 1);
  const labels = weeks.map(w => `W${w}`);
  const bw = sig.breach_week || 1;

  const breachPlugin = {
    id: 'breachLine',
    afterDraw(chart) {
      const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
      const idx = Math.max(0, Math.min(bw - 1, 51));
      const xPos = x.getPixelForTick ? x.getPixelForTick(idx) : x.getPixelForValue(idx);
      if (!xPos || isNaN(xPos)) return;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#DC2626';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xPos, top); ctx.lineTo(xPos, bottom); ctx.stroke();
      ctx.fillStyle = '#9F2F2D';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(`BREACH W${bw}`, xPos + 4, top + 12);
      ctx.restore();
    }
  };

  const datasets = [
    { label: 'Inventory', data: traj.inventory || [], borderColor: '#2F3437', borderWidth: 2, pointRadius: 0, fill: false, yAxisID: 'y', tension: 0.1 },
    { label: 'SSD Floor', data: traj.ssd || [], borderColor: '#956400', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, fill: false, yAxisID: 'y' },
    { label: 'Ceiling', data: traj.ceiling || [], borderColor: '#9CA3AF', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, fill: false, yAxisID: 'y' },
    { type: 'bar', label: 'Demand', data: traj.demand || [], backgroundColor: 'rgba(0,0,0,0.05)', borderWidth: 0, yAxisID: 'y1', barPercentage: 0.8 },
  ];
  if (traj.lost_patient_demand && traj.lost_patient_demand.some(v => v > 0)) {
    datasets.push({
      type: 'bar',
      label: 'Lost Demand (Stockout)',
      data: traj.lost_patient_demand,
      backgroundColor: 'rgba(220, 38, 38, 0.45)',
      borderColor: '#DC2626',
      borderWidth: 1,
      yAxisID: 'y1',
      barPercentage: 0.8
    });
  }
  if (approved) datasets.push(buildRecovery(sig));

  _chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 8, font: { family: "'JetBrains Mono',monospace", size: 9 }, color: '#787774' } }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { grid: { color: '#F4F4F0' }, ticks: { maxTicksLimit: 13, font: { family: "'JetBrains Mono',monospace", size: 9 }, color: '#787774' } },
        y: { type: 'linear', position: 'left', grid: { color: '#EAEAEA' }, ticks: { font: { family: "'JetBrains Mono',monospace", size: 9 }, color: '#787774' } },
        y1: { type: 'linear', position: 'right', display: false, grid: { drawOnChartArea: false } }
      }
    },
    plugins: [breachPlugin]
  });
}

function handleApproval(sig, btn) {
  if (!sig) return;
  btn.disabled = true;
  btn.classList.add('approval-btn--approved');
  btn.textContent = '■ ORDER APPROVED — GxP LOGGED';

  // Add recovery dataset
  if (_chart) {
    _chart.data.datasets.push(buildRecovery(sig));
    _chart.update();
  }

  // Update dossier status & trigger typewriter animation
  const badgeStatus = document.getElementById('narrative-badge-status');
  if (badgeStatus) badgeStatus.textContent = 'APPROVED & SIGNED ✓';
  const narrativeDossierEl = document.getElementById('narrative-dossier');
  if (narrativeDossierEl) {
    renderDossier(sig, narrativeDossierEl, true);
  }

  // Construct AuditEntry
  const badge = getBadgeConfig(sig.action_type);
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `act-${Date.now()}`;
  const entry = {
    id, timestamp_utc: new Date().toISOString(),
    row_id: sig.row_id,
    sku: `${sig.brand}|${sig.country}`,
    action_type: badge.label,
    approved_qty: sig.recommended_qty_units || 0,
    reason_code: 'Standard Order',
    signature: 'Analyst Session — GxP Compliant',
  };

  window._pushAudit && window._pushAudit(entry);
  window._setApproved && window._setApproved(sig.row_id);
}

export function closeDetailDrawer() {
  const drawer = document.getElementById('drawer-detail');
  if (drawer) { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
  if (_chart) { _chart.destroy(); _chart = null; }
}

export const openDrawer = openDetailDrawer;
export const closeDrawer = closeDetailDrawer;
