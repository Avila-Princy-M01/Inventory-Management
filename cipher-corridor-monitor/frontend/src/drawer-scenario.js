/**
 * drawer-scenario.js — Scenario Modeller: CHI matrix O(1) lookup + PRS recomputation
 * Direct embedding of the 12x20 matrix and clamp function per requirements.
 */
import { renderSignalCards } from './signals.js';

// Chi Matrix 12x20 lookup array: [R1], [R2], [R3], [R4], [R5], [R6], [R7], [R8], [R9], [R10], [R11], [R12]
// Dynamic source of truth: DATA.chi_lookup_matrix.values (or matrix). Verified fallback below:
export const CHI_LOOKUP_MATRIX = [
  [71.8, 75.6, 78.6, 80.9, 82.6, 84.0, 85.1, 85.9, 86.6, 87.2, 87.7, 88.3, 88.7, 89.2, 89.6, 90.0, 90.4, 90.7, 91.1, 91.3],
  [71.6, 75.4, 78.4, 80.7, 82.4, 83.8, 84.8, 85.7, 86.4, 87.0, 87.5, 88.0, 88.5, 89.0, 89.4, 89.8, 90.2, 90.5, 90.8, 91.1],
  [71.4, 75.2, 78.1, 80.4, 82.2, 83.6, 84.6, 85.5, 86.2, 86.8, 87.3, 87.8, 88.3, 88.8, 89.2, 89.6, 90.0, 90.3, 90.6, 90.9],
  [71.1, 75.0, 77.9, 80.2, 82.0, 83.4, 84.4, 85.3, 86.0, 86.6, 87.1, 87.6, 88.1, 88.6, 89.0, 89.4, 89.8, 90.1, 90.4, 90.7],
  [70.9, 74.7, 77.7, 80.0, 81.8, 83.1, 84.2, 85.0, 85.7, 86.3, 86.9, 87.4, 87.9, 88.3, 88.8, 89.2, 89.5, 89.9, 90.2, 90.5],
  [70.7, 74.5, 77.5, 79.8, 81.6, 82.9, 84.0, 84.8, 85.5, 86.1, 86.7, 87.2, 87.7, 88.1, 88.6, 89.0, 89.3, 89.7, 90.0, 90.3],
  [70.5, 74.3, 77.3, 79.6, 81.4, 82.7, 83.8, 84.6, 85.3, 85.9, 86.5, 87.0, 87.5, 87.9, 88.4, 88.8, 89.1, 89.5, 89.8, 90.1],
  [70.3, 74.1, 77.1, 79.4, 81.1, 82.5, 83.6, 84.4, 85.1, 85.7, 86.3, 86.8, 87.3, 87.7, 88.1, 88.5, 88.9, 89.3, 89.6, 89.8],
  [70.1, 73.9, 76.9, 79.2, 80.9, 82.3, 83.4, 84.2, 84.9, 85.5, 86.0, 86.6, 87.0, 87.5, 87.9, 88.3, 88.7, 89.0, 89.4, 89.6],
  [69.9, 73.7, 76.7, 79.0, 80.7, 82.1, 83.1, 84.0, 84.7, 85.3, 85.8, 86.3, 86.8, 87.3, 87.7, 88.1, 88.5, 88.8, 89.1, 89.4],
  [69.7, 73.5, 76.4, 78.7, 80.5, 81.9, 82.9, 83.8, 84.5, 85.1, 85.6, 86.1, 86.6, 87.1, 87.5, 87.9, 88.3, 88.6, 88.9, 89.2],
  [69.4, 73.3, 76.2, 78.5, 80.3, 81.7, 82.7, 83.6, 84.3, 84.9, 85.4, 85.9, 86.4, 86.9, 87.3, 87.7, 88.1, 88.4, 88.7, 89.0]
];

export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

export function lookupCHI(leadTimeWeeks, ceilMult, dynamicMatrix = null) {
  const rowIdx = clamp(Math.round(leadTimeWeeks) - 1, 0, 11);
  const colIdx = clamp(Math.round((ceilMult - 1.1) / 0.1), 0, 19);
  const matrix = dynamicMatrix ||
    (typeof window !== 'undefined' && window.DATA && window.DATA.chi_lookup_matrix &&
     (window.DATA.chi_lookup_matrix.values || window.DATA.chi_lookup_matrix.matrix)) ||
    CHI_LOOKUP_MATRIX;
  return matrix[rowIdx][colIdx];
}

/**
 * Piecewise exponential urgency with lead-time cliff per plan specification:
 *   - dt <= 0: urgency = 1.60
 *   - 0 < dt < L: urgency = min(1.60, 1.00 + (0.60 / L) * (L - dt))
 *   - dt == L: urgency = 1.00
 *   - dt > L: urgency = exp(-(dt - L) / 4.0)
 */
export function computeUrgency(dt, leadTimeWeeks = 3) {
  const L = Math.max(1, Number(leadTimeWeeks) || 3);
  if (dt <= 0) {
    return 1.60;
  } else if (dt < L) {
    return Math.min(1.60, 1.00 + (0.60 / L) * (L - dt));
  } else if (dt === L) {
    return 1.00;
  } else {
    return Math.exp(-(dt - L) / 4.0);
  }
}

export function recomputeSignalScores(signals, leadTimeWeeks, ceilMult) {
  if (!Array.isArray(signals)) return [];
  const lt = Math.max(1, Number(leadTimeWeeks) || 3);
  const ltDiff = lt - 3;
  return signals.map(sig => {
    const origDt = sig.delta_t_weeks !== undefined ? sig.delta_t_weeks : (sig.breach_week ? Math.max(0, sig.breach_week - 1) : 0);
    const adjDelta = Math.max(0, origDt - ltDiff);
    const rawUrgency = computeUrgency(adjDelta, lt);
    // PRS bounded in [0, 100], normalizing max urgency 1.60 to 1.00 for 60% weight
    const normUrgency = clamp(rawUrgency / 1.60, 0, 1);
    const severity = clamp(sig.severity || 0.5, 0, 1);
    const prs      = +clamp((0.6 * normUrgency + 0.4 * severity) * 100, 0, 100).toFixed(1);

    let qty = sig.recommended_qty_units || 0;
    const traj = sig.trajectory;
    if (traj && traj.inventory && traj.ssd) {
      const idx = clamp(adjDelta > 0 ? adjDelta - 1 : 0, 0, 51);
      const inv = traj.inventory[idx] || 0;
      const ssd = traj.ssd[idx] || 0;
      const dem = (traj.demand && traj.demand[idx]) || 0;
      const sup = (traj.supply && traj.supply[idx]) || 0;
      const mid = ssd * (1 + ceilMult) / 2;
      qty = Math.max(0, Math.round(mid - inv - sup + dem));
    }

    return {
      ...sig,
      prs_score: prs,
      urgency: +rawUrgency.toFixed(4),
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
    const dynMatrix = (data && data.chi_lookup_matrix && (data.chi_lookup_matrix.values || data.chi_lookup_matrix.matrix)) || null;
    const chi = lookupCHI(lt, cm, dynMatrix);
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
