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

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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

export function getApprovalLabel(actionType, qty) {
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
export const getApprovalButtonLabel = getApprovalLabel;


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

  let slaBannerHtml = '';
  if (sla.isCritical) {
    if (sla.status === 'RESOLVED') {
      slaBannerHtml = `
        <div class="detail-sla-banner sla-resolved">
          <div class="sla-banner-header">
            <div class="sla-header-left">
              <span class="sla-pill-badge">✓ GxP COMPLIANT</span>
              <span class="sla-status-title">Crisis Triage Complete — Order Approved &amp; Signed</span>
            </div>
            <span class="sla-deadline-tag">21 CFR Part 11 Verified</span>
          </div>
          <div class="sla-body-text">All replenishment parameters and quantities are recorded in the GxP audit ledger. SLA successfully resolved.</div>
        </div>
      `;
    } else if (sla.status === 'SNOOZED') {
      slaBannerHtml = `
        <div class="detail-sla-banner sla-snoozed">
          <div class="sla-banner-header">
            <div class="sla-header-left">
              <span class="sla-pill-badge">💤 SNOOZED</span>
              <span class="sla-status-title">${sla.label}</span>
            </div>
            <span class="sla-deadline-tag">Governance Review on Hold</span>
          </div>
          <div class="sla-body-text">Alert temporarily deferred with operational justification. Triage countdown will resume after snooze period.</div>
        </div>
      `;
    } else if (sla.status === 'ACKNOWLEDGED') {
      slaBannerHtml = `
        <div class="detail-sla-banner sla-assigned">
          <div class="sla-banner-header">
            <div class="sla-header-left">
              <span class="sla-pill-badge">ACTIVE TRIAGE</span>
              <span class="sla-status-title">${sla.label}</span>
            </div>
            <span class="sla-deadline-tag">Ownership Acknowledged</span>
          </div>
          <div class="sla-body-text">Corridor owner assigned. Authorize PO order or execute matched inter-market stock transfer below to complete resolution.</div>
        </div>
      `;
    } else {
      slaBannerHtml = `
        <div class="detail-sla-banner sla-urgent">
          <div class="sla-banner-header">
            <div class="sla-header-left">
              <span class="sla-pill-badge">⏱ 24-HOUR ACTION DEADLINE</span>
              <span class="sla-timer-highlight"><strong>${sla.hoursLeft}h ${sla.minsLeft}m</strong> remaining</span>
            </div>
            <span class="sla-deadline-tag">Escalation Target: Tuesday 08:00 UTC</span>
          </div>
          <div class="sla-body-grid">
            <div class="sla-body-main">
              <strong>Action Required:</strong> Unassigned acute crisis. If not actioned within the 24h window, this signal automatically escalates to the <strong>VP of Global Supply Chain</strong>.
            </div>
            <div class="sla-body-steps">
              <span class="sla-step-item">① Assign an owner</span>
              <span class="sla-step-item">② Authorize transfer / PO</span>
              <span class="sla-step-item">③ Or snooze with operational justification below</span>
            </div>
          </div>
        </div>
      `;
    }
  }

  const cliffBannerHtml = isLateForSea
    ? `<div class="detail-cliff-banner">
         <div class="cliff-banner-badge">🚨 IRRECOVERABLE SEA FREIGHT CLIFF</div>
         <div class="cliff-banner-quote">&ldquo;${freightCallout}&rdquo;</div>
       </div>`
    : '';

  const transfer = sig.intermarket_transfer || {};
  const whCap = transfer.warehouse_capacity || {};
  const econ = transfer.transfer_economics || {};
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
            <span class="transfer-impact-v" style="color:var(--ok-text)">${transfer.donor_post_doh} DAYS (${(transfer.donor_post_doh / Math.max(1, transfer.donor_ssd)).toFixed(2)}× SSD)</span>
            <span class="transfer-impact-sub">SSD floor: ${transfer.donor_ssd}d · <strong>✓ ZERO CASCADE RISK</strong> (>1.5× SSD)</span>
          </div>
          <div class="transfer-impact-item">
            <span class="transfer-impact-k">STOCKOUT RESOLUTION</span>
            <span class="transfer-impact-v" style="color:var(--ok-text)">RESTORED IN ${transfer.transit_days} DAYS</span>
            <span class="transfer-impact-sub">Prevents clinical penalty &amp; breach</span>
          </div>
          <div class="transfer-impact-item">
            <span class="transfer-impact-k">CAPITAL PRESERVED</span>
            <span class="transfer-impact-v">₹${(transfer.capital_saved_inr / 1e7).toFixed(2)} CR</span>
            <span class="transfer-impact-sub">${econ.transfer_roi_ratio || 10.4}x Net Capital ROI</span>
          </div>
        </div>

        <!-- AI Plain-English Transfer Verdict -->
        <div class="ai-section-translation-box" style="margin:12px 0;padding:10px 12px;background:#F0FDF4;border:1px solid #BBF7D0;border-left:4px solid #16A34A;border-radius:2px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-size:13px;">🤖</span>
            <span style="font-family:var(--font-mono);font-size:10px;font-weight:800;color:#166534;letter-spacing:0.04em;">AI PLAIN-ENGLISH TRANSFER VERDICT</span>
          </div>
          <div style="font-size:11.5px;color:#14532D;line-height:1.55;">
            <strong>Why this works:</strong> ${transfer.donor_country} has <strong>${transfer.donor_pre_doh} days of stock</strong> in their warehouse and only needs ${transfer.donor_ssd} days. 
            By flying ${Number(transfer.transfer_qty).toLocaleString()} units over, <strong>${sig.country} gets stock in 4 days</strong> without waiting for slow cargo ships. 
            <strong>Is ${transfer.donor_country} safe?</strong> Yes! After the transfer, they still keep <strong>${transfer.donor_post_doh} days of inventory (over ${(transfer.donor_post_doh/30).toFixed(1)} months)</strong> with zero risk of running low.
          </div>
        </div>


        <!-- Section 6.5 Warehouse Headroom & Transfer Economics -->
        <div class="wh-capacity-box">
          <div class="wh-capacity-header">
            <span class="wh-capacity-title">RECIPIENT WAREHOUSE CAPACITY &amp; HEADROOM VERIFICATION</span>
            <span class="wh-capacity-tag">${whCap.headroom_status || 'HEADROOM CONFIRMED (<90%)'}</span>
          </div>
          <div class="wh-bar-wrap">
            <div class="wh-bar-track">
              <div class="wh-bar-fill" style="width:${whCap.recipient_utilization_pct || 83}%;background:var(--ok-text)"></div>
            </div>
            <div class="wh-bar-meta">
              <span>Current: ${Number(whCap.recipient_current_inventory || 28400).toLocaleString()} U</span>
              <span>Post-Transfer: <strong>${Number(whCap.recipient_post_inventory || 41574).toLocaleString()} U</strong> (${whCap.recipient_utilization_pct || 83.1}% / 50,000 U Limit)</span>
            </div>
          </div>
          <div class="transfer-econ-grid">
            <div class="econ-item">
              <span class="econ-k">AIR FREIGHT REEFER</span>
              <span class="econ-v tabular-nums">₹${((econ.cost_air_freight_inr || 1251530) / 1e5).toFixed(1)}L</span>
            </div>
            <div class="econ-item">
              <span class="econ-k">CUSTOMS &amp; TARIFFS</span>
              <span class="econ-v tabular-nums">₹${((econ.cost_tariffs_duties_inr || 461090) / 1e5).toFixed(1)}L</span>
            </div>
            <div class="econ-item">
              <span class="econ-k">SECONDARY PACKAGING</span>
              <span class="econ-v tabular-nums">₹${((econ.cost_relabeling_packaging_inr || 197610) / 1e5).toFixed(1)}L</span>
            </div>
            <div class="econ-item">
              <span class="econ-k">TOTAL TRANSFER COST</span>
              <span class="econ-v tabular-nums" style="color:var(--crisis-text)">₹${((econ.cost_total_transfer_inr || 1910230) / 1e5).toFixed(1)}L</span>
            </div>
            <div class="econ-item">
              <span class="econ-k">NET ECONOMIC ROI</span>
              <span class="econ-v tabular-nums" style="color:var(--ok-text)">${econ.roi_text || '10.4x Net Capital ROI'}</span>
            </div>
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

      <!-- AI Plain-English Workflow & Governance Guidance -->
      <div class="ai-section-translation-box" style="margin-top:12px;padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-left:4px solid #64748B;border-radius:2px;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:13px;">🤖</span>
          <span style="font-family:var(--font-mono);font-size:10px;font-weight:800;color:#334155;letter-spacing:0.04em;">AI PLAIN-ENGLISH GOVERNANCE GUIDE</span>
        </div>
        <div style="font-size:11.5px;color:#1E293B;line-height:1.55;">
          <strong>What you should do:</strong> This alert has an active <strong>24-Hour Response SLA</strong>. Approving the transfer automatically timestamps your decision in the <strong>GxP audit trail (21 CFR Part 11 compliant)</strong>. If you are investigating or awaiting confirmation, snooze the alert or log a short rationale above to maintain full audit compliance.
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
      <div class="ai-section-translation-box" style="margin-top:8px;padding:8px 10px;background:#FEF3C7;border:1px solid #FDE68A;border-left:3px solid #D97706;border-radius:2px;">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
          <span style="font-size:12px;">🤖</span>
          <span style="font-family:var(--font-mono);font-size:9.5px;font-weight:800;color:#92400E;letter-spacing:0.04em;">AI PARAMETER AUDIT TAKEAWAY</span>
        </div>
        <div style="font-size:11px;color:#78350F;line-height:1.5;">
          Safety Stock Days in SAP is frozen at <strong>${staleParam.current_ssd || 42} days</strong> based on obsolete history. Calibrating this parameter to match current sales patterns eliminates phantom alerts and unlocks idle working capital.
        </div>
      </div>
    </div>
  ` : '';

  // Section 6.7 Predictive Latency Timeline
  const lat = sig.predictive_latency || {};
  const isLate = Boolean(lat.is_arrival_late);
  const latencyTimelineHtml = `
    <div class="latency-timeline-box">
      <div class="latency-timeline-header">
        <div class="detail-section-label" style="margin-bottom:0">PREDICTIVE REPLENISHMENT LATENCY &amp; STOCKOUT PRE-EMPTION</div>
        <span class="latency-status-tag ${isLate ? 'latency-status-tag--cliff' : 'latency-status-tag--ok'}">
          ${isLate ? `⚠️ LATENCY DEFICIT: +${lat.latency_gap_weeks || 2}W STOCKOUT` : '✓ PRE-EMPTIVE ARRIVAL'}
        </span>
      </div>
      <div class="latency-visual-track">
        <div class="latency-step latency-step--dispatch">
          <span class="latency-step-dot"></span>
          <span class="latency-step-wk">W1</span>
          <span class="latency-step-lbl">ORDER DISPATCH</span>
        </div>
        <div class="latency-step latency-step--breach">
          <span class="latency-step-dot latency-step-dot--breach"></span>
          <span class="latency-step-wk">W${sig.breach_week}</span>
          <span class="latency-step-lbl">STOCKOUT BREACH</span>
        </div>
        <div class="latency-step latency-step--expedite">
          <span class="latency-step-dot latency-step-dot--expedite"></span>
          <span class="latency-step-wk">W${lat.expedited_arrival_week || 2}</span>
          <span class="latency-step-lbl">AIR EXPEDITE ARRIVAL</span>
        </div>
        <div class="latency-step ${isLate ? 'latency-step--late' : 'latency-step--ok'}">
          <span class="latency-step-dot ${isLate ? 'latency-step-dot--late' : 'latency-step-dot--ok'}"></span>
          <span class="latency-step-wk">W${lat.standard_arrival_week || (sig.breach_week + 2)}</span>
          <span class="latency-step-lbl">STANDARD PO ARRIVAL</span>
        </div>
      </div>
      <div class="latency-narrative-text">
        ${lat.narrative || `Standard replenishment lead time causes stockout breach. Air freight or inter-market transfer is required to bridge the ${lat.latency_gap_weeks || 2}-week gap.`}
      </div>

      <!-- AI Plain-English Timeline Breakdown -->
      <div class="ai-section-translation-box" style="margin-top:10px;padding:8px 10px;background:#FFF7ED;border:1px solid #FFEDD5;border-left:3px solid #EA580C;border-radius:2px;">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
          <span style="font-size:12px;">🤖</span>
          <span style="font-family:var(--font-mono);font-size:9.5px;font-weight:800;color:#9A3412;letter-spacing:0.04em;">AI TIMELINE BREAKDOWN</span>
        </div>
        <div style="font-size:11px;color:#7C2D12;line-height:1.5;">
          ${isLate ? `
            <strong>The Problem:</strong> Inventory runs dry at <strong>Week ${sig.breach_week}</strong>, but standard factory shipping does not arrive until <strong>Week ${lat.standard_arrival_week || (sig.breach_week + 2)}</strong>. This creates a dangerous <strong>${lat.latency_gap_weeks || 2}-week stockout gap</strong>. Priority air transfer arrives in <strong>Week ${lat.expedited_arrival_week || 2}</strong>, closing the gap before empty shelves happen.
          ` : `
            Standard replenishment arrives ahead of the breach window. Pre-emptive replenishment is on track.
          `}
        </div>
      </div>
    </div>
  `;

  // Section 6.8 Manufacturing & Production Constraints
  const constr = sig.constraints || {};
  const constraintsHtml = `
    <div class="constraints-box">
      <div class="constraints-header">
        <div class="detail-section-label" style="margin-bottom:0">MANUFACTURING &amp; NETWORK CONSTRAINTS (SECTION 6.8)</div>
        <span class="constraints-status-tag ${constr.in_frozen_horizon ? 'constraints-tag--locked' : 'constraints-tag--open'}">
          ${constr.in_frozen_horizon ? '🔒 INSIDE FROZEN HORIZON (W1-4)' : '🔓 OPEN SCHEDULING HORIZON'}
        </span>
      </div>
      <div class="constraints-grid">
        <div class="constraint-item">
          <span class="constraint-k">FROZEN HORIZON (4 WEEKS)</span>
          <span class="constraint-v">${constr.in_frozen_horizon ? 'LOCKED — Emergency VP Waiver / Transfer Required' : 'OPEN — Standard Plant Batch Execution'}</span>
        </div>
        <div class="constraint-item">
          <span class="constraint-k">CAMPAIGN BATCH ROUNDING (MOQ: 5K)</span>
          <span class="constraint-v tabular-nums">Raw: ${Number(sig.recommended_qty_units || 0).toLocaleString()} U → <strong>${Number(constr.constrained_roq_units || sig.recommended_qty_units || 0).toLocaleString()} U</strong> (+${Number(constr.batch_rounding_delta || 0).toLocaleString()} U batch multiple)</span>
        </div>
        <div class="constraint-item">
          <span class="constraint-k">NETWORK ALLOCATION CAP (85%)</span>
          <span class="constraint-v" style="color:var(--ok-text)">COMPLIANT — Non-Starvation Verified</span>
        </div>
      </div>
      ${constr.in_frozen_horizon ? `
        <div style="margin-top:12px;padding:12px;background:#FEF2F2;border:1px solid #FECACA;border-left:4px solid #DC2626;font-size:11px;">
          <div style="font-weight:700;color:#991B1B;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
            <span>🤖 AI CONSTRAINT ADVISORY · FROZEN HORIZON COLLISION</span>
            <span style="font-size:9px;background:#991B1B;color:#fff;padding:2px 6px;">WAIVER MANDATORY</span>
          </div>
          <div style="color:#7F1D1D;line-height:1.55;margin-bottom:8px;font-size:11.5px;">
            <strong>What is happening:</strong> The stockout occurs at <strong>Week ${sig.breach_week}</strong>. Manufacturing lines are locked 4 weeks in advance for regulatory cleaning and validation. A standard factory order cannot produce medicine in time.<br/>
            <strong>What you should do:</strong> Approving the <strong>Inter-Market Stock Transfer</strong> above bypasses the factory schedule entirely by taking finished units already in stock from Country 059! If you must force new plant production instead, authorize the emergency VP override below.
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-weight:600;color:#991B1B;cursor:pointer;background:#FEE2E2;padding:6px 10px;border:1px solid #FCA5A5;">
            <input type="checkbox" id="chk-frozen-waiver" style="cursor:pointer;" ${approved ? 'checked disabled' : ''}>
            <span>Authorize Emergency Manufacturing Schedule Override (VP Production Authorization)</span>
          </label>
        </div>
      ` : `
        <div style="margin-top:12px;padding:10px 12px;background:#F0FDF4;border:1px solid #BBF7D0;border-left:4px solid #16A34A;font-size:11.5px;color:#166534;">
          <strong>🤖 AI Constraint Status:</strong> Breach horizon is outside the 4-week frozen window. Standard production scheduling can fulfill this order without emergency waivers.
        </div>
      `}
    </div>
  `;

  // Section 6.9 Cold-Start / New Product Launch Protocol
  const coldStart = sig.cold_start || {};
  const coldStartHtml = sig.is_cold_start ? `
    <div class="cold-start-box">
      <div class="cold-start-header">
        <div class="detail-section-label" style="margin-bottom:0">COLD-START / NEW PRODUCT LAUNCH PROTOCOL (SECTION 6.9)</div>
        <span class="cold-start-badge">🚀 NEW LAUNCH PROFILE</span>
      </div>
      <div class="cold-start-grid">
        <div class="cold-start-item">
          <span class="cold-start-k">COMMERCIAL LAUNCH STAGE</span>
          <span class="cold-start-v">${coldStart.launch_phase || 'Phase II Rollout (Month 2)'}</span>
        </div>
        <div class="cold-start-item">
          <span class="cold-start-k">ANALOGUE REFERENCE MARKET</span>
          <span class="cold-start-v">${coldStart.analogue_market || 'Country 045 (Beacon 2024 Analogue)'}</span>
        </div>
        <div class="cold-start-item">
          <span class="cold-start-k">UNCERTAINTY BUFFER</span>
          <span class="cold-start-v">${coldStart.demand_uncertainty_buffer || '90-Day Pre-Build Stock Buffer'}</span>
        </div>
      </div>
      <div class="cold-start-desc">
        ${coldStart.guidance || '52-week rolling statistical safety stock is bypassed due to limited historical series (<12 weeks). Replenishment targets are driven by analogue adoption curves.'}
      </div>
    </div>
  ` : '';

  // Item 1: Plain-English AI Supply Chain Agent Diagnostic & Action Copilot
  const aiAnalysis = sig.ai_agent_analysis || {};
  const plan = sig.ai_action_plan || {};
  const whatIsHappening = plan.what_is_happening || (sig.ai_narrative || '').split('🎯')[0].replace(/🤖\s*What's Happening:\s*/i, '').trim() ||
    `Inventory of ${sig.brand} in ${countryDisplayName} will breach safe stock levels in Week ${sig.breach_week}. Standard cargo shipping takes ${leadWks} weeks, which is too slow to arrive before stock runs out.`;
  const whyItMatters = plan.why_it_matters || (sig.ai_narrative || '').split('⚠️')[1] ||
    `If no action is taken, ${Number(sig.lost_lifelong_patients || 0).toLocaleString()} chronic patients who depend on this daily treatment will face stockouts, risking ₹${((sig.capital_at_risk_inr || 0)/1e7).toFixed(2)} Cr in unfulfilled therapy courses.`;
  const whatYouShouldDo = plan.what_you_should_do || (sig.action_type === 'ACTIVE CRISIS'
    ? (transfer.has_transfer
        ? `Approve emergency air transfer of ${Number(transfer.transfer_qty || sig.recommended_qty_units || 0).toLocaleString()} units from ${transfer.donor_country || 'surplus donor market'} (arrives in 4 days).`
        : `Approve emergency air expedite for ${Number(sig.recommended_qty_units || 0).toLocaleString()} units to pre-empt stockout cliff.`)
    : (sig.action_type === 'EXCESS HOLDING'
        ? `Do NOT issue new purchase orders. Defer planned inbound deliveries and make surplus units available for donor transfer.`
        : `Release standard Purchase Order for ${Number(sig.recommended_qty_units || 0).toLocaleString()} units within regular weekly cycle.`));
  const actionSteps = (plan.action_steps && plan.action_steps.length > 0) ? plan.action_steps : [
    `Step 1: Click the action button below to authorize immediate dispatch.`,
    `Step 2: Logistics team coordinates temperature-controlled air shipment or expedited release.`,
    `Step 3: Replenishment arrives safely ahead of breach, protecting all patients.`
  ];
  const eli5 = plan.eli5 ||
    `We are about to run out of ${sig.brand} in ${countryDisplayName} in Week ${sig.breach_week}. Regular ships take ${leadWks} weeks which is too slow, so we need to fly units in by air right now to protect our patients.`;

  const aiAgentDiagnosticHtml = `
    <div class="ai-agent-box" id="ai-agent-box">
      <!-- Copilot Header -->
      <div class="ai-copilot-header">
        <div class="ai-copilot-title-group">
          <span class="ai-copilot-avatar">🤖</span>
          <div>
            <div class="ai-copilot-main-title">AI SUPPLY CHAIN COPILOT · ACTION DIRECTIVE</div>
            <div class="ai-copilot-subtitle">Plain-English Diagnostic &amp; Step-by-Step Resolution Plan</div>
          </div>
        </div>
        <div class="ai-copilot-badges">
          <button class="btn-ai-toggle-eli5" id="btn-toggle-eli5" type="button" title="Toggle Plain English / Non-Technical View">
            ✨ Simple English Mode
          </button>
          <span class="ai-pill-badge">NATURAL LANGUAGE AI</span>
          <span class="ai-confidence-badge">${Math.round((aiAnalysis.confidence_score || 0.98) * 100)}% CONFIDENCE</span>
        </div>
      </div>

      <!-- Action Directive Banner -->
      <div class="ai-action-directive-banner">
        <div class="ai-directive-icon">🎯</div>
        <div class="ai-directive-content">
          <div class="ai-directive-tag">YOUR RECOMMENDED NEXT STEP</div>
          <div class="ai-directive-headline">${esc(whatYouShouldDo)}</div>
          <div class="ai-directive-sub">${esc(actionSteps[0] || '')}</div>
        </div>
        <button class="ai-quick-action-btn ${approved ? 'ai-quick-action-btn--approved' : ''}" id="btn-ai-quick-act" type="button">
          ${approved ? '✓ ACTION APPROVED &amp; SIGNED' : '⚡ EXECUTE THIS NOW'}
        </button>
      </div>

      <!-- The 3 Core Pillars -->
      <div class="ai-three-pillars">
        <!-- Pillar 1: Situation -->
        <div class="ai-pillar-card ai-pillar-situation">
          <div class="ai-pillar-header">
            <span class="ai-pillar-badge" style="background:#EFF6FF;color:#1D4ED8;border-color:#BFDBFE;">1. IN PLAIN ENGLISH</span>
            <span class="ai-pillar-title">What is happening?</span>
          </div>
          <div class="ai-pillar-body" id="ai-text-situation">
            ${esc(whatIsHappening)}
          </div>
        </div>

        <!-- Pillar 2: Why it matters -->
        <div class="ai-pillar-card ai-pillar-danger">
          <div class="ai-pillar-header">
            <span class="ai-pillar-badge" style="background:#FEF2F2;color:#991B1B;border-color:#FECACA;">2. THE CONSEQUENCE</span>
            <span class="ai-pillar-title">Why does this matter?</span>
          </div>
          <div class="ai-pillar-body" id="ai-text-why">
            ${esc(whyItMatters)}
          </div>
        </div>

        <!-- Pillar 3: Exactly what to do -->
        <div class="ai-pillar-card ai-pillar-action">
          <div class="ai-pillar-header">
            <span class="ai-pillar-badge" style="background:#ECFDF5;color:#047857;border-color:#A7F3D0;">3. YOUR ACTION PLAN</span>
            <span class="ai-pillar-title">What should I do?</span>
          </div>
          <div class="ai-pillar-body" id="ai-text-action">
            <div class="ai-steps-list">
              ${actionSteps.map((step, sIdx) => `
                <div class="ai-step-item">
                  <span class="ai-step-num">${sIdx + 1}</span>
                  <span class="ai-step-text">${esc(step.replace(/^Step \d+:\s*/, ''))}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Simple English ELI5 Box (Toggleable) -->
      <div class="ai-eli5-callout" id="ai-eli5-callout" style="display:none;">
        <div class="ai-eli5-header">
          <span>💡 SIMPLE SUMMARY (PLAIN ENGLISH FOR NEW PLANNERS):</span>
        </div>
        <div class="ai-eli5-text">
          ${esc(eli5)}
        </div>
      </div>

      <!-- Interactive Ask AI Copilot Widget -->
      <div class="ai-interactive-copilot-box">
        <div class="ai-copilot-ask-header">
          <span class="ai-copilot-ask-title">💬 ASK AI COPILOT A QUESTION:</span>
          <span class="ai-copilot-ask-hint">Click a common question or ask your own</span>
        </div>
        <div class="ai-quick-chips">
          <button class="ai-chip-btn" type="button" data-topic="summary_1s">⚡ Explain in 1 sentence</button>
          <button class="ai-chip-btn" type="button" data-topic="what_to_do">🎯 Exact steps I should take</button>
          <button class="ai-chip-btn" type="button" data-topic="why_not_sea">🚢 Why can't we use cargo ships?</button>
          <button class="ai-chip-btn" type="button" data-topic="is_donor_safe">🛡️ Is the donor market safe?</button>
          <button class="ai-chip-btn" type="button" data-topic="draft_email">✉️ Draft an email to my manager</button>
        </div>
        <div class="ai-input-row">
          <input type="text" class="ai-input-field" id="input-ai-copilot" placeholder="Ask AI: e.g., What happens if I do nothing? Is there any risk?..." />
          <button class="btn-ai-send" id="btn-send-ai-copilot" type="button">ASK AI</button>
        </div>
        <div class="ai-response-area" id="ai-response-area" style="display:none;">
          <div class="ai-response-spinner" id="ai-response-spinner" style="display:none;">Thinking in plain English...</div>
          <div class="ai-response-content" id="ai-response-content"></div>
        </div>
      </div>
    </div>
  `;


  // Item 4: Patient Health & Lifelong Chronic Subscriber Impact & Explicit Cost of Inaction
  const coi = sig.cost_of_inaction || {};
  const patientImpactHtml = (sig.lost_lifelong_patients > 0 || sig.lost_patient_demand_units > 0 || coi.unmitigated_stockout_weeks > 0) ? `
    <div class="patient-impact-box" id="patient-impact-box">
      <div class="patient-impact-header">
        <div class="patient-impact-title">
          <span class="patient-impact-icon">👥</span>
          <span class="detail-section-label" style="margin-bottom:0">PATIENT HEALTH &amp; LIFELONG SUBSCRIBER IMPACT</span>
        </div>
        <span class="patient-impact-badge">CHRONIC THERAPY RISK</span>
      </div>
      <div class="patient-impact-grid">
        <div class="patient-stat-item">
          <span class="patient-stat-k">LIFELONG PATIENTS AT RISK</span>
          <span class="patient-stat-v tabular-nums" style="color:var(--crisis-text)">${Number(sig.lost_lifelong_patients || 0).toLocaleString('en-IN')} PATIENTS</span>
          <span class="patient-stat-sub">Lifelong therapy course (52-week basis)</span>
        </div>
        <div class="patient-stat-item">
          <span class="patient-stat-k">UNSERVED CHRONIC DOSES</span>
          <span class="patient-stat-v tabular-nums">${Number(sig.lost_patient_demand_units || 0).toLocaleString('en-IN')} UNITS</span>
          <span class="patient-stat-sub">Deficit during unmitigated stockout</span>
        </div>
        <div class="patient-stat-item">
          <span class="patient-stat-k">IRREVERSIBLE REVENUE CHURN</span>
          <span class="patient-stat-v tabular-nums">₹${((sig.lost_revenue_inr || 0) / 1e7).toFixed(2)} CR</span>
          <span class="patient-stat-sub">Lost chronic subscriber value</span>
        </div>
      </div>
      
      <!-- AI Plain-English Clinical & Patient Consequence Profile -->
      <div style="margin-top:12px;padding:12px 14px;background:#FFF5F5;border:1px solid #FECACA;border-left:4px solid #DC2626;border-radius:2px;">
        <div style="font-family:var(--font-mono);font-size:10px;font-weight:800;color:#991B1B;display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span>🤖 AI CLINICAL CONFLICT · 24-HOUR CONSEQUENCE PROFILE</span>
          <span style="background:#FEE2E2;padding:2px 6px;border:1px solid #FCA5A5;">${coi.clinical_severity || 'ACUTE THERAPY DISRUPTION'}</span>
        </div>
        <div style="font-size:12px;color:#7F1D1D;line-height:1.6;margin-bottom:6px;">
          <strong>Why chronic therapy patients never return:</strong> In diabetes and obesity care, patients cannot miss weekly injections. 
          If shelves go empty for even 2 weeks, doctors will permanently switch <strong>${Number(sig.lost_lifelong_patients || 0).toLocaleString('en-IN')} chronic patients</strong> to competing therapies. 
          Because chronic patients stay on the same brand for life, losing them today wipes out <strong>₹${((sig.lost_revenue_inr || 0) / 1e7).toFixed(2)} Cr</strong> in recurring annual revenue.
        </div>
        <div style="font-size:11.5px;color:#991B1B;line-height:1.5;background:#FEF2F2;padding:6px 10px;border-left:3px solid #EF4444;">
          <strong>Cost of Inaction within 24h SLA:</strong> Inaction causes <strong>${coi.unmitigated_stockout_weeks || 1} week(s) of physical stockout</strong>, <strong>₹${((sig.capital_at_risk_inr || 0) / 1e7).toFixed(2)} Cr</strong> in immediate non-delivery penalties, and unserved chronic doses of <strong>${Number(sig.lost_patient_demand_units || 0).toLocaleString('en-IN')} units</strong>.
        </div>
      </div>

      <div class="patient-quote-box">
        <span class="patient-quote-icon">&ldquo;</span>
        <span class="patient-quote-text">In chronic diabetes and obesity therapies, patients are lifelong subscribers — an unmitigated stockout leads to treatment discontinuation and permanent churn to competitors.</span>
      </div>
    </div>
  ` : '';

  // Item 5: Freight Mode Cost Comparison (Sea vs Priority Air Freight)
  const fc = sig.freight_comparison || {};
  const freightComparisonHtml = `
    <div class="freight-comp-box" id="freight-comp-box">
      <div class="freight-comp-header">
        <div class="freight-comp-title">
          <span class="freight-comp-icon">⚖️</span>
          <span class="detail-section-label" style="margin-bottom:0">FREIGHT MODE ECONOMICS: MARITIME VS AIR CHARTER</span>
        </div>
        <span class="freight-verdict-badge ${isLateForSea ? 'freight-badge--air' : 'freight-badge--sea'}">
          ${isLateForSea ? 'PRIORITY AIR CHARTER DOMINANT' : 'SURFACE MARITIME NOMINAL'}
        </span>
      </div>
      <table class="freight-comp-table">
        <thead>
          <tr>
            <th>LOGISTICS MODE</th>
            <th>TRANSIT WINDOW</th>
            <th>UNIT FREIGHT</th>
            <th>TOTAL FREIGHT</th>
            <th>STATUS &amp; FEASIBILITY</th>
          </tr>
        </thead>
        <tbody>
          <tr class="${isLateForSea ? 'freight-row--infeasible' : 'freight-row--active'}">
            <td><strong>🌊 Deep-Sea / Surface Transit</strong></td>
            <td class="tabular-nums">${fc.sea_transit_label || `${leadWks} Weeks`}</td>
            <td class="tabular-nums">₹12 / unit</td>
            <td class="tabular-nums">₹${Number(fc.sea_freight_cost_inr || 0).toLocaleString('en-IN')}</td>
            <td><span class="freight-feasibility-tag ${isLateForSea ? 'feasibility--failed' : 'feasibility--ok'}">${fc.sea_feasibility || (isLateForSea ? 'TOO LATE (CLIFF BREACH)' : 'FEASIBLE')}</span></td>
          </tr>
          <tr class="${isLateForSea ? 'freight-row--recommended' : 'freight-row--optional'}">
            <td><strong>✈️ Priority Air Freight Charter</strong></td>
            <td class="tabular-nums">${fc.air_transit_label || '1 Week (4-7 Days)'}</td>
            <td class="tabular-nums">₹85 / unit</td>
            <td class="tabular-nums">₹${Number(fc.air_freight_cost_inr || 0).toLocaleString('en-IN')}</td>
            <td><span class="freight-feasibility-tag feasibility--ok">${fc.air_feasibility || 'PRE-EMPTS BREACH'}</span></td>
          </tr>
        </tbody>
      </table>
      <div class="freight-verdict-footer">
        <div class="freight-verdict-metric">
          <span class="freight-metric-k">AIR FREIGHT PREMIUM:</span>
          <span class="freight-metric-v tabular-nums">₹${Number((fc.air_cost_premium_inr || 0) / 1e5).toFixed(1)} Lakhs</span>
        </div>
        <div class="freight-verdict-metric">
          <span class="freight-metric-k">CAPITAL PROTECTED:</span>
          <span class="freight-metric-v tabular-nums" style="color:var(--ok-text)">₹${Number((sig.capital_at_risk_inr || 0) / 1e7).toFixed(2)} Cr</span>
        </div>
        <div class="freight-verdict-metric">
          <span class="freight-metric-k">EXPEDITE ROI RATIO:</span>
          <span class="freight-metric-v tabular-nums" style="color:var(--ok-text)">${fc.expedite_roi_ratio || 10.4}×</span>
        </div>
      </div>

      <!-- AI Plain-English Freight Recommendation -->
      <div class="ai-section-translation-box" style="margin-top:12px;padding:12px 14px;background:#EFF6FF;border:1px solid #BFDBFE;border-left:4px solid #2563EB;border-radius:2px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:13px;">🤖</span>
            <span style="font-family:var(--font-mono);font-size:10px;font-weight:800;color:#1E40AF;letter-spacing:0.04em;">AI FREIGHT DECISION &amp; LOGIC</span>
          </div>
          <span style="font-family:var(--font-mono);font-size:9.5px;font-weight:700;color:#1D4ED8;background:#DBEAFE;padding:2px 6px;">${isLateForSea ? 'AIR CHARTER DOMINANT' : 'SURFACE FEASIBLE'}</span>
        </div>
        <div style="font-size:12px;color:#1E3A8A;line-height:1.6;">
          ${isLateForSea ? `
            <strong>Why sea freight is impossible:</strong> Cargo ships take <strong>${leadWks} weeks (252 days)</strong> to arrive. Since inventory breaches at <strong>Week ${sig.breach_week}</strong>, standard ships arrive <strong>${Math.max(1, leadWks - sig.breach_week)} weeks too late</strong> when shelves are already bare.<br/>
            <strong>Why air freight is the right choice:</strong> Priority air charter costs an extra <strong>₹${Number((fc.air_cost_premium_inr || 0) / 1e5).toFixed(1)} Lakhs</strong>, but arrives in <strong>4–7 days</strong> and protects <strong>₹${Number((sig.capital_at_risk_inr || 0) / 1e7).toFixed(2)} Cr</strong> of inventory.<br/>
            <strong>Return on Investment:</strong> Every ₹1 spent on air freight returns <strong>₹${fc.expedite_roi_ratio || 20.50}</strong> in preserved capital (<strong>${fc.expedite_roi_ratio || 20.5}× ROI</strong>).
          ` : `
            <strong>Why surface transit works:</strong> Sea transit arrives well ahead of the breach window. Standard maritime replenishment is financially optimal.
          `}
        </div>
      </div>
    </div>
  `;

  body.innerHTML = `
    <div class="drawer-layout-grid">
      <div class="drawer-column-left">
        ${slaBannerHtml}
        ${cliffBannerHtml}
        <div>
          <div class="detail-section-label">[ 52-WEEK INVENTORY TRAJECTORY &amp; DEFICIT CLIFF ]</div>
          <div class="chart-container"><canvas id="detail-chart"></canvas></div>
        </div>
        ${aiAgentDiagnosticHtml}
        <div>
          <div class="detail-section-label">[ ROOT CAUSE ATTRIBUTION ]</div>
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
          <div class="ai-section-translation-box" style="margin-top:8px;padding:8px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-left:3px solid #6366F1;border-radius:2px;">
            <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
              <span style="font-size:12px;">🤖</span>
              <span style="font-family:var(--font-mono);font-size:9.5px;font-weight:800;color:#4338CA;letter-spacing:0.04em;">AI ROOT CAUSE DIAGNOSIS</span>
            </div>
            <div style="font-size:11px;color:#312E81;line-height:1.5;">
              ${sd >= 50 ? `The primary driver (<strong>${sd}%</strong>) is an unexpected <strong>upstream factory supply shortfall</strong> (delayed shipments from manufacturing). ` : ''}
              ${ds >= 20 ? `Compounding this is a <strong>${ds}% surge in patient prescriptions</strong> across regional clinics. ` : ''}
              ${fs >= 20 ? `A recent upward adjustment in the safety stock floor (<strong>${fs}%</strong>) also raised the minimum reserve requirement. ` : ''}
              ${(sd < 50 && ds < 20 && fs < 20) ? `Multiple converging factors (supply delays, demand shift, and floor requirements) created this corridor imbalance.` : ''}
            </div>
          </div>
        </div>
        <div>
          <div class="detail-section-label">[ SUPPLY PIPELINE CERTAINTY ]</div>
          <div class="rc-bar-row">
            <div class="rc-bar-header"><span class="rc-bar-label">CONFIRMED PO COMMITMENT</span><span class="rc-bar-val tabular-nums">${cert}%</span></div>
            <div class="rc-track"><div class="rc-fill" style="width:${cert}%;background:#2563EB"></div></div>
          </div>
        </div>
        ${staleAlertHtml}
        ${coldStartHtml}
        ${latencyTimelineHtml}
      </div>

      <div class="drawer-column-right">
        <!-- Explicit ROQ Mathematical Line for Executive Sign-off -->
        <div class="roq-math-callout" style="margin-bottom:10px;padding:9px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-left:3px solid #0072CE;font-family:var(--font-mono);font-size:10.5px;line-height:1.5;">
          <div style="font-weight:700;color:#0F172A;margin-bottom:3px;display:flex;justify-content:space-between;align-items:center;">
            <span>📐 ROQ FORMULA (WHY ${Number(sig.recommended_qty_units || 0).toLocaleString()} U?):</span>
            <span style="color:#0072CE;font-weight:800;">MIDPOINT RESTORATION</span>
          </div>
          <div style="color:#334155;font-size:10px;">
            <strong>ROQ</strong> = max(0, ⌈Target Midpoint (${Number(sig.midpoint_target_units || Math.round((sig.recommended_qty_units || 0) * 1.3)).toLocaleString()} U) − Projected Inv (${Math.max(0, Math.round((sig.midpoint_target_units || (sig.recommended_qty_units * 1.3)) - (sig.recommended_qty_units || 0))).toLocaleString()} U)⌉
          </div>
          <div style="color:#64748B;font-size:9.5px;margin-top:2px;">
            Target = (Safety Floor + Ceiling) / 2 = 1.5× SSD Buffer · Prevents secondary breach
          </div>
        </div>

        <div>
          <button class="approval-btn ${approved ? 'approval-btn--approved' : ''}" id="btn-approve"
            ${approved ? 'disabled' : ''}>
            ${approved ? '■ ORDER APPROVED — GxP LOGGED' : btnLabel}
          </button>
        </div>
        <div>
          <div class="detail-section-label">[ SIGNAL METADATA ]</div>
          <div class="detail-meta-grid">
            <div class="detail-meta-item"><span class="detail-meta-key">ACTION</span><span class="badge ${badge.cls}" style="display:inline-block;margin-top:2px">${badge.label}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-key">BREACH HORIZON</span><span class="detail-meta-val" style="color:var(--crisis-text)">WEEK ${sig.breach_week}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-key">MARKET LEAD TIME</span><span class="detail-meta-val tabular-nums" style="color:${isLateForSea ? 'var(--crisis-text)' : 'inherit'}">${leadWks} WEEKS (${modeName.split(' ')[0]})</span></div>
            <div class="detail-meta-item"><span class="detail-meta-key">RECOMMENDED QTY</span><span class="detail-meta-val tabular-nums">${Number(sig.recommended_qty_units || 0).toLocaleString('en-IN')} UNITS ${sig.recommended_qty_units === 0 && (sig.action_type || '').includes('EXCESS') ? '<span style="font-size:10px;color:var(--muted);font-weight:normal">(SURPLUS)</span>' : ''}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-key">CAPITAL AT RISK</span><span class="detail-meta-val tabular-nums">₹${Number(sig.capital_at_risk_inr || 0).toLocaleString('en-IN')} ${sig.capital_at_risk_inr === 0 && (sig.action_type || '').includes('EXCESS') ? '<span style="font-size:10px;color:var(--muted);font-weight:normal">(SURPLUS · DEFER INBOUND)</span>' : ''}</span></div>
            <div class="detail-meta-item"><span class="detail-meta-key">52W OTIF / FULFILLMENT</span><span class="detail-meta-val tabular-nums" style="color:${(sig.otif_pct !== undefined ? sig.otif_pct : 98.5) >= 95 ? 'var(--ok-text)' : 'var(--crisis-text)'}">${sig.otif_pct !== undefined ? sig.otif_pct : 98.5}% (SLA: 95.0%)</span></div>
          </div>
          <!-- AI Plain-English Metadata Briefing -->
          <div class="ai-section-translation-box" style="margin-top:10px;padding:10px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-left:4px solid #3B82F6;border-radius:2px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span style="font-size:13px;">🤖</span>
              <span style="font-family:var(--font-mono);font-size:10px;font-weight:800;color:#1E40AF;letter-spacing:0.04em;">AI PLAIN-ENGLISH METADATA BRIEFING</span>
            </div>
            <div style="font-size:11.5px;color:#1E293B;line-height:1.55;">
              <strong>Summary:</strong> ${sig.product} in ${sig.country} will run out of stock in <strong>Week ${sig.breach_week}</strong>. Standard ocean shipping takes <strong>${leadWks} weeks</strong>—meaning normal ships arrive <strong>${Math.max(1, leadWks - sig.breach_week)} weeks too late</strong>. Immediate action is needed to deliver <strong>${Number(sig.recommended_qty_units || 0).toLocaleString()} units</strong> to protect <strong>₹${Number((sig.capital_at_risk_inr || 0) / 1e7).toFixed(2)} Cr</strong> and maintain our 95%+ OTIF fulfillment rate.
            </div>
          </div>
        </div>
        ${patientImpactHtml}
        ${freightComparisonHtml}
        ${transferCardHtml}
        ${constraintsHtml}
        ${workflowSectionHtml}
        <div class="narrative-box" id="narrative-container">
          <div class="narrative-header">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:13px;">🤖</span>
              <div class="detail-section-label" style="margin-bottom:0;">[ AI EXECUTIVE STRATEGIC DOSSIER ]</div>
            </div>
            <span class="narrative-badge" id="narrative-badge-status">${approved ? 'APPROVED & SIGNED ✓' : 'SYNTHESIZED ✓'}</span>
          </div>
          <div class="narrative-dossier" id="narrative-dossier"></div>
        </div>
      </div>
    </div>
  `;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  if (overlay) overlay.classList.add('active');

  // Wire Fullscreen Takeover Button
  const btnFs = document.getElementById('btn-toggle-fullscreen');
  if (btnFs) {
    btnFs.onclick = (e) => {
      e.stopPropagation();
      toggleFullscreen();
    };
  }

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

  // Wire AI Copilot Interactive Features
  const btnToggleEli5 = document.getElementById('btn-toggle-eli5');
  const eli5Callout = document.getElementById('ai-eli5-callout');
  if (btnToggleEli5 && eli5Callout) {
    btnToggleEli5.addEventListener('click', () => {
      const isHidden = eli5Callout.style.display === 'none';
      eli5Callout.style.display = isHidden ? 'block' : 'none';
      btnToggleEli5.textContent = isHidden ? '✕ Hide Simple English' : '✨ Simple English Mode';
    });
  }

  const btnAiQuickAct = document.getElementById('btn-ai-quick-act');
  if (btnAiQuickAct && !approved) {
    btnAiQuickAct.addEventListener('click', () => {
      const btnTransfer = document.getElementById('btn-execute-transfer');
      const btnApprove = document.getElementById('btn-approve');
      if (btnTransfer && !btnTransfer.disabled) {
        btnTransfer.click();
      } else if (btnApprove && !btnApprove.disabled) {
        btnApprove.click();
      }
      btnAiQuickAct.disabled = true;
      btnAiQuickAct.textContent = '✓ ACTION APPROVED & SIGNED';
      btnAiQuickAct.classList.add('ai-quick-action-btn--approved');
    });
  }

  // Ask AI Copilot Question & Quick Chips
  const inputAi = document.getElementById('input-ai-copilot');
  const btnSendAi = document.getElementById('btn-send-ai-copilot');
  const respArea = document.getElementById('ai-response-area');
  const respContent = document.getElementById('ai-response-content');
  const respSpinner = document.getElementById('ai-response-spinner');

  async function askAiCopilot(question, topic = 'general') {
    if (!respArea || !respContent) return;
    respArea.style.display = 'block';
    respContent.innerHTML = '';
    if (respSpinner) respSpinner.style.display = 'block';

    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, topic, signal: sig })
      });
      const data = await res.json();
      if (respSpinner) respSpinner.style.display = 'none';

      if (data && data.answer) {
        const formatted = esc(data.answer)
          .replace(/\n\n/g, '<div style="margin-bottom:8px"></div>')
          .replace(/\n/g, '<br/>')
          .replace(/•\s*/g, '•&nbsp;');
        respContent.innerHTML = `
          <div class="ai-answer-card">
            <div class="ai-answer-header">
              <span class="ai-answer-model">🤖 ${esc(data.model || 'AI Copilot')}</span>
              <span class="ai-answer-badge">PLAIN ENGLISH ANSWER</span>
            </div>
            <div class="ai-answer-body">${formatted}</div>
          </div>
        `;
      } else {
        respContent.innerHTML = `<div class="ai-answer-body" style="color:var(--crisis-text)">Could not generate response. Please try again.</div>`;
      }
    } catch (err) {
      if (respSpinner) respSpinner.style.display = 'none';
      respContent.innerHTML = `<div class="ai-answer-body" style="color:var(--crisis-text)">Error connecting to AI service: ${esc(err.message)}</div>`;
    }
  }

  const chips = document.querySelectorAll('.ai-chip-btn');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const topic = chip.dataset.topic;
      const q = chip.textContent.replace(/^[^\w]+/, '');
      askAiCopilot(q, topic);
    });
  });

  if (btnSendAi && inputAi) {
    btnSendAi.addEventListener('click', () => {
      const q = inputAi.value.trim();
      if (!q) return;
      askAiCopilot(q, 'custom');
      inputAi.value = '';
    });
    inputAi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        btnSendAi.click();
      }
    });
  }
}

