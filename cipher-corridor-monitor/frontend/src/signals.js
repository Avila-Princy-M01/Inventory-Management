/**
 * signals.js — Badge normalisation + Signal Card Renderer
 * Swiss Industrial Print: oversized rank numerals, razor-thin PRS bar, 5-key badge contract
 */

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
    grid.innerHTML = '<div style="grid-column:1/-1;padding:48px;text-align:center;font-family:var(--font-mono);color:var(--muted)">[ NO ACTIVE SIGNALS FOUND ]</div>';
    return;
  }

  grid.innerHTML = signals.map((sig, i) => {
    const badge = getBadgeConfig(sig.action_type);
    const isCrisis = badge.label === 'ACTIVE CRISIS';
    const approved = Boolean(approvedSignals[sig.row_id]);
    const prs = Number(sig.prs_score || 0);
    const showWarn = sig.supply_certainty !== undefined && sig.supply_certainty !== null && sig.supply_certainty < 0.5;
    const rank = String(i + 1).padStart(2, '0');

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
      ? `<span class="card-mkt-cliff-tag" title="${esc(sig.freight_callout || 'Late for Sea Freight')}">⚠️ LATE FOR SEA (${ltVal}W)</span>`
      : `<span class="card-mkt-lt-tag">LT: ${ltVal}W</span>`;

    const cliffHtml = isLateForSea
      ? `<div class="card-cliff-alert">
           <span class="cliff-alert-badge">🚨 AIR FREIGHT ONLY</span>
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

    return `<div class="signal-card ${isCrisis ? 'signal-card--crisis' : ''}" style="--i:${i}; --index:${i};" data-rid="${sig.row_id}">
      <div class="card-row1">
        <span class="card-rank tabular-nums">#${rank}</span>
        <div style="display:flex;align-items:center;gap:6px">
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
        <span>REC QTY <strong>${fmtNum(sig.recommended_qty_units)}</strong></span>
      </div>
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
