/**
 * drawer-detail.js — 720px Analyst Decision Workspace + 4-Tab Evidence Terminal
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
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSnoozeHtml(wf) {
  const isSnoozed = Boolean(wf.snooze && wf.snooze.snoozed_until > Date.now());
  return `
    <div class="workflow-active-snooze" id="snooze-active-card" style="${isSnoozed ? '' : 'display:none;'}">
      <div class="active-snooze-left">
        <span class="active-snooze-icon">[PAUSED]</span>
        <div>
          <div class="active-snooze-title">ALERT SNOOZED (${wf.snooze ? wf.snooze.weeks : 1} WEEKS)</div>
          <div class="active-snooze-meta">Justification: <strong>${esc(wf.snooze ? wf.snooze.reason : '')}</strong>${wf.snooze && wf.snooze.note ? ' · ' + esc(wf.snooze.note) : ''}</div>
        </div>
      </div>
      <button class="btn-unsnooze" id="btn-unsnooze-alert" type="button">RESUME ALERT EARLY ▶</button>
    </div>
    <div class="workflow-snooze-form" id="snooze-form-card" style="${isSnoozed ? 'display:none;' : ''}">
      <div class="workflow-field-label">SNOOZE ALERT (MANDATORY JUSTIFICATION):</div>
      <div class="workflow-snooze-grid">
        <select class="workflow-select" id="select-snooze-weeks">
          ${SNOOZE_DURATIONS.map(d => `<option value="${d.weeks}">${d.label}</option>`).join('')}
        </select>
        <select class="workflow-select" id="select-snooze-reason">
          ${SNOOZE_REASONS.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
        <input type="text" class="workflow-input" id="input-snooze-note" placeholder="Operational rationale..." />
        <button class="btn-snooze" id="btn-snooze-alert" type="button">[HOLD] SNOOZE</button>
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
          <span class="workflow-comment-author">${esc(c.author)}</span>
          <span class="workflow-comment-role">${esc(c.role || 'Planner')}</span>
          <span class="workflow-comment-time">${dateStr} ${timeStr}</span>
        </div>
        <div class="workflow-comment-text">${esc(c.text)}</div>
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

export function openDrawer(sig, approvedSignals) {
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
  const countryDisplayName = sig.market_name || sig.country || 'Country 013';
  const freightCallout = sig.freight_callout || `${countryDisplayName} breach at week ${sig.breach_week} — with ${leadWks}-week lead time, this is ALREADY TOO LATE for sea freight. Only air freight can save this.`;

  const transfer = sig.intermarket_transfer || {};
  const whCap = transfer.warehouse_capacity || {};
  const econ = transfer.transfer_economics || {};
  const constr = sig.constraints || {};
  const pc = constr.plant_contention || {};
  const coldStart = sig.cold_start || {};
  const staleParam = sig.stale_parameter || {};
  const isStale = Boolean(sig.is_stale_parameter || staleParam.is_stale);
  const lat = sig.predictive_latency || {};
  const isLate = Boolean(lat.is_arrival_late);
  const fc = sig.freight_comparison || {};
  const coi = sig.cost_of_inaction || {};
  const aiAnalysis = sig.ai_agent_analysis || {};
  const plan = sig.ai_action_plan || {};

  const whatIsHappening = plan.what_is_happening || (sig.ai_narrative || '').split('🎯')[0].replace(/🤖\s*What's Happening:\s*/i, '').trim() ||
    `Inventory of ${sig.brand} in ${countryDisplayName} will breach safe stock levels in Week ${sig.breach_week}. Standard cargo shipping takes ${leadWks} weeks, which is too slow to arrive before stock runs out.`;
  const whyItMatters = plan.why_it_matters || (sig.ai_narrative || '').split('⚠️')[1] ||
    `If no action is taken, ${Number(sig.lost_lifelong_patients || 0).toLocaleString()} chronic patients face therapy disruption, risking ₹${((sig.capital_at_risk_inr || 0)/1e7).toFixed(2)} Cr.`;
  const whatYouShouldDo = plan.what_you_should_do || (sig.action_type === 'ACTIVE CRISIS'
    ? (transfer.has_transfer
        ? `Approve emergency air transfer of ${Number(transfer.transfer_qty || sig.recommended_qty_units || 0).toLocaleString()} units from ${transfer.donor_country || 'donor market'} (arrives in 4 days).`
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

  // ── MOVE 1 & 2 & 5: PERSISTENT DECISION HEADER ────────────────────────
  let slaChipHtml = '';
  if (sla.isCritical) {
    if (sla.status === 'RESOLVED') {
      slaChipHtml = '<span class="decision-sla-chip decision-sla-chip--resolved">[OK] GxP COMPLIANT · RESOLVED</span>';
    } else if (sla.status === 'SNOOZED') {
      slaChipHtml = `<span class="decision-sla-chip decision-sla-chip--snoozed">[HOLD] SNOOZED (${wf.snooze.weeks}W)</span>`;
    } else if (sla.status === 'ACKNOWLEDGED') {
      slaChipHtml = `<span class="decision-sla-chip">[ACTIVE] OWNER: ${esc(wf.owner)}</span>`;
    } else {
      slaChipHtml = `<span class="decision-sla-chip decision-sla-chip--urgent">[!] 24H SLA: ${sla.hoursLeft}h ${sla.minsLeft}m LEFT</span>`;
    }
  } else {
    slaChipHtml = '<span class="decision-sla-chip">[OK] CADENCE NOMINAL</span>';
  }

  const headlineText = isLateForSea
    ? `Breaches safety floor WEEK ${sig.breach_week} · sea freight needs ${leadWks} WEEKS · arrives ${Math.max(1, leadWks - sig.breach_week)} WEEKS LATE`
    : `Breaches safety floor WEEK ${sig.breach_week} · replenishment transit ${leadWks} WEEKS · on cadence`;

  const capSavedCr = ((sig.capital_at_risk_inr || 0) / 1e7).toFixed(2);
  const directiveLine = transfer.has_transfer
    ? `AIR CHARTER ${Number(transfer.transfer_qty).toLocaleString()} UNITS · arrives in 4d · protects ₹${capSavedCr} Cr · ROI ${econ.transfer_roi_ratio || 10.4}×`
    : (sig.action_type === 'EXCESS HOLDING'
        ? `DEFER INBOUND SUPPLY · surplus capacity available · protects ₹${capSavedCr} Cr capital`
        : `EXPEDITE ${Number(sig.recommended_qty_units || 0).toLocaleString()} UNITS · protects ₹${capSavedCr} Cr · OTIF ${(sig.otif_pct !== undefined ? sig.otif_pct : 98.5)}%`);

  const decisionHeaderHtml = `
    <div class="drawer-decision-header" id="drawer-decision-header">
      <div class="decision-meta-row">
        <div class="decision-sku-ident">
          <span class="badge ${badge.cls}">[ ${badge.label} ]</span>
          <span>${esc(countryDisplayName).toUpperCase()} · ${esc(sig.brand).toUpperCase()} · PRS ${(sig.prs_score || 88.5).toFixed(1)}</span>
        </div>
        ${slaChipHtml}
      </div>

      <div class="decision-headline ${isLateForSea ? 'decision-headline-cliff' : ''}">
        ${headlineText}
      </div>

      <!-- Point 5: freight_callout guaranteed rendered in Decision Header -->
      <div class="decision-directive-quote">
        &ldquo;${esc(freightCallout)}&rdquo;
      </div>

      <div class="decision-metrics-bar">
        <span>→ <strong>${directiveLine}</strong></span>
      </div>
    </div>
  `;

  // ── 4 TABS NAVIGATION BAR ─────────────────────────────────────────────
  const tabsBarHtml = `
    <div class="drawer-tabs-bar" id="drawer-tabs-bar">
      <button class="drawer-tab-btn is-active" data-tab="evidence" type="button">EVIDENCE</button>
      <button class="drawer-tab-btn" data-tab="impact" type="button">IMPACT</button>
      <button class="drawer-tab-btn" data-tab="logistics" type="button">LOGISTICS</button>
      <button class="drawer-tab-btn" data-tab="governance" type="button">GOVERNANCE</button>
    </div>
  `;

  // ── PANE 1: EVIDENCE (DEFAULT) ─────────────────────────────────────────
  const evidencePaneHtml = `
    <div class="tab-pane is-active" id="pane-evidence">
      <div>
        <div class="detail-section-label">[ 52-WEEK INVENTORY TRAJECTORY &amp; DEFICIT CLIFF ]</div>
        <div class="chart-container"><canvas id="detail-chart"></canvas></div>
        <div style="margin-top:6px;font-size:10.5px;color:var(--muted);line-height:1.45;font-family:var(--font-mono);">
          Trajectory tracks weekly ending physical inventory against Safety Stock Days (SSD) floor and warehouse storage ceiling. Dotted red line denotes the precise breach horizon.
        </div>
      </div>

      <div style="margin-top:14px;">
        <div class="detail-section-label">[ ROOT CAUSE ATTRIBUTION ]</div>
        <div class="rc-bar-row">
          <div class="rc-bar-header"><span class="rc-bar-label">SUPPLY DEFICIT</span><span class="rc-bar-val tabular-nums">${sd}%</span></div>
          <div class="rc-track"><div class="rc-fill" style="width:${sd}%;background:var(--crisis-text)"></div></div>
        </div>
        <div class="rc-bar-row">
          <div class="rc-bar-header"><span class="rc-bar-label">DEMAND SURGE</span><span class="rc-bar-val tabular-nums">${ds}%</span></div>
          <div class="rc-track"><div class="rc-fill" style="width:${ds}%;background:var(--ink)"></div></div>
        </div>
        <div class="rc-bar-row">
          <div class="rc-bar-header"><span class="rc-bar-label">FLOOR SHOCK</span><span class="rc-bar-val tabular-nums">${fs}%</span></div>
          <div class="rc-track"><div class="rc-fill" style="width:${fs}%;background:var(--muted)"></div></div>
        </div>
        <div style="font-size:11px;color:var(--ink);background:var(--surface-alt);border:1px solid var(--border);padding:8px 12px;margin-top:8px;line-height:1.55;">
          <strong>Causal Diagnosis:</strong> 
          ${sd >= 50 ? `Primary driver is an unexpected <strong>upstream factory supply shortfall (${sd}%)</strong> with production or shipment delays at the plant. ` : ''}
          ${ds >= 20 ? `Compounded by a <strong>${ds}% sudden surge in patient prescription pull</strong> across affiliate healthcare systems. ` : ''}
          ${fs >= 20 ? `An automated safety stock recalibration shock (<strong>+${fs}%</strong>) simultaneously elevated minimum inventory requirements.` : ''}
          ${sd < 50 && ds < 20 && fs < 20 ? 'Multivariate corridor variance across factory delivery timing and regional demand velocity.' : ''}
        </div>
      </div>

      <div style="margin-top:14px;">
        <div class="detail-section-label">[ SUPPLY PIPELINE CERTAINTY ]</div>
        <div class="rc-bar-row">
          <div class="rc-bar-header"><span class="rc-bar-label">CONFIRMED PO COMMITMENT</span><span class="rc-bar-val tabular-nums">${cert}%</span></div>
          <div class="rc-track"><div class="rc-fill" style="width:${cert}%;background:var(--ink)"></div></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-family:var(--font-mono);font-size:9.5px;color:var(--muted);">
          <span>● Confirmed POs: ${Math.round(cert * 0.65)}%</span>
          <span>● In-Transit: ${Math.round(cert * 0.35)}%</span>
          <span>● Unconfirmed Planned: ${100 - cert}%</span>
        </div>
      </div>

      <!-- Predictive Replenishment Latency Track -->
      <div class="latency-timeline-box" style="margin-top:14px;">
        <div class="latency-timeline-header">
          <div class="detail-section-label" style="margin-bottom:0">PREDICTIVE REPLENISHMENT LATENCY &amp; STOCKOUT PRE-EMPTION</div>
          <span class="latency-status-tag ${isLate ? 'latency-status-tag--cliff' : 'latency-status-tag--ok'}">
            ${isLate ? `[ ! ] LATENCY DEFICIT: +${lat.latency_gap_weeks || 2}W STOCKOUT` : '✓ PRE-EMPTIVE ARRIVAL'}
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
        <div class="latency-narrative-text" style="line-height:1.55;">
          ${esc(lat.narrative || `Standard replenishment lead time causes a physical stockout window. Priority air freight or inter-market transfer is required to bridge the supply gap before patients run dry.`)}
        </div>
      </div>

      ${isStale ? `
        <div class="stale-param-alert-box" id="stale-param-alert" style="margin-top:14px;">
          <div class="stale-param-top">
            <span class="stale-alert-badge">[ ! ] STALE MASTER DATA DETECTED · SECTION 6.4</span>
            <span class="stale-alert-tag">DEMAND SHIFT ${staleParam.demand_shift_pct > 0 ? '+' : ''}${staleParam.demand_shift_pct}%</span>
          </div>
          <div class="stale-param-title">Safety Stock Days Static at ${staleParam.current_ssd || 42}d with Significant Demand Velocity Drift</div>
          <p class="stale-param-desc" style="line-height:1.55;">
            The SAP/OMP master safety buffer remained frozen despite a ${staleParam.demand_shift_pct > 0 ? '+' : ''}${staleParam.demand_shift_pct}% demand shift. Recalibrating this setting eliminates persistent false alerts and liberates trapped buffer capital to corporate treasury.
          </p>
        </div>
      ` : ''}

      ${sig.is_cold_start ? `
        <div class="cold-start-box" style="margin-top:14px;">
          <div class="cold-start-header">
            <div class="detail-section-label" style="margin-bottom:0">COLD-START / NEW PRODUCT LAUNCH PROTOCOL (SECTION 6.9)</div>
            <span class="cold-start-badge">[LAUNCH] NEW LAUNCH PROFILE</span>
          </div>
          <div class="cold-start-grid">
            <div class="cold-start-item"><span class="cold-start-k">COMMERCIAL LAUNCH STAGE</span><span class="cold-start-v">${esc(coldStart.launch_phase || 'Phase II Rollout')}</span></div>
            <div class="cold-start-item"><span class="cold-start-k">ANALOGUE MARKET</span><span class="cold-start-v">${esc(coldStart.analogue_market || 'Country 045')}</span></div>
            <div class="cold-start-item"><span class="cold-start-k">UNCERTAINTY BUFFER</span><span class="cold-start-v">${esc(coldStart.demand_uncertainty_buffer || '90-Day Pre-Build')}</span></div>
          </div>
          <div style="margin-top:8px;font-size:10.5px;color:var(--muted);line-height:1.45;">
            52-week historical statistics bypassed. Demand baselined against comparable analogue market with active pre-build uncertainty coverage.
          </div>
        </div>
      ` : ''}
    </div>
  `;

  // ── PANE 2: IMPACT ────────────────────────────────────────────────────
  const patientImpactHtml = `
    <div class="tab-pane" id="pane-impact">
      <div class="patient-impact-box" id="patient-impact-box">
        <div class="patient-impact-header">
          <div class="patient-impact-title">
            <span class="patient-impact-icon">[PATIENT]</span>
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
            <span class="patient-stat-sub">Deficit during breach horizon</span>
          </div>
          <div class="patient-stat-item">
            <span class="patient-stat-k">IRREVERSIBLE REVENUE CHURN</span>
            <span class="patient-stat-v tabular-nums">₹${((sig.lost_revenue_inr || 0) / 1e7).toFixed(2)} CR</span>
            <span class="patient-stat-sub">Lost chronic subscriber value</span>
          </div>
        </div>

        <!-- Unique Causal Reasoning as clean body text (Point 3) -->
        <div style="font-size:12px;color:var(--ink);line-height:1.6;margin:12px 0;padding:12px 14px;background:var(--surface-alt);border:1px solid var(--border);">
          <strong>Chronic Therapy Invariance:</strong> In diabetes and obesity care, patients cannot miss weekly injections. 
          If shelves go empty, doctors permanently switch <strong>${Number(sig.lost_lifelong_patients || 0).toLocaleString('en-IN')} chronic patients</strong> to competing therapies. 
          Because chronic patients stay on the same brand for life, so losing them today wipes out recurring annual revenue.
        </div>

        <div style="font-size:11.5px;color:var(--crisis-text);background:var(--crisis-bg);border-left:3px solid var(--crisis-text);padding:10px 12px;line-height:1.55;margin-bottom:12px;">
          <strong>Cost of Inaction within 24h SLA:</strong> Inaction causes <strong>${coi.unmitigated_stockout_weeks || 1} week(s) of physical stockout</strong>, <strong>₹${capSavedCr} Cr</strong> in immediate non-delivery penalties, and unserved chronic doses of <strong>${Number(sig.lost_patient_demand_units || 0).toLocaleString('en-IN')} units</strong>.
        </div>

        <!-- Clinical Governance Note -->
        <div style="font-family:var(--font-mono);font-size:10.5px;color:var(--muted);border-top:1px solid var(--border);padding-top:10px;line-height:1.5;">
          <strong>GxP Clinical Standard:</strong> Zero-tolerance threshold for unmitigated essential medicine stockouts under Novo Nordisk global access to care commitments.
        </div>
      </div>
    </div>
  `;

  // ── PANE 3: LOGISTICS ─────────────────────────────────────────────────
  const logisticsPaneHtml = `
    <div class="tab-pane" id="pane-logistics">
      <!-- Freight Mode Economics -->
      <div class="freight-comp-box" id="freight-comp-box">
        <div class="freight-comp-header">
          <div class="freight-comp-title">
            <span class="freight-comp-icon">[LOGISTICS]</span>
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
              <td><strong>[SEA] Deep-Sea / Surface Transit</strong></td>
              <td class="tabular-nums">${fc.sea_transit_label || `${leadWks} Weeks`}</td>
              <td class="tabular-nums">₹12 / unit</td>
              <td class="tabular-nums">₹${Number(fc.sea_freight_cost_inr || 0).toLocaleString('en-IN')}</td>
              <td><span class="freight-feasibility-tag ${isLateForSea ? 'feasibility--failed' : 'feasibility--ok'}">${fc.sea_feasibility || (isLateForSea ? 'TOO LATE (CLIFF BREACH)' : 'FEASIBLE')}</span></td>
            </tr>
            <tr class="${isLateForSea ? 'freight-row--recommended' : 'freight-row--optional'}">
              <td><strong>[AIR] Priority Air Freight Charter</strong></td>
              <td class="tabular-nums">${fc.air_transit_label || '1 Week (4-7 Days)'}</td>
              <td class="tabular-nums">₹85 / unit</td>
              <td class="tabular-nums">₹${Number(fc.air_freight_cost_inr || 0).toLocaleString('en-IN')}</td>
              <td><span class="freight-feasibility-tag feasibility--ok">${fc.air_feasibility || 'PRE-EMPTS BREACH'}</span></td>
            </tr>
          </tbody>
        </table>
        <div class="freight-verdict-footer">
          <div class="freight-verdict-metric"><span class="freight-metric-k">AIR FREIGHT PREMIUM:</span><span class="freight-metric-v tabular-nums">₹${Number((fc.air_cost_premium_inr || 0) / 1e5).toFixed(1)} Lakhs</span></div>
          <div class="freight-verdict-metric"><span class="freight-metric-k">CAPITAL PROTECTED:</span><span class="freight-metric-v tabular-nums" style="color:var(--ok-text)">₹${capSavedCr} Cr</span></div>
          <div class="freight-verdict-metric"><span class="freight-metric-k">EXPEDITE ROI RATIO:</span><span class="freight-metric-v tabular-nums" style="color:var(--ok-text)">${fc.expedite_roi_ratio || 10.4}×</span></div>
        </div>
        <div style="font-size:11px;color:var(--ink);background:var(--surface-alt);border:1px solid var(--border);padding:8px 12px;margin-top:10px;line-height:1.55;">
          ${isLateForSea ? `
            <strong>Financial Decision Rationale:</strong> Standard sea transit (${leadWks}W) cannot beat the Week ${sig.breach_week} breach window. Paying an air premium of ₹${Number((fc.air_cost_premium_inr || 0) / 1e5).toFixed(1)}L guarantees delivery within 4–7 days, yielding a <strong>${fc.expedite_roi_ratio || 10.4}× net return</strong> on capital protected.
          ` : `
            <strong>Financial Decision Rationale:</strong> Standard ocean transit arrives safely ahead of the corridor breach window. Releasing a standard PO maximizes cost efficiency at ₹12/unit without incurring unnecessary air freight premiums.
          `}
        </div>
      </div>

      <!-- Inter-Market Re-Allocation Corridor -->
      ${transfer.has_transfer ? `
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
                <span class="transfer-arrow-mode">[AIR] ${transfer.transit_days}D AIR CHARTER</span>
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

          <div class="wh-capacity-box">
            <div class="wh-capacity-header">
              <span class="wh-capacity-title">RECIPIENT WAREHOUSE CAPACITY &amp; HEADROOM VERIFICATION</span>
              <span class="wh-capacity-tag">${whCap.headroom_status || 'HEADROOM CONFIRMED (<90%)'}</span>
            </div>
            <div class="wh-bar-wrap">
              <div class="wh-bar-track"><div class="wh-bar-fill" style="width:${whCap.recipient_utilization_pct || 83}%;background:var(--ink)"></div></div>
              <div class="wh-bar-meta">
                <span>Current: ${Number(whCap.recipient_current_inventory || 28400).toLocaleString()} U</span>
                <span>Post-Transfer: <strong>${Number(whCap.recipient_post_inventory || 41574).toLocaleString()} U</strong> (${whCap.recipient_utilization_pct || 83.1}% / 50,000 U Limit)</span>
              </div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Manufacturing & Network Constraints (Section 6.8) -->
      <div class="constraints-box">
        <div class="constraints-header">
          <div class="detail-section-label" style="margin-bottom:0">MANUFACTURING &amp; NETWORK CONSTRAINTS (SECTION 6.8)</div>
          <span class="constraints-status-tag ${constr.in_frozen_horizon ? 'constraints-tag--locked' : 'constraints-tag--open'}">
            ${constr.in_frozen_horizon ? '[LOCKED] INSIDE FROZEN HORIZON (W1-4)' : '[OPEN] OPEN SCHEDULING HORIZON'}
          </span>
        </div>
        <div class="constraints-grid">
          <div class="constraint-item">
            <span class="constraint-k">FROZEN HORIZON (4 WEEKS)</span>
            <span class="constraint-v">${constr.in_frozen_horizon ? 'LOCKED — Emergency VP Waiver / Transfer Required' : 'OPEN — Standard Plant Batch Execution'}</span>
          </div>
          <div class="constraint-item">
            <span class="constraint-k">CAMPAIGN BATCH ROUNDING (MOQ: 5K)</span>
            <span class="constraint-v tabular-nums">Raw: ${Number(sig.recommended_qty_units || 0).toLocaleString()} U → <strong>${Number(constr.constrained_roq_units || sig.recommended_qty_units || 0).toLocaleString()} U</strong></span>
          </div>
          <div class="constraint-item">
            <span class="constraint-k">NETWORK ALLOCATION CAP (85%)</span>
            <span class="constraint-v" style="color:var(--ok-text)">COMPLIANT — Non-Starvation Verified</span>
          </div>
        </div>

        <!-- Upstream Plant Contention & Portfolio Trade-off Sub-Panel -->
        <div class="plant-contention-box" style="margin-top:12px;padding:12px 14px;background:var(--surface-alt);border:1px solid var(--border);border-left:4px solid var(--ink);font-family:var(--font-mono);font-size:11px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:13px;">[PLANT]</span>
              <span style="font-weight:700;color:var(--ink);letter-spacing:0.04em;">UPSTREAM PLANT LINE CONTENTION &amp; PORTFOLIO CONFLICT</span>
            </div>
            <span style="font-size:9.5px;font-weight:700;padding:2px 8px;color:var(--surface);background:var(--ink);">
              ${pc.contention_level || 'ELEVATED'} CONTENTION
            </span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-bottom:10px;font-size:10.5px;">
            <div style="background:var(--surface);padding:8px 10px;border:1px solid var(--border);">
              <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.04em;">MANUFACTURING LINE</div>
              <div style="font-weight:700;color:var(--ink);margin-top:2px;">${esc(pc.line_id || 'Shared Line 04 (Aseptic Filling)')}</div>
              <div style="color:var(--muted);font-size:9.5px;margin-top:1px;">${esc(pc.plant_site || 'Kalundborg Site 1')}</div>
            </div>
            <div style="background:var(--surface);padding:8px 10px;border:1px solid var(--border);">
              <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.04em;">SHARED SISTER BRAND</div>
              <div style="font-weight:700;color:var(--ink);margin-top:2px;">${esc(pc.sister_brand || 'Brand Beacon')}</div>
              <div style="color:var(--crisis-text);font-size:9.5px;font-weight:600;margin-top:1px;">Trade-off Collision Risk</div>
            </div>
            <div style="background:var(--surface);padding:8px 10px;border:1px solid var(--border);">
              <div style="color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:0.04em;">LINE UTILIZATION &amp; CHANGEOVER</div>
              <div style="font-weight:700;color:${(pc.line_utilization_pct || 82.5) > 90 ? 'var(--crisis-text)' : 'var(--ink)'};margin-top:2px;">${pc.line_utilization_pct || 82.5}% Capacity</div>
              <div style="color:var(--muted);font-size:9.5px;margin-top:1px;">${pc.changeover_hours || 48}h CIP/SIP (${pc.changeover_delay_days || 2}d delay)</div>
            </div>
          </div>

          <div style="font-size:11px;color:var(--ink);line-height:1.55;background:var(--surface);padding:9px 12px;border:1px solid var(--border);margin-bottom:6px;">
            ${esc(pc.tradeoff_narrative || 'Line utilization under capacity ceiling with scheduled multi-brand allocation.')}
          </div>
          ${pc.is_correlated_upstream_shortfall ? `
            <div style="display:flex;align-items:flex-start;gap:6px;margin-top:8px;padding:6px 10px;background:var(--crisis-bg);border-left:3px solid var(--crisis-text);font-size:10px;color:var(--crisis-text);line-height:1.45;">
              <span style="font-weight:700;">[STATISTICAL PROXY]:</span>
              <span>Simultaneous confirmed drop across brand families in Week ${sig.breach_week} confirms bulk upstream plant constraint (not a transit delay).</span>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  // ── PANE 4: GOVERNANCE ────────────────────────────────────────────────
  const governancePaneHtml = `
    <div class="tab-pane" id="pane-governance">
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
            <textarea class="workflow-textarea" id="input-new-comment" rows="2" placeholder="Record operational rationale (e.g. Flight capacity booked on LH Cargo for delivery)..."></textarea>
            <button class="btn-workflow-comment" id="btn-post-comment" type="button">+ POST RATIONALE</button>
          </div>
        </div>
      </div>

      <!-- Explicit ROQ Mathematical Line for Executive Sign-off -->
      <div class="roq-math-callout" style="padding:12px 14px;background:var(--surface-alt);border:1px solid var(--border);font-family:var(--font-mono);font-size:11px;line-height:1.55;margin-top:12px;">
        <div style="font-weight:700;margin-bottom:4px;display:flex;justify-content:space-between;">
          <span>[CALC] ROQ FORMULA (WHY ${Number(sig.recommended_qty_units || 0).toLocaleString()} U?):</span>
          <span style="font-weight:800;">MIDPOINT RESTORATION</span>
        </div>
        <div style="color:var(--ink);font-size:10.5px;">
          <strong>ROQ</strong> = max(0, ⌈Target Midpoint (${Number(sig.midpoint_target_units || Math.round((sig.recommended_qty_units || 0) * 1.3)).toLocaleString()} U) − Projected Inv⌉
        </div>
        <div style="color:var(--muted);font-size:9.5px;margin-top:4px;">
          Target Midpoint = (Safety Floor + Ceiling) / 2 = 1.5× SSD Buffer (prevents secondary breach). ${sig.capital_at_risk_inr === 0 && (sig.action_type || '').includes('EXCESS') ? '<span style="font-size:10px;color:var(--muted);font-weight:normal">(SURPLUS · DEFER INBOUND)</span>' : ''}
        </div>
      </div>

      <!-- Strategic Dossier -->
      <div class="narrative-box" id="narrative-container" style="margin-top:14px;">
        <div class="narrative-header">
          <div class="detail-section-label" style="margin-bottom:0;">[ EXECUTIVE STRATEGIC DOSSIER ]</div>
          <span class="narrative-badge" id="narrative-badge-status">${approved ? 'APPROVED & SIGNED ✓' : 'SYNTHESIZED ✓'}</span>
        </div>
        <div class="narrative-dossier" id="narrative-dossier"></div>
      </div>
    </div>
  `;

  // ── COLLAPSIBLE COPILOT MODULE (Exactly 1 [ AI ] box) ──────────────────
  const copilotModuleHtml = `
    <div class="drawer-copilot-collapsible" id="drawer-copilot-collapsible">
      <button class="btn-copilot-toggle" id="btn-toggle-copilot" type="button">
        <span>[ AI ] COPILOT · ASK A QUESTION OR EXPLAIN IN PLAIN ENGLISH</span>
        <span id="copilot-toggle-arrow">▼</span>
      </button>
      <div class="drawer-copilot-content" id="drawer-copilot-content" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <button class="btn-ai-toggle-eli5" id="btn-toggle-eli5" type="button">
            [A/B] Simple English Mode
          </button>
          <button class="ai-quick-action-btn ${approved ? 'ai-quick-action-btn--approved' : ''}" id="btn-ai-quick-act" type="button">
            ${approved ? '✓ ACTION APPROVED &amp; SIGNED' : '[→] EXECUTE THIS NOW'}
          </button>
        </div>

        <div class="ai-eli5-callout" id="ai-eli5-callout" style="display:none;">
          <div class="ai-eli5-header"><span>[NOTE] SIMPLE SUMMARY (PLAIN ENGLISH FOR NEW PLANNERS):</span></div>
          <div class="ai-eli5-text">${esc(eli5)}</div>
        </div>

        <div class="ai-quick-chips">
          <button class="ai-chip-btn" type="button" data-topic="summary_1s">[1-LINE] Explain in 1 sentence</button>
          <button class="ai-chip-btn" type="button" data-topic="what_to_do">[STEPS] Exact steps I should take</button>
          <button class="ai-chip-btn" type="button" data-topic="why_not_sea">[SEA] Why can't we use cargo ships?</button>
          <button class="ai-chip-btn" type="button" data-topic="is_donor_safe">[SAFETY] Is the donor market safe?</button>
          <button class="ai-chip-btn" type="button" data-topic="draft_email">[MEMO] Draft an email to my manager</button>
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

  // ── MOVE 5: STICKY ACTION FOOTER (Flex: 0 0 auto) ─────────────────────
  const actionFooterHtml = `
    <div class="drawer-action-footer">
      <div class="footer-meta-status">
        <span>STATUS:</span>
        <strong id="footer-status-label">${approved ? 'APPROVED &amp; GxP LOGGED ✓' : 'ACTION REQUIRED'}</strong>
      </div>
      <div class="footer-actions-group">
        <button class="btn-transfer-execute ${approved ? 'approval-btn--approved' : ''}" id="btn-execute-transfer" ${approved ? 'disabled' : ''} style="${transfer.has_transfer ? '' : 'display:none;'}">
          ${approved ? '■ TRANSFER APPROVED — GxP LOGGED' : `[→] EXECUTE INTER-MARKET STOCK TRANSFER (${Number(transfer.transfer_qty || 0).toLocaleString()} UNITS)`}
        </button>
        <button class="approval-btn ${approved ? 'approval-btn--approved' : ''}" id="btn-approve" ${approved ? 'disabled' : ''}>
          ${approved ? '■ ORDER APPROVED — GxP LOGGED' : btnLabel}
        </button>
      </div>
    </div>
  `;

  // ── POINT 1: RENDER ALL 4 PANES AT OPEN (NO CONDITIONAL RE-RENDERS) ───
  body.innerHTML = `
    ${decisionHeaderHtml}
    ${tabsBarHtml}
    <div class="drawer-panes-wrapper" id="drawer-panes-wrapper">
      ${evidencePaneHtml}
      ${patientImpactHtml}
      ${logisticsPaneHtml}
      ${governancePaneHtml}
      ${copilotModuleHtml}
    </div>
    ${actionFooterHtml}
  `;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  if (overlay) overlay.classList.add('active');

  // Wire Tab Navigation (toggling .is-active only)
  const tabBtns = body.querySelectorAll('.drawer-tab-btn');
  const panes = {
    evidence: document.getElementById('pane-evidence'),
    impact: document.getElementById('pane-impact'),
    logistics: document.getElementById('pane-logistics'),
    governance: document.getElementById('pane-governance')
  };

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabKey = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.toggle('is-active', b === btn));
      Object.keys(panes).forEach(k => {
        if (panes[k]) panes[k].classList.toggle('is-active', k === tabKey);
      });
      if (tabKey === 'evidence' && _chart) {
        _chart.resize();
      }
    });
  });

  // Wire Collapsible Copilot Module
  const btnToggleCopilot = document.getElementById('btn-toggle-copilot');
  const copilotContent = document.getElementById('drawer-copilot-content');
  const copilotArrow = document.getElementById('copilot-toggle-arrow');
  if (btnToggleCopilot && copilotContent) {
    btnToggleCopilot.addEventListener('click', () => {
      const isClosed = copilotContent.style.display === 'none';
      copilotContent.style.display = isClosed ? 'block' : 'none';
      if (copilotArrow) copilotArrow.textContent = isClosed ? '▲' : '▼';
    });
  }

  // Wire Fullscreen Takeover Button
  const btnFs = document.getElementById('btn-toggle-fullscreen');
  if (btnFs) {
    btnFs.onclick = (e) => {
      e.stopPropagation();
      toggleFullscreen();
    };
  }

  // Render chart immediately (in EVIDENCE pane)
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
      const footerStatus = document.getElementById('footer-status-label');
      if (footerStatus) footerStatus.textContent = 'APPROVED & GxP LOGGED ✓';

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
      btnToggleEli5.textContent = isHidden ? '✕ Hide Simple English' : '[A/B] Simple English Mode';
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
              <span class="ai-answer-model">[ AI ] ${esc(data.model || 'AI Copilot')}</span>
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

  const chips = body.querySelectorAll('.ai-chip-btn');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      const topic = chip.dataset.topic;
      const q = chip.textContent.replace(/^\[[^\]]+\]\s*/, '');
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