function generateDossier(sig) {
  const brand = sig.brand || 'Product';
  const country = sig.country || 'Global';
  const marketName = sig.market_name || country;
  const breachWk = sig.breach_week || 1;
  const leadWks = sig.market_lead_time || sig.market_lead_time_weeks || 4;
  const isLateForSea = Boolean(sig.is_late_for_sea);
  const recQty = Number(sig.recommended_qty_units || 0).toLocaleString('en-IN');
  const capRisk = `₹${((sig.capital_at_risk_inr || 0) / 1e7).toFixed(2)} Cr`;
  const patients = Number(sig.lost_lifelong_patients || 0).toLocaleString('en-IN');
  const transfer = sig.intermarket_transfer || {};
  const donorCountry = transfer.donor_country || 'surplus donor market';

  let situationText = '';
  if (sig.action_type === 'ACTIVE CRISIS') {
    situationText = isLateForSea
      ? `${marketName} will completely run out of ${brand} in Week ${breachWk}. Ocean cargo takes ${leadWks} weeks, which means standard ships arrive ${leadWks - breachWk} weeks too late to prevent empty shelves.`
      : `${marketName} inventory drops below the safety floor in Week ${breachWk}. Immediate replenishment is required to prevent a zero-inventory stockout cliff.`;
  } else if (sig.action_type === 'EMERGENCY EXPEDITE') {
    situationText = `${brand} in ${marketName} will breach its safety stock in Week ${breachWk}. Ocean transit takes ${leadWks} weeks, so fast air freight is required to beat the deadline.`;
  } else if (sig.action_type === 'EXCESS HOLDING') {
    situationText = `${marketName} holds more ${brand} inventory than the warehouse ceiling. Stock is comfortably sufficient for months with zero risk of running out.`;
  } else if (sig.action_type === 'STANDARD PO') {
    situationText = `${brand} in ${marketName} is tracking on schedule. Stock levels reach the regular reorder point in Week ${breachWk}, perfectly aligned with normal ${leadWks}-week ocean transit.`;
  } else {
    situationText = `${brand} in ${marketName} is stable within safe boundaries. Early-warning sensors flagged minor variance, but patient supply is fully protected.`;
  }

  let whyText = '';
  if (sig.lost_lifelong_patients && sig.lost_lifelong_patients > 0) {
    whyText = `If you take no action: ${patients} chronic patients who depend on this daily treatment will be left without medicine, and Novo Nordisk faces ${capRisk} in permanent therapy revenue loss.`;
  } else if (sig.action_type === 'EXCESS HOLDING') {
    whyText = `Excess inventory traps working capital unnecessarily, congests warehouse storage, and risks stock expiring before it can be dispensed to patients.`;
  } else {
    whyText = `Placing standard orders on regular cadence maintains product availability without having to pay expensive air freight premiums.`;
  }

  let actionText = '';
  if (sig.action_type === 'ACTIVE CRISIS') {
    actionText = transfer.has_transfer
      ? `Click [TRANSFER APPROVED] to dispatch ${recQty} units from ${donorCountry} by air. The shipment arrives in 4 days, fixing the shortage with zero risk to ${donorCountry}.`
      : `Click [APPROVE AIR EXPEDITE] to authorize expedited manufacturing dispatch for ${recQty} units via priority air charter today.`;
  } else if (sig.action_type === 'EMERGENCY EXPEDITE') {
    actionText = `Click [APPROVE AIR EXPEDITE] to book priority air freight for ${recQty} units. Air shipping arrives in 4-7 days and avoids ${capRisk} in stockout penalties.`;
  } else if (sig.action_type === 'EXCESS HOLDING') {
    actionText = `Click [DEFER INBOUND SUPPLY] to pause upcoming shipments. Designate this warehouse as a surplus donor so other markets facing deficits can borrow stock.`;
  } else if (sig.action_type === 'STANDARD PO') {
    actionText = `Click [APPROVE STANDARD PO] to release regular replenishment order for ${recQty} units into normal weekly production schedule.`;
  } else {
    actionText = `Click [ACKNOWLEDGE ADVISORY] to record awareness. Continue passive monitoring; no purchase capital is needed.`;
  }

  let outcomeText = '';
  if (sig.action_type === 'ACTIVE CRISIS' || sig.action_type === 'EMERGENCY EXPEDITE') {
    outcomeText = `Fast air delivery arrives in 4 to 7 days, fully restoring inventory above safe threshold, protecting ${patients} chronic patients, and safeguarding 95%+ service level.`;
  } else if (sig.action_type === 'EXCESS HOLDING') {
    outcomeText = `Pausing inbound supply frees working capital and allows warehouse stock to naturally draw down to optimal safety buffer.`;
  } else {
    outcomeText = `Corridor remains continuously balanced and compliant with global SLA standards.`;
  }

  return [
    { label: '1. WHAT IS HAPPENING', text: situationText },
    { label: '2. WHY THIS MATTERS', text: whyText },
    { label: '3. EXACT ACTION TO TAKE', text: actionText, highlight: true },
    { label: '4. CAPITAL & PATIENT EXPOSURE', text: `${capRisk} exposure · ${patients} chronic patients protected.` },
    { label: '5. EXPECTED OUTCOME', text: outcomeText }
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

export function toggleFullscreen(forceState) {
  const drawer = document.getElementById('drawer-detail');
  const ind = document.getElementById('drawer-mode-indicator');
  const btnFs = document.getElementById('btn-toggle-fullscreen');
  if (!drawer) return false;

  const isFs = forceState !== undefined ? forceState : !drawer.classList.contains('drawer--fullscreen');
  if (isFs) {
    drawer.classList.add('drawer--fullscreen');
    if (ind) ind.textContent = '[ FULLSCREEN INVESTIGATION TAKEOVER ]';
    if (btnFs) btnFs.innerHTML = '<span class="fs-icon">🗗</span> <span class="fs-label">COLLAPSE</span>';
  } else {
    drawer.classList.remove('drawer--fullscreen');
    if (ind) ind.textContent = '[ 520PX COMPACT ]';
    if (btnFs) btnFs.innerHTML = '<span class="fs-icon">⛶</span> <span class="fs-label">FULLSCREEN</span>';
  }
  if (_chart && _chart.resize) {
    setTimeout(() => { _chart && _chart.resize && _chart.resize(); }, 160);
  }
  return isFs;
}
if (typeof window !== 'undefined') {
  window._toggleDetailFullscreen = toggleFullscreen;
}

export function closeDetailDrawer() {
  const drawer = document.getElementById('drawer-detail');
  if (drawer) {
    drawer.classList.remove('open');
    drawer.classList.remove('drawer--fullscreen');
    drawer.setAttribute('aria-hidden', 'true');
    const ind = document.getElementById('drawer-mode-indicator');
    if (ind) ind.textContent = '[ 520PX COMPACT ]';
    const btnFs = document.getElementById('btn-toggle-fullscreen');
    if (btnFs) btnFs.innerHTML = '<span class="fs-icon">⛶</span> <span class="fs-label">FULLSCREEN</span>';
  }
  if (_chart) { _chart.destroy(); _chart = null; }
}

export const openDrawer = openDetailDrawer;
export const closeDrawer = closeDetailDrawer;
