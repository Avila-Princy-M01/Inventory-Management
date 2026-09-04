/**
 * scenario-engine.js — CHI matrix O(1) lookup + PRS recomputation algorithm
 */
let _matrix = null;

export function setCHIMatrix(m) {
  if (Array.isArray(m) && m.length === 12 && Array.isArray(m[0]) && m[0].length === 20) _matrix = m;
}

function generateFallback(base) {
  const m = [];
  for (let lt = 1; lt <= 12; lt++) {
    const row = [];
    const adj = 26 - lt;
    const uf  = Math.max(0, Math.min(1, 1 - adj / 52));
    for (let i = 0; i < 20; i++) {
      const cm = +(1.1 + i * 0.1).toFixed(1);
      const cf = Math.max(0, Math.min(1, 1 / cm));
      row.push(+Math.max(0, Math.min(100, base * (0.6*uf + 0.4*cf) / 0.5)).toFixed(1));
    }
    m.push(row);
  }
  return m;
}

export function lookupCHI(lt, cm) {
  const base = (window.DATA && window.DATA.corridor_health && window.DATA.corridor_health.global_chi) || 85.3;
  const mat  = _matrix || generateFallback(base);
  const ri   = Math.max(0, Math.min(11, Math.round(lt) - 1));
  const ci   = Math.max(0, Math.min(19, Math.round((cm - 1.1) / 0.1)));
  return Number(mat[ri][ci]);
}

export function recomputeSignalScores(signals, lt, cm) {
  if (!Array.isArray(signals)) return [];
  const ltDiff = lt - 3;
  return signals.map(sig => {
    const adjDelta = Math.max(1, (sig.delta_t_weeks || 0) - ltDiff);
    const urgency  = Math.max(0, Math.min(1, 1 - adjDelta / 52));
    const severity = Math.max(0, Math.min(1, sig.severity || 0.5));
    const prs = +Math.max(0, Math.min(100, (0.6*urgency + 0.4*severity) * 100)).toFixed(1);

    // Recompute recommended qty with new breach horizon
    let qty = sig.recommended_qty_units || 0;
    const traj = sig.trajectory;
    if (traj && traj.inventory && traj.ssd) {
      const idx = Math.max(0, Math.min(51, adjDelta - 1));
      const inv = traj.inventory[idx] || 0;
      const ssd = traj.ssd[idx] || 0;
      const mid = ssd * (1 + cm) / 2;
      qty = Math.max(0, Math.round(mid - inv));
    }

    return { ...sig, prs_score: prs, delta_t_weeks: adjDelta, breach_week: adjDelta + 1, recommended_qty_units: qty };
  }).sort((a, b) => b.prs_score - a.prs_score);
}
