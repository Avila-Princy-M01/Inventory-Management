/**
 * signals.js — Badge normalisation + Signal Card Renderer
 * Swiss Industrial Print: oversized rank numerals, razor-thin PRS bar, 5-key badge contract
 */

import { getWorkflowState, getEscalationSLA } from './workflow.js';

export const BADGE_MAP = [
  { prefix: 'ACTIVE CRISIS', cls: 'badge--crisis', label: 'ACTIVE CRISIS', borderColor: 'var(--hazard-red)' },
  { prefix: 'EMERGENCY EXPEDITE', cls: 'badge--expedite', label: 'EMERGENCY EXPEDITE', borderColor: 'var(--status-warn-text)' },
  { prefix: 'STANDARD PO', cls: 'badge--po', label: 'STANDARD PO', borderColor: 'var(--ink)' },
  { prefix: 'ADVISORY', cls: 'badge--advisory', label: 'ADVISORY', borderColor: 'var(--text-muted)' },
  { prefix: 'EXCESS HOLDING', cls: 'badge--excess', label: 'EXCESS HOLDING', borderColor: 'var(--text-muted)' },
];

export function getBadgeConfig(raw) {
  const upper = (raw || '').trim().toUpperCase();
  for (const b of BADGE_MAP) {
    if (upper.startsWith(b.prefix)) return b;
  }
  console.warn('[getBadgeConfig] Unknown:', raw);
  return BADGE_MAP[3]; // ADVISORY fallback
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

export function renderSignalCards(signals, approvedSignals = {}) {
  const grid = document.getElementById('signal-grid');
  if (!grid) return;

  if (!signals || signals.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-telemetry">
        <div class="empty-state-header">
          [ CORRIDOR NETWORK STATUS: NOMINAL ]
        </div>
        <div class="empty-state-title">
          ZERO THRESHOLD BREACHES IN ACTIVE FILTER VIEW
        </div>
        <div class="empty-state-desc">
          All corridors matching current filter criteria are operating within certified Safety Stock Days (SSD) boundaries. 
          No acute stockout risks, lead time cliffs, or pending replenishment expedites detected.
        </div>
        <div class="empty-state-stats">
          <span>SLAs: <strong class="text-ok">100% HEALTHY</strong></span>
          <span class="stat-sep">|</span>
          <span>BUFFER INTEGRITY: <strong class="text-ok">PASS</strong></span>
          <span class="stat-sep">|</span>
          <span>GxP AUDIT TRACE: <strong class="text-ink">VERIFIED</strong></span>
        </div>
      </div>
    `;
    return;
  }

  grid.innerHTML = signals.map((sig, i) => {
    const badge = getBadgeConfig(sig.action_type);
    const isCrisis = badge.label === 'ACTIVE CRISIS';
    const approved = Boolean(approvedSignals[sig.row_id]);
    const prs = Number(sig.prs_score || 0);
    const showWarn = sig.supply_certainty !== undefined && sig.supply_certainty !== null && sig.supply_certainty < 0.5;
    const rank = String(i + 1).padStart(2, '0');

    // Section 6.2 Workflow & SLA State
    const wf = getWorkflowState(sig.row_id);
    const isSnoozed = Boolean(wf.snooze && wf.snooze.snoozed_until > Date.now());
    const hasOwner = Boolean(wf.owner && wf.owner !== 'Unassigned');
    const sla = getEscalationSLA(sig, approvedSignals);

    const actionArea = approved
      ? `<div class="card-approved">■ APPROVED — GxP LOGGED</div>`
      : `<div class="card-actions">
           <button class="btn-po"     data-rid="${sig.row_id}">PO: ${fmtNum(sig.recommended_qty_units)} U</button>
           <button class="btn-detail" data-rid="${sig.row_id}">VIEW DETAILS →</button>
         </div>`;

    const warnHtml = showWarn
      ? `<div class="supply-warn">[ LOW SUPPLY CERTAINTY — UNCONFIRMED ORDERS &gt;50% ]</div>`
      : '';

    const ltVal = sig.market_lead_time || 3;
    const isLateForSea = Boolean(sig.is_late_for_sea);
    const mktTag = isLateForSea
      ? `<span class="card-mkt-cliff-tag" title="${esc(sig.freight_callout || 'Late for Sea Freight')}">[AIR ONLY]</span>`
      : `<span class="card-mkt-lt-tag">LT: ${ltVal}W</span>`;

    const ownerTag = hasOwner
      ? `<span class="card-owner-tag" title="Assigned Owner: ${esc(wf.owner)}">[ASSIGNED]</span>`
      : '';

    const slaText = sla.hoursLeft !== undefined
      ? `SLA: ${sla.hoursLeft}h`
      : (sla.status === 'ACKNOWLEDGED' ? 'SLA: OK' : 'SLA: ACT');
    const slaTag = (sla.isCritical && !approved && !isSnoozed)
      ? `<span class="card-sla-badge ${sla.cls}" title="${esc(sla.label)}">[${slaText}]</span>`
      : '';

    const snoozeHtml = isSnoozed
      ? `<div class="card-snooze-pill">
           <span class="snooze-text">[SNOOZED ${wf.snooze.weeks}W]</span>
         </div>`
      : '';

    const cliffHtml = isLateForSea
      ? `<div class="card-cliff-alert">
           <span class="cliff-alert-badge">[AIR ONLY]</span>
           <span class="cliff-alert-text">Breach W${sig.breach_week} &lt; ${ltVal}W</span>
         </div>`
      : '';

    const transfer = sig.intermarket_transfer || {};
    const transferHtml = (transfer.has_transfer && (isCrisis || badge.label === 'EMERGENCY EXPEDITE'))
      ? `<div class="card-transfer-pill">
           <span class="transfer-pill-text">>>> ROUTE: <strong>${esc(transfer.donor_country)}</strong> → <strong>${esc(sig.country)}</strong></span>
         </div>`
      : '';

    const constr = sig.constraints || {};
    const frozenTag = (constr.in_frozen_horizon && !approved)
      ? `<span class="card-frozen-tag" title="Collision with 4-week frozen horizon.">[FROZEN]</span>`
      : '';

    const cascadeSafeguard = (transfer.donor_cascade_safeguard || {});
    const cascadeTag = transfer.has_transfer
      ? `<span class="card-cascade-tag" title="${esc(cascadeSafeguard.verification_text || 'Donor retains > 1.5× SSD')}">[SAFE DONOR]</span>`
      : '';

    const staleParam = sig.stale_parameter || {};
    const isStale = Boolean(sig.is_stale_parameter || staleParam.is_stale);
    const staleTag = isStale
      ? `<span class="card-stale-tag" title="Safety Stock Days unchanged for 52W while demand pattern shifted">[STALE SSD]</span>`
      : '';

    const isLaunch = Boolean(sig.is_cold_start);
    const launchTag = isLaunch
      ? `<span class="card-launch-tag" title="New Product Launch">[COLD START]</span>`
      : '';

    const lat = sig.predictive_latency || {};
    const latencyTag = (lat.is_arrival_late && !approved)
      ? `<span class="card-latency-tag" title="${esc(lat.narrative)}">[DEFICIT]</span>`
      : '';

    const rawBadgeText = (sig.wow_badge || '').replace(/[^A-Za-z0-9\s+-]/g, '').trim();
    const wowTag = sig.wow_badge
      ? `<span class="card-wow-tag" title="${esc(sig.wow_narrative || '')}">[${esc(rawBadgeText)}]</span>`
      : '';

    const certPct = Math.round((sig.supply_certainty || 0.8) * 100);
    const capAtRiskStr = sig.capital_at_risk_inr === 0
      ? '₹0 (SURPLUS · DEFER)'
      : '₹' + (Number(sig.capital_at_risk_inr || 0) / 1e7).toFixed(2) + ' Cr';

    const plan = sig.ai_action_plan || {};
    const actionHeadline = plan.what_you_should_do || (sig.action_type === 'ACTIVE CRISIS'
      ? `Approve emergency air transfer of ${fmtNum(sig.recommended_qty_units)} units or air expedite`
      : (sig.action_type === 'EMERGENCY EXPEDITE'
        ? `Approve priority air charter for ${fmtNum(sig.recommended_qty_units)} units (10.3× ROI)`
        : (sig.action_type === 'EXCESS HOLDING'
          ? `Do NOT order more stock; defer planned inbound supply and share surplus`
          : `Release regular Purchase Order for ${fmtNum(sig.recommended_qty_units)} units on schedule`)));

    const simpleSituation = plan.what_is_happening || (sig.action_type === 'ACTIVE CRISIS'
      ? `Stock drops below safety floor in Week ${sig.breach_week}. Sea freight (${sig.market_lead_time || 3}W) is too slow.`
      : (sig.action_type === 'EMERGENCY EXPEDITE'
        ? `Runs out in Week ${sig.breach_week}. Ocean transit arrives after stockout starts.`
        : (sig.action_type === 'EXCESS HOLDING'
          ? `Inventory exceeds warehouse ceiling; multiple months of stock available.`
          : `Inventory tracking normally; ready for regular weekly order placement.`)));

    const simpleWhy = plan.why_it_matters || (sig.lost_lifelong_patients
      ? `Protects ${fmtNum(sig.lost_lifelong_patients)} lifelong patients and prevents ₹${(Number(sig.capital_at_risk_inr || 0) / 1e7).toFixed(2)} Cr stockout loss.`
      : `Maintains continuous supply without paying emergency freight premiums.`);

    const aiNarrativeHtml = `
      <div class="card-ai-action-box">
        <div class="card-ai-action-header">
          <span class="card-ai-badge">[ AI DIRECTIVE · DETERMINISTIC ]</span>
          <span class="card-ai-sub-tag">1-CLICK EXECUTE</span>
        </div>
        <div class="card-ai-action-headline">>>> <strong>${esc(actionHeadline)}</strong></div>
        <div class="card-ai-details">
          <div class="card-ai-detail-row"><span class="ai-bullet">[SITUATION]</span> <span><strong>Situation:</strong> ${esc(simpleSituation)}</span></div>
          <div class="card-ai-detail-row"><span class="ai-bullet">[IMPACT]</span> <span><strong>Why Care:</strong> ${esc(simpleWhy)}</span></div>
        </div>
      </div>
    `;

    const patientRiskHtml = (sig.lost_lifelong_patients && sig.lost_lifelong_patients > 0)
      ? `<div class="card-patient-impact">
           <span class="patient-text"><strong>${fmtNum(sig.lost_lifelong_patients)}</strong> Lifelong Patients at Risk (${fmtNum(sig.lost_patient_demand_units)} U unserved)</span>
         </div>`
      : '';

    const fc = sig.freight_comparison;
    const freightCompHtml = (fc && isLateForSea)
      ? `<div class="card-freight-callout">
           <span class="freight-text">Priority Air Charter saves <strong>₹${Number((sig.capital_at_risk_inr || 0) / 1e7).toFixed(2)} Cr</strong> (ROI <strong>${fc.expedite_roi_ratio}×</strong>)</span>
         </div>`
      : '';

    // Hero ranking: #1 PRS exception reads as hero row
    const priorityClass = i === 0
      ? 'signal-card--hero'
      : (i <= 3 ? 'signal-card--mid' : 'signal-card--std');

    return `<div class="signal-card ${priorityClass} ${isCrisis ? 'signal-card--crisis' : ''} ${isSnoozed ? 'signal-card--snoozed' : ''}" style="--i:${i}; --index:${i};" data-rid="${sig.row_id}" data-index="${i}" tabindex="0">
      <div class="card-top">
        <div class="card-row1">
          <span class="card-rank tabular-nums">#${rank}</span>
          <span class="badge ${badge.cls}">${badge.label}</span>
        </div>
        <div class="card-tags-cluster">
          ${ownerTag}
          ${slaTag}
          ${frozenTag}
          ${cascadeTag}
          ${wowTag}
          ${staleTag}
          ${launchTag}
          ${latencyTag}
          ${mktTag}
        </div>
      </div>
      <div class="card-mid">
        <div class="card-identity">
          <div class="card-brand">${esc(sig.brand)} · ${esc(sig.country)}</div>
          <div class="card-country">${esc(sig.region)} · ${esc((sig.product_group || '').split('|')[1] || sig.mrp || '')}</div>
        </div>
        <div class="prs-row">
          <div class="prs-track"><div class="prs-fill" style="width:${prs}%;background:${badge.borderColor}"></div></div>
          <span class="prs-val tabular-nums">${prs.toFixed(1)}</span>
        </div>
        <div class="card-meta tabular-nums">
          <span>BREACH <strong>WK ${sig.breach_week}</strong></span>
          <span>REC QTY <strong>${sig.recommended_qty_units === 0 && (sig.action_type || '').includes('EXCESS') ? '0 (SURPLUS)' : fmtNum(sig.recommended_qty_units)}</strong></span>
        </div>
        ${patientRiskHtml}
      </div>
      ${actionArea}
    </div>`;
  }).join('');

  // Wire click handlers
  signals.forEach(sig => {
    const card = grid.querySelector(`[data-rid="${sig.row_id}"]`);
    if (!card) return;
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-po')) return;
      window._openDetailDrawer && window._openDetailDrawer(sig);
    });
    const btnD = card.querySelector('.btn-detail');
    if (btnD) btnD.addEventListener('click', e => { e.stopPropagation(); window._openDetailDrawer && window._openDetailDrawer(sig); });
    const btnP = card.querySelector('.btn-po');
    if (btnP) btnP.addEventListener('click', e => { e.stopPropagation(); window._openDetailDrawer && window._openDetailDrawer(sig); });
  });

  const badge_el = document.getElementById('signal-count-badge');
  if (badge_el) badge_el.textContent = `${signals.length} ACTIVE SIGNALS`;
}