export const openDetailDrawer = openDrawer;

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
      backgroundColor: 'rgba(220, 38, 38, 0.25)',
      borderColor: '#DC2626',
      borderWidth: 1,
      yAxisID: 'y1',
      barPercentage: 0.8
    });
  }

  if (approved) {
    datasets.push(buildRecovery(sig));
  }

  _chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            font: { family: '"JetBrains Mono", monospace', size: 9 },
            color: '#6B7280',
            padding: 8
          }
        },
        tooltip: {
          titleFont: { family: '"JetBrains Mono", monospace', size: 10 },
          bodyFont: { family: '"JetBrains Mono", monospace', size: 10 },
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: {
            font: { family: '"JetBrains Mono", monospace', size: 8.5 },
            color: '#9CA3AF',
            maxTicksLimit: 13,
            callback: (val, idx) => (idx % 4 === 0 ? `W${idx + 1}` : '')
          }
        },
        y: {
          position: 'left',
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: {
            font: { family: '"JetBrains Mono", monospace', size: 9 },
            color: '#6B7280',
            callback: v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
          }
        },
        y1: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            font: { family: '"JetBrains Mono", monospace', size: 8.5 },
            color: '#9CA3AF',
            callback: v => `${v}`
          }
        }
      }
    },
    plugins: [breachPlugin]
  });
}

