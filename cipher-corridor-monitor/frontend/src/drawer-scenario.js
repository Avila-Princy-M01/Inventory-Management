/**
 * drawer-scenario.js — Scenario Modeller: CHI matrix O(1) lookup + PRS recomputation
 * Direct embedding of the 12x20 matrix and clamp function per requirements.
 */
import { renderSignalCards } from './signals.js';

// Chi Matrix 12x20 lookup array: [R1], [R2], [R3], [R4], [R5], [R6], [R7], [R8], [R9], [R10], [R11], [R12]
export const CHI_LOOKUP_MATRIX = [
  [100.0, 100.0, 100.0, 100.0, 98.6, 95.8, 93.3, 91.1, 89.1, 87.3, 85.6, 84.2, 82.8, 81.6, 80.4, 79.4, 78.4, 77.5, 76.7, 75.9],
  [100.0, 100.0, 100.0, 100.0, 100.0, 97.8, 95.3, 93.0, 91.0, 89.2, 87.6, 86.1, 84.8, 83.6, 82.4, 81.4, 80.4, 79.5, 78.6, 77.9],
  [100.0, 100.0, 100.0, 100.0, 100.0, 99.7, 97.2, 95.0, 93.0, 91.2, 89.6, 88.1, 86.8, 85.5, 84.4, 83.3, 82.4, 81.5, 80.6, 79.8],
  [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 99.2, 97.0, 95.0, 93.2, 91.5, 90.1, 88.7, 87.5, 86.3, 85.3, 84.3, 83.4, 82.6, 81.8],
  [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 98.9, 96.9, 95.1, 93.5, 92.0, 90.7, 89.5, 88.3, 87.3, 86.3, 85.4, 84.6, 83.8],
  [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 98.9, 97.1, 95.5, 94.0, 92.7, 91.4, 90.3, 89.2, 88.3, 87.4, 86.5, 85.7],
  [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 99.1, 97.5, 96.0, 94.6, 93.4, 92.3, 91.2, 90.2, 89.3, 88.5, 87.7],
  [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 99.4, 97.9, 96.6, 95.4, 94.2, 93.2, 92.2, 91.3, 90.5, 89.7],
  [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 99.9, 98.6, 97.3, 96.2, 95.1, 94.2, 93.3, 92.4, 91.6],
  [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 99.3, 98.2, 97.1, 96.1, 95.2, 94.4, 93.6],
  [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 99.1, 98.1, 97.2, 96.4, 95.6],
  [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 99.2, 98.3, 97.5]
];

export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

export function lookupCHI(leadTimeWeeks, ceilMult) {
  const rowIdx = clamp(Math.round(leadTimeWeeks) - 1, 0, 11);
  const colIdx = clamp(Math.round((ceilMult - 1.1) / 0.1), 0, 19);
  return CHI_LOOKUP_MATRIX[rowIdx][colIdx];
}

export function recomputeSignalScores(signals, leadTimeWeeks, ceilMult) {
  if (!Array.isArray(signals)) return [];
  const ltDiff = leadTimeWeeks - 3;
  return signals.map(sig => {
    const adjDelta = Math.max(1, (sig.delta_t_weeks || 0) - ltDiff);
    const urgency  = clamp(1 - adjDelta / 52, 0, 1);
    const severity = clamp(sig.severity || 0.5, 0, 1);
    const prs      = +clamp((0.6 * urgency + 0.4 * severity) * 100, 0, 100).toFixed(1);

    let qty = sig.recommended_qty_units || 0;
    const traj = sig.trajectory;
    if (traj && traj.inventory && traj.ssd) {
      const idx = clamp(adjDelta - 1, 0, 51);
      const inv = traj.inventory[idx] || 0;
      const ssd = traj.ssd[idx] || 0;
      const mid = ssd * (1 + ceilMult) / 2;
      qty = Math.max(0, Math.round(mid - inv));
    }

    return {
      ...sig,
      prs_score: prs,
      delta_t_weeks: adjDelta,
      breach_week: adjDelta + 1,
      recommended_qty_units: qty
    };
  }).sort((a, b) => b.prs_score - a.prs_score);
}

let _understockGate = 5;
let _overstockGate  = 4;

