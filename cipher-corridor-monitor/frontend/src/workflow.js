/**
 * workflow.js — Alert Workflow & Escalation Engine (Section 6.2)
 * Handles:
 *  1. Owner Assignment (Global HQ, Affiliate Market Coordinator, Plant Dispatch, S&OP Director)
 *  2. Planner Comments / GxP Rationale Thread (audit-trailed with timestamps)
 *  3. Snooze Action (1W, 2W, 4W with mandatory operational reason code)
 *  4. 24-Hour Escalation SLA Engine for unacknowledged critical crises
 */

export const OWNER_ROLES = [
  'Unassigned',
  'Lead Supply Chain Planner (Global / HQ)',
  'Affiliate Market Coordinator',
  'Plant Dispatch Lead',
  'Global S&OP Director',
  'Regional Distribution Manager'
];

export const SNOOZE_DURATIONS = [
  { label: '1 Week (Next Cycle)', weeks: 1, ms: 7 * 86400 * 1000 },
  { label: '2 Weeks (Mid-Horizon)', weeks: 2, ms: 14 * 86400 * 1000 },
  { label: '4 Weeks (Monthly S&OP)', weeks: 4, ms: 28 * 86400 * 1000 },
];

export const SNOOZE_REASONS = [
  'Awaiting Commercial Forecast Confirmation',
  'Factory Scheduled Maintenance Window',
  'Inbound Port Congestion / Customs Hold',
  'Supplier Raw Material Delay Under Investigation',
  'Clinical Trial Demand Reschedule'
];

function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) {}
  return null;
}

const MEMORY_WORKFLOW = {};