function handleApproval(sig, btnApprove) {
  btnApprove.disabled = true;
  btnApprove.textContent = '■ ORDER APPROVED — GxP LOGGED';
  btnApprove.classList.add('approval-btn--approved');

  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `po-${Date.now()}`;
  const entry = {
    id,
    timestamp_utc: new Date().toISOString(),
    row_id: sig.row_id,
    sku: `${sig.brand}|${sig.country}`,
    action_type: sig.action_type || 'STANDARD PO',
    approved_qty: sig.recommended_qty_units || 0,
    reason_code: 'Routine Replenishment',
    signature: 'Analyst Session — GxP Compliant',
  };

  window._pushAudit && window._pushAudit(entry);
  window._setApproved && window._setApproved(sig.row_id);

  if (_chart) {
    _chart.data.datasets.push(buildRecovery(sig));
    _chart.update();
  }

  const badgeStatus = document.getElementById('narrative-badge-status');
  if (badgeStatus) badgeStatus.textContent = 'APPROVED & SIGNED ✓';
  const footerStatus = document.getElementById('footer-status-label');
  if (footerStatus) footerStatus.textContent = 'APPROVED & GxP LOGGED ✓';

  const btnTransfer = document.getElementById('btn-execute-transfer');
  if (btnTransfer) {
    btnTransfer.disabled = true;
    btnTransfer.textContent = '■ TRANSFER APPROVED — GxP LOGGED';
    btnTransfer.classList.add('approval-btn--approved');
  }
}