export function openScenarioDrawer(data) {
  window.closeAllDrawers && window.closeAllDrawers();

  const drawer  = document.getElementById('drawer-scenario');
  const overlay = document.getElementById('drawer-overlay');
  const body    = document.getElementById('scenario-body');
  if (!drawer || !body) return;

  const baseCHI = (data && data.corridor_health && data.corridor_health.global_chi) || 85.3;

  body.innerHTML = `
    <div class="scenario-chi-card">
      <div class="detail-section-label">SIMULATED CORRIDOR HEALTH INDEX</div>
      <output class="scenario-chi-val tabular-nums" id="scenario-chi">${baseCHI.toFixed(1)}</output>
      <div style="font-size:9px;color:var(--muted);letter-spacing:0.06em">INSTANT MATRIX LOOKUP · NO RECALCULATION</div>
    </div>

    <div class="slider-group">
      <div class="slider-row">
        <span class="slider-label-text">LEAD TIME PARAMETER</span>
        <span class="slider-val-text tabular-nums" id="val-lt">03 WEEKS</span>
      </div>
      <input type="range" class="custom-slider" id="sl-lt" min="1" max="12" step="1" value="3">
      <div class="slider-hints">
        <span class="slider-hint">1 WK (SHORT)</span>
        <span class="slider-hint">DEFAULT: 3W</span>
        <span class="slider-hint">12 WK (LONG)</span>
      </div>
    </div>

    <div class="slider-group">
      <div class="slider-row">
        <span class="slider-label-text">CEILING MULTIPLIER (BUFFER)</span>
        <span class="slider-val-text tabular-nums" id="val-cm">2.0×</span>
      </div>
      <input type="range" class="custom-slider" id="sl-cm" min="1.1" max="3.0" step="0.1" value="2.0">
      <div class="slider-hints">
        <span class="slider-hint">1.1× (TIGHT)</span>
        <span class="slider-hint">DEFAULT: 2.0×</span>
        <span class="slider-hint">3.0× (WIDE)</span>
      </div>
    </div>

    <div>
      <div class="detail-section-label">ALERT PERSISTENCE GATES (CONFIGURABLE)</div>
      <div class="gates-grid">
        <div class="gate-tile">
          <div class="gate-tile-label">UNDERSTOCK GATE</div>
          <div class="gate-row">
            <input type="number" class="gate-input tabular-nums" id="gate-under" min="1" max="52" value="${_understockGate}">
            <span class="gate-unit">WKS</span>
          </div>
        </div>
        <div class="gate-tile">
          <div class="gate-tile-label">OVERSTOCK GATE</div>
          <div class="gate-row">
            <input type="number" class="gate-input tabular-nums" id="gate-over" min="1" max="52" value="${_overstockGate}">
            <span class="gate-unit">WKS</span>
          </div>
        </div>
      </div>
      <div style="font-size:9px;color:var(--muted);letter-spacing:0.04em;margin-top:6px">DEFAULTS: UNDERSTOCK 5W · OVERSTOCK 4W (MENTOR VALIDATED)</div>
    </div>

    <button class="btn-primary" id="btn-reset-scenario" style="width:100%;margin-top:8px">RESET TO DEFAULTS</button>
  `;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  if (overlay) overlay.classList.add('active');

  // Wire sliders
  const slLt = document.getElementById('sl-lt');
  const slCm = document.getElementById('sl-cm');
  const valLt = document.getElementById('val-lt');
  const valCm = document.getElementById('val-cm');
  const chiEl  = document.getElementById('scenario-chi');

  function recalc() {
    const lt = Number(slLt.value);
    const cm = Number(slCm.value);
    if (valLt) valLt.textContent = String(lt).padStart(2,'0') + ' WEEKS';
    if (valCm) valCm.textContent = cm.toFixed(1) + '×';
    const chi = lookupCHI(lt, cm);
    if (chiEl) {
      chiEl.textContent = chi.toFixed(1);
      chiEl.style.color = chi >= 90 ? '#346538' : chi >= 80 ? '#956400' : '#9F2F2D';
    }
    window._updateKPICHI && window._updateKPICHI(chi);
    const appData = window.DATA;
    if (appData && appData.top_signals) {
      const recomp  = recomputeSignalScores(appData.top_signals, lt, cm);
      const approved = window._approvedSignals || {};
      renderSignalCards(recomp, approved);
    }
  }

  if (slLt) slLt.addEventListener('input', recalc);
  if (slCm) slCm.addEventListener('input', recalc);

  const guGate = document.getElementById('gate-under');
  const goGate = document.getElementById('gate-over');
  if (guGate) guGate.addEventListener('change', () => { _understockGate = Math.max(1, Math.min(52, parseInt(guGate.value)||5)); guGate.value = _understockGate; });
  if (goGate) goGate.addEventListener('change', () => { _overstockGate  = Math.max(1, Math.min(52, parseInt(goGate.value)||4)); goGate.value = _overstockGate; });

  const btnReset = document.getElementById('btn-reset-scenario');
  if (btnReset) btnReset.addEventListener('click', () => {
    if (slLt) slLt.value = 3;
    if (slCm) slCm.value = 2.0;
    _understockGate = 5; _overstockGate = 4;
    if (guGate) guGate.value = 5;
    if (goGate) goGate.value = 4;
    recalc();
  });

  recalc();
}

export function closeScenarioDrawer() {
  const drawer = document.getElementById('drawer-scenario');
  if (drawer) { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
}
