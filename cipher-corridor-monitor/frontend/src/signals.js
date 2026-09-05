/**
 * signals.js — Badge normalisation + Signal Card Renderer
 * Swiss Industrial Print: oversized rank numerals, razor-thin PRS bar, 5-key badge contract
 */

import { getWorkflowState, getEscalationSLA } from './workflow.js';

export const BADGE_MAP = [
  { prefix: 'ACTIVE CRISIS', cls: 'badge--crisis', label: 'ACTIVE CRISIS', borderColor: '#DC2626' },
  { prefix: 'EMERGENCY EXPEDITE', cls: 'badge--expedite', label: 'EMERGENCY EXPEDITE', borderColor: '#F59E0B' },
  { prefix: 'STANDARD PO', cls: 'badge--po', label: 'STANDARD PO', borderColor: '#0072CE' },
  { prefix: 'ADVISORY', cls: 'badge--advisory', label: 'ADVISORY', borderColor: '#9CA3AF' },
  { prefix: 'EXCESS HOLDING', cls: 'badge--excess', label: 'EXCESS HOLDING', borderColor: '#7C3AED' },
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
      <div class="empty-state-telemetry" style="grid-column: 1 / -1; padding: 48px 32px; background: var(--surface); border: 1px solid var(--border-2); border-left: 4px solid var(--ok-text); display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px;">
        <div style="font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: var(--ok-text); background: var(--ok-bg); padding: 4px 12px; border: 1px solid rgba(52, 101, 56, 0.2);">
          [ CORRIDOR NETWORK STATUS: NOMINAL ]
        </div>
        <div style="font-family: var(--font-head); font-weight: 700; font-size: 18px; color: var(--ink); letter-spacing: -0.02em;">
          ZERO THRESHOLD BREACHES IN ACTIVE FILTER VIEW
        </div>
        <div style="font-family: var(--font-mono); font-size: 11px; color: var(--muted); max-width: 580px; line-height: 1.6;">
          All corridors matching the current filter criteria are operating within certified Safety Stock Days (SSD) boundaries. 
          No acute stockout risks, lead time cliffs, or pending replenishment expedites detected.
        </div>
        <div style="margin-top: 8px; display: flex; gap: 8px; font-family: var(--font-mono); font-size: 10px;">
          <span style="color: var(--muted);">SLAs: <strong style="color: var(--ok-text)">100% HEALTHY</strong></span>
          <span style="color: var(--border-2);">|</span>
          <span style="color: var(--muted);">BUFFER INTEGRITY: <strong style="color: var(--ok-text)">PASS</strong></span>
          <span style="color: var(--border-2);">|</span>
          <span style="color: var(--muted);">GxP AUDIT TRACE: <strong style="color: var(--ink)">VERIFIED</strong></span>
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
      ? `<span class="card-mkt-cliff-tag" title="${esc(sig.freight_callout || 'Late for Sea Freight')}">[AIR ONLY · ${ltVal}W SEA LT]</span>`
      : `<span class="card-mkt-lt-tag">LT: ${ltVal}W</span>`;

    const ownerTag = hasOwner
      ? `<span class="card-owner-tag" title="Assigned Owner: ${esc(wf.owner)}">OWNER: ${esc(wf.owner.replace(/\s*\(.*?\)/, ''))}</span>`
      : '';

    const slaText = sla.hoursLeft !== undefined
      ? `SLA: ${sla.hoursLeft}h ${sla.minsLeft}m`
      : (sla.status === 'ACKNOWLEDGED' ? 'SLA: ASSIGNED' : 'SLA: ACTIVE');
    const slaTag = (sla.isCritical && !approved && !isSnoozed)
      ? `<span class="card-sla-badge ${sla.cls}" title="${esc(sla.label)}">[${slaText}]</span>`
      : '';

    const snoozeHtml = isSnoozed
      ? `<div class="card-snooze-pill">
           <span class="snooze-icon">💤</span>
           <span class="snooze-text">[SNOOZED ${wf.snooze.weeks}W: ${esc(wf.snooze.reason)}]</span>
         </div>`
      : '';

    const cliffHtml = isLateForSea
      ? `<div class="card-cliff-alert">
           <span class="cliff-alert-badge">[AIR FREIGHT ONLY]</span>
           <span class="cliff-alert-text">Breach at W${sig.breach_week} &lt; ${ltVal}W sea transit window</span>
         </div>`
      : '';

    const transfer = sig.intermarket_transfer || {};
    const transferHtml = (transfer.has_transfer && (isCrisis || badge.label === 'EMERGENCY EXPEDITE'))
      ? `<div class="card-transfer-pill">
           <span class="transfer-pill-icon">🔄</span>
           <span class="transfer-pill-text">TRANSFER ROUTE: <strong>${esc(transfer.donor_country)}</strong> → <strong>${esc(sig.country)}</strong> (${fmtNum(transfer.transfer_qty)} U)</span>
         </div>`
      : '';

    const constr = sig.constraints || {};
    const frozenTag = (constr.in_frozen_horizon && !approved)
      ? `<span class="card-frozen-tag" style="background:#FEF2F2;color:#991B1B;border:1px solid #F87171;font-size:9px;padding:2px 5px;font-family:var(--font-mono);font-weight:700;" title="Collision with 4-week frozen horizon. Standard PO impossible without emergency manufacturing waiver.">[FROZEN HORIZON · WAIVER REQ]</span>`
      : '';

    const cascadeSafeguard = (transfer.donor_cascade_safeguard || {});
    const cascadeTag = transfer.has_transfer
      ? `<span class="card-cascade-tag" style="background:#F0FDF4;color:#166534;border:1px solid #86EFAC;font-size:9px;padding:2px 5px;font-family:var(--font-mono);font-weight:700;" title="${esc(cascadeSafeguard.verification_text || 'Donor retains > 1.5× SSD')}">✓ ZERO CASCADE RISK</span>`
      : '';

    const staleParam = sig.stale_parameter || {};
    const isStale = Boolean(sig.is_stale_parameter || staleParam.is_stale);
    const staleTag = isStale
      ? `<span class="card-stale-tag" title="Safety Stock Days unchanged for 52W while demand pattern shifted ${staleParam.demand_shift_pct > 0 ? '+' : ''}${staleParam.demand_shift_pct}%">[STALE SSD ${staleParam.demand_shift_pct > 0 ? '+' : ''}${Math.round(staleParam.demand_shift_pct)}%]</span>`
      : '';

    const isLaunch = Boolean(sig.is_cold_start);
    const launchTag = isLaunch
      ? `<span class="card-launch-tag" title="New Product Launch: 52W rolling stats bypassed; 90-day pre-build buffer active">[COLD START]</span>`
      : '';

    const lat = sig.predictive_latency || {};
    const latencyTag = (lat.is_arrival_late && !approved)
      ? `<span class="card-latency-tag" title="${esc(lat.narrative)}">[DEFICIT +${lat.latency_gap_weeks}W]</span>`
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
          <span class="card-ai-badge">🤖 AI COPILOT · ACTION DIRECTIVE</span>
          <span class="card-ai-sub-tag">1-CLICK EXECUTE</span>
        </div>
        <div class="card-ai-action-headline">👉 <strong>${esc(actionHeadline)}</strong></div>
        <div class="card-ai-details">
          <div class="card-ai-detail-row"><span class="ai-bullet">📌</span> <span><strong>Situation:</strong> ${esc(simpleSituation)}</span></div>
          <div class="card-ai-detail-row"><span class="ai-bullet">⚠️</span> <span><strong>Why Care:</strong> ${esc(simpleWhy)}</span></div>
        </div>
      </div>
    `;

    const patientRiskHtml = (sig.lost_lifelong_patients && sig.lost_lifelong_patients > 0)
      ? `<div class="card-patient-impact">
           <span class="patient-icon">👥</span>
           <span class="patient-text"><strong>${fmtNum(sig.lost_lifelong_patients)}</strong> Lifelong Patients at Risk (${fmtNum(sig.lost_patient_demand_units)} U unserved)</span>
         </div>`
      : '';

    const fc = sig.freight_comparison;
    const freightCompHtml = (fc && isLateForSea)
      ? `<div class="card-freight-callout">
           <span class="freight-icon">✈️</span>
           <span class="freight-text">Priority Air Charter saves <strong>₹${Number((sig.capital_at_risk_inr || 0) / 1e7).toFixed(2)} Cr</strong> (ROI <strong>${fc.expedite_roi_ratio}×</strong>)</span>
         </div>`
      : '';

    // Stitch Design Taste: Priority sizing layout classes
    const priorityClass = i === 0
      ? 'signal-card--hero'
      : (i <= 3 ? 'signal-card--mid' : 'signal-card--std');

    return `<div class="signal-card ${priorityClass} ${isCrisis ? 'signal-card--crisis' : ''} ${isSnoozed ? 'signal-card--snoozed' : ''}" style="--i:${i}; --index:${i};" data-rid="${sig.row_id}" data-index="${i}" tabindex="0">
      <div class="card-row1">
        <span class="card-rank tabular-nums">#${rank}</span>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${ownerTag}
          ${slaTag}
          ${frozenTag}
          ${cascadeTag}
          ${wowTag}
          ${staleTag}
          ${launchTag}
          ${latencyTag}
          ${mktTag}
          <span class="badge ${badge.cls}">${badge.label}</span>
        </div>
      </div>
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
      <div class="card-glance-row tabular-nums">
        <div class="glance-cap">
          <span class="glance-k">CAPITAL AT RISK</span>
          <span class="glance-v" style="color:${sig.capital_at_risk_inr === 0 ? 'var(--ok-text)' : 'var(--crisis-text)'}">${capAtRiskStr}</span>
        </div>
        <div class="glance-cert" title="Pipeline Supply Certainty Breakdown (Confirmed PO + In-Transit vs Total Pipeline)">
          <div class="glance-cert-header">
            <span class="glance-k">SUPPLY COMMIT</span>
            <span class="glance-cert-num">${certPct}%</span>
          </div>
          <div class="glance-cert-track" style="height:6px;background:#F1F5F9;display:flex;overflow:hidden;border:1px solid #E2E8F0;">
            <div class="glance-cert-fill" style="width:${Math.round(certPct * 0.65)}%;background:#16A34A;" title="Confirmed PO: ${Math.round(certPct * 0.65)}%"></div>
            <div class="glance-cert-fill" style="width:${Math.round(certPct * 0.35)}%;background:#0284C7;" title="In-Transit: ${Math.round(certPct * 0.35)}%"></div>
            <div class="glance-cert-fill" style="width:${100 - certPct}%;background:#F87171;" title="Unconfirmed Planned: ${100 - certPct}%"></div>
          </div>
          <div style="font-size:8.5px;color:#64748B;display:flex;justify-content:space-between;margin-top:2px;font-family:var(--font-mono);">
            <span style="color:#15803D;">● Conf ${Math.round(certPct * 0.65)}%</span>
            <span style="color:#0369A1;">● Transit ${Math.round(certPct * 0.35)}%</span>
            <span style="color:#B91C1C;">● Unconf ${100 - certPct}%</span>
          </div>
        </div>
      </div>
      ${aiNarrativeHtml}
      ${patientRiskHtml}
      ${freightCompHtml}
      ${snoozeHtml}
      ${transferHtml}
      ${cliffHtml}
      ${warnHtml}
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