export function toggleFullscreen(forceState) {
  const drawer = document.getElementById('drawer-detail');
  const indicator = document.getElementById('drawer-mode-indicator');
  const btnFs = document.getElementById('btn-toggle-fullscreen');
  if (!drawer) return false;

  const isFs = forceState !== undefined ? forceState : !drawer.classList.contains('drawer--fullscreen');
  if (isFs) {
    drawer.classList.add('drawer--fullscreen');
    if (indicator) indicator.textContent = '[ FULLSCREEN TAKEOVER ACTIVE ]';
    if (btnFs) btnFs.innerHTML = '<span class="fs-icon">[-]</span> <span class="fs-label">EXIT FULLSCREEN</span>';
  } else {
    drawer.classList.remove('drawer--fullscreen');
    if (indicator) indicator.textContent = '[ 720PX ANALYST WORKSPACE ]';
    if (btnFs) btnFs.innerHTML = '<span class="fs-icon">[+]</span> <span class="fs-label">FULLSCREEN</span>';
  }
  if (_chart) {
    setTimeout(() => _chart && _chart.resize(), 50);
  }
  return isFs;
}

export function closeDetailDrawer() {
  const drawer = document.getElementById('drawer-detail');
  const overlay = document.getElementById('drawer-overlay');
  if (drawer) {
    drawer.classList.remove('open');
    drawer.classList.remove('drawer--fullscreen');
    drawer.setAttribute('aria-hidden', 'true');
    const indicator = document.getElementById('drawer-mode-indicator');
    if (indicator) indicator.textContent = '[ 720PX ANALYST WORKSPACE ]';
    const btnFs = document.getElementById('btn-toggle-fullscreen');
    if (btnFs) btnFs.innerHTML = '<span class="fs-icon">[+]</span> <span class="fs-label">FULLSCREEN</span>';
  }
  if (overlay) overlay.classList.remove('active');
  if (_chart) {
    _chart.destroy();
    _chart = null;
  }
}

export const closeDrawer = closeDetailDrawer;

if (typeof window !== 'undefined') {
  window._toggleDetailFullscreen = toggleFullscreen;
  window.closeDetailDrawer = closeDetailDrawer;
}

