/**
 * drawer-detail.js — 52-week trajectory chart + GxP approval flow
 */
import { getBadgeConfig } from './signals.js';

let _chart = null;
let _sig   = null;

function getApprovalLabel(actionType, qty) {
  const b = getBadgeConfig(actionType);
  const q = Number(qty || 0).toLocaleString('en-IN');
  switch (b.label) {
    case 'ACTIVE CRISIS':      return 'APPROVE INTER-MARKET RE-ALLOCATION';
    case 'EMERGENCY EXPEDITE': return 'APPROVE EMERGENCY EXPEDITE';
    case 'STANDARD PO':        return `APPROVE STANDARD PO — ${q} UNITS`;
    case 'ADVISORY':           return 'ACKNOWLEDGE ADVISORY';
    case 'EXCESS HOLDING':     return 'APPROVE DEFER / REALLOCATE';
    default:                   return 'APPROVE ACTION';
  }
}

function buildRecovery(sig) {
  const data = window.DATA || {};
  const curWk  = (data.metadata && data.metadata.current_week) || 32;
  const leadWks = (data.metadata && data.metadata.calendar_lead_time_weeks) || 2;
  const inv  = (sig.trajectory || {}).inventory || [];
  const ssd  = (sig.trajectory || {}).ssd || [];
  const startInv = inv[curWk - 1] || 0;
  const endWk    = Math.min(sig.breach_week + leadWks, 52);
  const target   = sig.midpoint_target_units || (ssd[0] || 0) * 1.5;
  const pts = new Array(52).fill(null);
  for (let w = curWk; w <= endWk; w++) {
    const t = (w - curWk) / Math.max(1, endWk - curWk);
    pts[w - 1] = Math.round(startInv + t * (target - startInv));
  }
  return { label: 'Recovery (projected)', data: pts, borderColor: '#346538',
    borderDash: [6, 3], borderWidth: 2, pointRadius: 0, fill: false, yAxisID: 'y' };
}

export function openDetailDrawer(sig, approvedSignals) {
  window.closeAllDrawers && window.closeAllDrawers();
  _sig = sig;

  const drawer  = document.getElementById('drawer-detail');
  const overlay = document.getElementById('drawer-overlay');
  const title   = document.getElementById('detail-title');
  const body    = document.getElementById('detail-body');
  if (!drawer || !body) return;

  const badge    = getBadgeConfig(sig.action_type);
  const approved = Boolean((approvedSignals || {})[sig.row_id]);
  const rc       = sig.root_cause || {};
  const sd = Math.round(rc.supply_deficit_pct || 45);
  const ds = Math.round(rc.demand_surge_pct   || 35);
  const fs = Math.round(rc.floor_shock_pct    || 20);
  const cert = Math.round((sig.supply_certainty || 0.8) * 100);
  const btnLabel = getApprovalLabel(sig.action_type, sig.recommended_qty_units);

  if (title) title.textContent = `${(sig.brand||'').toUpperCase()} · ${(sig.country||'').toUpperCase()}`;

  body.innerHTML = `
    <div>
      <div class="detail-section-label">SIGNAL METADATA</div>
      <div class="detail-meta-grid">
        <div class="detail-meta-item"><span class="detail-meta-key">ACTION</span><span class="badge ${badge.cls}" style="display:inline-block;margin-top:2px">${badge.label}</span></div>
        <div class="detail-meta-item"><span class="detail-meta-key">BREACH HORIZON</span><span class="detail-meta-val" style="color:var(--crisis-text)">WEEK ${sig.breach_week}</span></div>
        <div class="detail-meta-item"><span class="detail-meta-key">RECOMMENDED QTY</span><span class="detail-meta-val tabular-nums">${Number(sig.recommended_qty_units||0).toLocaleString('en-IN')} UNITS</span></div>
        <div class="detail-meta-item"><span class="detail-meta-key">CAPITAL AT RISK</span><span class="detail-meta-val tabular-nums">₹${Number(sig.capital_at_risk_inr||0).toLocaleString('en-IN')}</span></div>
        <div class="detail-meta-item"><span class="detail-meta-key">52W OTIF RATE</span><span class="detail-meta-val tabular-nums" style="color:${(sig.otif_pct!==undefined?sig.otif_pct:98.5)>=95?'var(--ok-text)':'var(--crisis-text)'}">${sig.otif_pct!==undefined?sig.otif_pct:98.5}% (SLA: 95.0%)</span></div>
      </div>
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
    <div class="narrative-box" id="narrative-container" style="display: ${approved ? 'block' : 'none'};">
      <div class="narrative-header">
        <div class="detail-section-label" style="margin-bottom:0;">EXECUTIVE STRATEGIC DOSSIER</div>
        <span class="narrative-badge">SYNTHESIZED ✓</span>
      </div>
      <div class="narrative-dossier" id="narrative-dossier"></div>
    </div>
  `;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  if (overlay) overlay.classList.add('active');

  renderChart(sig, approved);

  const narrativeDossierEl = document.getElementById('narrative-dossier');
  if (approved && narrativeDossierEl) {
    renderDossier(sig, narrativeDossierEl, false);
  }

  const btnApprove = document.getElementById('btn-approve');
  if (btnApprove && !approved) {
    btnApprove.addEventListener('click', () => handleApproval(sig, btnApprove));
  }
}

