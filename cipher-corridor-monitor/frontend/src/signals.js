/**
 * signals.js — Badge normalisation + Signal Card Renderer
 * Swiss Industrial Print: oversized rank numerals, razor-thin PRS bar, 5-key badge contract
 */

export const BADGE_MAP = [
  { prefix: 'ACTIVE CRISIS',      cls: 'badge--crisis',   label: 'ACTIVE CRISIS',      borderColor: '#E61919' },
  { prefix: 'EMERGENCY EXPEDITE', cls: 'badge--expedite',  label: 'EMERGENCY EXPEDITE', borderColor: '#F59E0B' },
  { prefix: 'STANDARD PO',        cls: 'badge--po',        label: 'STANDARD PO',        borderColor: '#2563EB' },
  { prefix: 'ADVISORY',           cls: 'badge--advisory',  label: 'ADVISORY',           borderColor: '#9CA3AF' },
  { prefix: 'EXCESS HOLDING',     cls: 'badge--excess',    label: 'EXCESS HOLDING',     borderColor: '#7C3AED' },
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
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

export function renderSignalCards(signals, approvedSignals = {}) {
  const grid = document.getElementById('signal-grid');
  if (!grid) return;

  if (!signals || signals.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:48px;text-align:center;font-family:var(--font-mono);color:var(--muted)">[ NO ACTIVE SIGNALS FOUND ]</div>';
    return;
  }

  grid.innerHTML = signals.map((sig, i) => {
    const badge   = getBadgeConfig(sig.action_type);
    const isCrisis = badge.label === 'ACTIVE CRISIS';
    const approved = Boolean(approvedSignals[sig.row_id]);
    const prs      = Number(sig.prs_score || 0);
    const showWarn = sig.supply_certainty !== undefined && sig.supply_certainty !== null && sig.supply_certainty < 0.5;
    const rank     = String(i + 1).padStart(2, '0');

    const actionArea = approved
      ? `<div class="card-approved">■ APPROVED — GxP LOGGED</div>`
      : `<div class="card-actions">
           <button class="btn-po"     data-rid="${sig.row_id}">PO: ${fmtNum(sig.recommended_qty_units)} U</button>
           <button class="btn-detail" data-rid="${sig.row_id}">VIEW DETAILS →</button>
         </div>`;

    const warnHtml = showWarn
      ? `<div class="supply-warn">[ LOW SUPPLY CERTAINTY — UNCONFIRMED ORDERS &gt;50% ]</div>`
      : '';

    return `<div class="signal-card ${isCrisis ? 'signal-card--crisis' : ''}" style="--i:${i}; --index:${i};" data-rid="${sig.row_id}">
      <div class="card-row1">
        <span class="card-rank tabular-nums">#${rank}</span>
        <span class="badge ${badge.cls}">${badge.label}</span>
      </div>
      <div class="card-identity">
        <div class="card-brand">${esc(sig.brand)} · ${esc(sig.country)}</div>
        <div class="card-country">${esc(sig.region)} · ${esc((sig.product_group||'').split('|')[1] || sig.mrp || '')}</div>
      </div>
      <div class="prs-row">
        <div class="prs-track"><div class="prs-fill" style="width:${prs}%;background:${badge.borderColor}"></div></div>
        <span class="prs-val tabular-nums">${prs.toFixed(1)}</span>
      </div>
      <div class="card-meta tabular-nums">
        <span>BREACH <strong>WK ${sig.breach_week}</strong></span>
        <span>REC QTY <strong>${fmtNum(sig.recommended_qty_units)}</strong></span>
      </div>
      ${warnHtml}
      ${actionArea}
    </div>`;
  }).join('');

  // Wire click handlers
  signals.forEach(sig => {
    const card = grid.querySelector(`[data-rid="${sig.row_id}"]`);
    if (!card) return;
    const btnD = card.querySelector('.btn-detail');
    if (btnD) btnD.addEventListener('click', e => { e.stopPropagation(); window._openDetailDrawer && window._openDetailDrawer(sig); });
    const btnP = card.querySelector('.btn-po');
    if (btnP) btnP.addEventListener('click', e => { e.stopPropagation(); window._openDetailDrawer && window._openDetailDrawer(sig); });
  });

  const badge_el = document.getElementById('signal-count-badge');
  if (badge_el) badge_el.textContent = `${signals.length} ACTIVE SIGNALS`;
}