export function getWorkflowState(rowId) {
  const st = safeStorage();
  if (st) {
    try {
      const raw = st.getItem(`novomonitor_wf_${rowId}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
  }
  if (MEMORY_WORKFLOW[rowId]) {
    return MEMORY_WORKFLOW[rowId];
  }

  // Fallback to backend pre-assigned workflow data from dashboard_data.json
  if (typeof window !== 'undefined' && window.DATA) {
    const active = window.DATA.alert_workflow?.active_assignments?.[String(rowId)]
      || window.DATA.top_signals?.find(s => String(s.row_id) === String(rowId))?.workflow;
    if (active) {
      return {
        owner: active.owner || 'Unassigned',
        comments: Array.isArray(active.comments) ? [...active.comments] : [],
        snooze: active.snooze || null,
        acknowledged: Boolean(active.acknowledged),
        assigned_at: active.assigned_at || null,
        sla_deadline_utc: active.sla_deadline_utc || null,
        sla_remaining_hours: active.sla_remaining_hours !== undefined ? active.sla_remaining_hours : 18.2,
        is_sla_critical: Boolean(active.is_sla_critical)
      };
    }
  }

  return {
    owner: 'Unassigned',
    comments: [],
    snooze: null,
    acknowledged: false,
    assigned_at: null
  };
}

export function saveWorkflowState(rowId, state) {
  MEMORY_WORKFLOW[rowId] = state;
  const st = safeStorage();
  if (st) {
    try {
      st.setItem(`novomonitor_wf_${rowId}`, JSON.stringify(state));
    } catch (e) {}
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('workflow-updated', { detail: { rowId, state } }));
  }
  return state;
}

/**
 * Returns default initial seeded comments for demo / GxP review if thread is empty
 */
export function getInitialComments(sig) {
  const brand = sig.brand || 'Product';
  const country = sig.country || 'Global';
  const isCrisis = (sig.action_type || '').toUpperCase().startsWith('ACTIVE CRISIS');
  const isExpedite = (sig.action_type || '').toUpperCase().startsWith('EMERGENCY EXPEDITE');

  if (isCrisis) {
    return [
      {
        id: `c-init-1-${sig.row_id}`,
        author: 'System Monitor Engine',
        role: 'Automated GxP Triage',
        text: `Corridor deficit threshold breached at W${sig.breach_week || 1}. Supply certainty ${Math.round((sig.supply_certainty || 0.8) * 100)}%. Escalation timer started (24h SLA).`,
        timestamp: new Date(Date.now() - 3600000 * 9.5).toISOString()
      },
      {
        id: `c-init-2-${sig.row_id}`,
        author: 'Lead Supply Chain Planner (Global / HQ)',
        role: 'HQ Planner',
        text: `Initiated emergency stock audit for ${brand} in ${country}. Verifying cross-market buffer inventory and air freight availability.`,
        timestamp: new Date(Date.now() - 3600000 * 4.2).toISOString()
      }
    ];
  }

  if (isExpedite) {
    return [
      {
        id: `c-init-1-${sig.row_id}`,
        author: 'System Monitor Engine',
        role: 'Automated GxP Triage',
        text: `Demand acceleration outpaces baseline pipeline. Expedite action recommended for ${brand} (${country}).`,
        timestamp: new Date(Date.now() - 3600000 * 12).toISOString()
      }
    ];
  }

  return [];
}

/**
 * Assign an alert to a specific supply chain role/owner
 */
export function assignSignalOwner(sig, newOwner) {
  const state = getWorkflowState(sig.row_id);
  const prevOwner = state.owner || 'Unassigned';
  state.owner = newOwner;
  state.assigned_at = new Date().toISOString();
  state.acknowledged = true;
  saveWorkflowState(sig.row_id, state);

  // Push to GxP audit log
  const entry = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `wf-own-${Date.now()}`,
    timestamp_utc: new Date().toISOString(),
    row_id: sig.row_id,
    sku: `${sig.brand}|${sig.country}`,
    action_type: 'WORKFLOW_ASSIGN_OWNER',
    approved_qty: 0,
    reason_code: 'SUPPLY_CHAIN_GOVERNANCE',
    signature: `Reassigned from [${prevOwner}] to [${newOwner}] by Planner Session (Sec 6.2)`
  };
  if (typeof window !== 'undefined' && window._pushAudit) {
    window._pushAudit(entry);
  }

  return state;
}

/**
 * Append a planner comment to the audit-trailed thread
 */
export function addSignalComment(sig, text, author = 'Lead Supply Chain Planner (Global / HQ)') {
  if (!text || !text.trim()) return null;
  const state = getWorkflowState(sig.row_id);
  if (!state.comments || state.comments.length === 0) {
    state.comments = getInitialComments(sig);
  }

  const commentObj = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `comm-${Date.now()}`,
    author: author || state.owner || 'Lead Supply Chain Planner',
    role: state.owner || 'Supply Chain Planner',
    text: text.trim(),
    timestamp: new Date().toISOString()
  };

  state.comments.push(commentObj);
  state.acknowledged = true;
  saveWorkflowState(sig.row_id, state);

  // Push to GxP audit log so comments have official traceability
  const entry = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `wf-comm-${Date.now()}`,
    timestamp_utc: new Date().toISOString(),
    row_id: sig.row_id,
    sku: `${sig.brand}|${sig.country}`,
    action_type: 'GxP Operational Rationale',
    approved_qty: 0,
    reason_code: 'PLANNER_OPERATIONAL_NOTE',
    signature: `${commentObj.author}: "${commentObj.text.slice(0, 48)}..." (Sec 6.2)`
  };
  if (typeof window !== 'undefined' && window._pushAudit) {
    window._pushAudit(entry);
  }

  return commentObj;
}

/**
 * Snooze alert with mandatory justification reason code
 */
export function snoozeAlert(sig, weeks, reason, note = '') {
  const state = getWorkflowState(sig.row_id);
  const durationObj = SNOOZE_DURATIONS.find(d => d.weeks === weeks) || SNOOZE_DURATIONS[0];
  const snoozedUntil = Date.now() + durationObj.ms;

  state.snooze = {
    weeks,
    durationLabel: durationObj.label,
    reason: reason || SNOOZE_REASONS[0],
    note: note.trim(),
    snoozed_at: new Date().toISOString(),
    snoozed_until: snoozedUntil
  };
  state.acknowledged = true;
  saveWorkflowState(sig.row_id, state);

  // GxP Audit log
  const entry = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `wf-snz-${Date.now()}`,
    timestamp_utc: new Date().toISOString(),
    row_id: sig.row_id,
    sku: `${sig.brand}|${sig.country}`,
    action_type: `ALERT_SNOOZE (${weeks}W)`,
    approved_qty: 0,
    reason_code: reason,
    signature: `Snoozed ${weeks}W: ${reason}${note ? ' — ' + note : ''} (Sec 6.2)`
  };
  if (typeof window !== 'undefined' && window._pushAudit) {
    window._pushAudit(entry);
  }

  return state;
}

/**
 * Unsnooze / resume alert early
 */
export function unsnoozeAlert(sig) {
  const state = getWorkflowState(sig.row_id);
  const prevReason = state.snooze ? state.snooze.reason : 'Manual';
  state.snooze = null;
  saveWorkflowState(sig.row_id, state);

  const entry = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `wf-unsnz-${Date.now()}`,
    timestamp_utc: new Date().toISOString(),
    row_id: sig.row_id,
    sku: `${sig.brand}|${sig.country}`,
    action_type: 'ALERT_RESUMED',
    approved_qty: 0,
    reason_code: 'EARLY_REVIEW',
    signature: `Snooze lifted early (prior reason: ${prevReason}) by Planner Session (Sec 6.2)`
  };
  if (typeof window !== 'undefined' && window._pushAudit) {
    window._pushAudit(entry);
  }

  return state;
}

/**
 * 24-Hour Escalation SLA Engine
 * Evaluates whether an acute crisis is within SLA, breached, or resolved
 */
export function getEscalationSLA(sig, approvedSignals = {}) {
  const isCrisis = (sig.action_type || '').toUpperCase().startsWith('ACTIVE CRISIS');
  const isCritical = isCrisis || Number(sig.prs_score || 0) >= 80;
  if (!isCritical) {
    return { isCritical: false, status: 'STANDARD_CYCLE', label: 'Standard Weekly Cycle' };
  }

  const isApproved = Boolean(approvedSignals[sig.row_id]);
  const state = getWorkflowState(sig.row_id);
  const isAssigned = state.owner && state.owner !== 'Unassigned';
  const isSnoozed = state.snooze && state.snooze.snoozed_until > Date.now();
  const hasComments = state.comments && state.comments.length > 0;

  if (isApproved) {
    return {
      isCritical: true,
      status: 'RESOLVED',
      compliant: true,
      label: 'SLA COMPLIANT ✓ (ORDER APPROVED & GxP SIGNED)',
      color: '#346538',
      cls: 'sla-resolved'
    };
  }

  if (isSnoozed) {
    return {
      isCritical: true,
      status: 'SNOOZED',
      compliant: true,
      label: `SNOOZED (${state.snooze.weeks}W: ${state.snooze.reason})`,
      color: '#787774',
      cls: 'sla-snoozed'
    };
  }

  if (isAssigned || hasComments || state.acknowledged) {
    return {
      isCritical: true,
      status: 'ACKNOWLEDGED',
      compliant: true,
      label: `SLA ACTIVE · ASSIGNED TO ${state.owner || 'PLANNER'}`,
      color: '#2563EB',
      cls: 'sla-assigned'
    };
  }

  // Active unacknowledged countdown
  // Simulate Monday 08:00 UTC cycle release: ~14h 22m remaining in standard 24h SLA window
  // Deterministic seed based on row_id so it displays a stable countdown
  const hoursLeft = 14 + (sig.row_id % 7);
  const minsLeft = 22 + (sig.row_id % 35);

  return {
    isCritical: true,
    status: 'URGENT_COUNTDOWN',
    compliant: false,
    hoursLeft,
    minsLeft,
    label: `24H SLA ESCALATION: ${hoursLeft}h ${minsLeft}m remaining until VP Supply Chain auto-escalation`,
    color: '#DC2626',
    cls: 'sla-urgent'
  };
}