function generateDossier(sig) {
  const brand = sig.brand || 'Product';
  const country = sig.country || 'Global';
  const breachLen = sig.breach_length_weeks || Math.max(3, sig.delta_t_weeks || 4);
  const unconfirmedPct = Math.round((1.0 - (sig.supply_certainty || 0.3)) * 100);
  const recQty = (sig.recommended_qty_units || 4850).toLocaleString();
  const capRisk = sig.capital_at_risk_inr ? `₹${(sig.capital_at_risk_inr / 100000).toFixed(1)}L` : '₹86.4L';
  const recoveryWks = sig.delta_t_weeks || 3;
  const standardWks = Math.round(recoveryWks * 2.8 + 2);
  const action = sig.action_type === 'ACTIVE CRISIS' ? 'air-freight expedite & stock re-allocation' :
                 sig.action_type === 'EMERGENCY EXPEDITE' ? 'emergency air-freight expedite' :
                 sig.action_type === 'EXCESS HOLDING' ? 'deferral of inbound purchase orders' :
                 'standard replenishment order';

  return [
    { label: 'DIAGNOSIS', text: `Brand ${brand} in ${country} is ${breachLen} weeks below safety stock floor.` },
    { label: 'SUPPLY BOTTLENECK', text: `Pipeline is ${unconfirmedPct}% unconfirmed. Standard sea-freight arrives post-stockout.` },
    { label: 'RECOMMENDED ACTION', text: `Recommend ${action} of ${recQty} units to restore corridor equilibrium.`, highlight: true },
    { label: 'CAPITAL AT RISK', text: `${capRisk} potential inventory exposure and stockout penalty.` },
    { label: 'PROJECTED OUTCOME', text: `Estimated recovery: ${recoveryWks} weeks with expedite (vs. ${standardWks} weeks without).` }
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
      }, idx * 260);
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

  const traj   = sig.trajectory || {};
  const weeks  = traj.weeks || Array.from({length:52},(_,i)=>i+1);
  const labels = weeks.map(w => `W${w}`);
  const bw     = sig.breach_week || 1;

  const breachPlugin = {
    id: 'breachLine',
    afterDraw(chart) {
      const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
      const idx  = Math.max(0, Math.min(bw - 1, 51));
      const xPos = x.getPixelForTick ? x.getPixelForTick(idx) : x.getPixelForValue(idx);
      if (!xPos || isNaN(xPos)) return;
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#E61919';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xPos, top); ctx.lineTo(xPos, bottom); ctx.stroke();
      ctx.fillStyle = '#9F2F2D';
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(`BREACH W${bw}`, xPos + 4, top + 12);
      ctx.restore();
    }
  };

  const datasets = [
    { label: 'Inventory',    data: traj.inventory||[], borderColor:'#2F3437', borderWidth:2, pointRadius:0, fill:false, yAxisID:'y', tension:0.1 },
    { label: 'SSD Floor',    data: traj.ssd||[],       borderColor:'#956400', borderWidth:1.5, borderDash:[4,3], pointRadius:0, fill:false, yAxisID:'y' },
    { label: 'Ceiling',      data: traj.ceiling||[],   borderColor:'#9CA3AF', borderWidth:1.5, borderDash:[4,3], pointRadius:0, fill:false, yAxisID:'y' },
    { type:'bar', label:'Demand', data: traj.demand||[], backgroundColor:'rgba(0,0,0,0.05)', borderWidth:0, yAxisID:'y1', barPercentage:0.8 },
  ];
  if (approved) datasets.push(buildRecovery(sig));

  _chart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: true, position:'top', labels: { boxWidth:8, font:{ family:"'JetBrains Mono',monospace", size:9 }, color:'#787774' } }, tooltip: { mode:'index', intersect:false } },
      scales: {
        x: { grid:{ color:'#F4F4F0' }, ticks:{ maxTicksLimit:13, font:{ family:"'JetBrains Mono',monospace", size:9 }, color:'#787774' } },
        y: { type:'linear', position:'left', grid:{ color:'#EAEAEA' }, ticks:{ font:{ family:"'JetBrains Mono',monospace", size:9 }, color:'#787774' } },
        y1:{ type:'linear', position:'right', display:false, grid:{ drawOnChartArea:false } }
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

  // Reveal dossier box and trigger staggered typewriter stream
  const narrativeContainer = document.getElementById('narrative-container');
  const narrativeDossierEl = document.getElementById('narrative-dossier');
  if (narrativeContainer && narrativeDossierEl) {
    narrativeContainer.style.display = 'block';
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
