/**
 * drawer-scenario.js — Scenario Modeller: CHI matrix O(1) lookup + PRS recomputation
 * Direct embedding of the 12x20 matrix and clamp function per requirements.
 * Enhanced with Per-Market Lead Time Configuration & Feasibility Engine.
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

// ── Per-Market Supply Corridor Defaults ──────────────────────────────────────────
export const DEFAULT_MARKET_LEAD_TIMES = {
  'Country 013': { code: 'Country 013', name: 'China', lead_time: 36, mode: 'Sea Freight', air_lead_time: 2, desc: 'Pacific Sea Freight Corridor (Standard)' },
  'China':       { code: 'Country 013', name: 'China', lead_time: 36, mode: 'Sea Freight', air_lead_time: 2, desc: 'Pacific Sea Freight Corridor (Standard)' },
  'Country 017': { code: 'Country 017', name: 'Brazil', lead_time: 8, mode: 'Sea Freight', air_lead_time: 2, desc: 'Atlantic Ocean + Santos Port Customs' },
  'Brazil':      { code: 'Country 017', name: 'Brazil', lead_time: 8, mode: 'Sea Freight', air_lead_time: 2, desc: 'Atlantic Ocean + Santos Port Customs' },
  'Country 053': { code: 'Country 053', name: 'Japan', lead_time: 4, mode: 'Maritime / Air', air_lead_time: 1, desc: 'Tokyo Regional Transit Hub' },
  'Japan':       { code: 'Country 053', name: 'Japan', lead_time: 4, mode: 'Maritime / Air', air_lead_time: 1, desc: 'Tokyo Regional Transit Hub' },
  'Country 020': { code: 'Country 020', name: 'United States', lead_time: 6, mode: 'Sea / Intermodal', air_lead_time: 2, desc: 'East Coast Ports + Rail Intermodal' },
  'United States': { code: 'Country 020', name: 'United States', lead_time: 6, mode: 'Sea / Intermodal', air_lead_time: 2, desc: 'East Coast Ports + Rail Intermodal' },
  'Country 025': { code: 'Country 025', name: 'India', lead_time: 5, mode: 'Regional Maritime', air_lead_time: 1, desc: 'Nhava Sheva Sea Gate + Inland Depot' },
  'India':       { code: 'Country 025', name: 'India', lead_time: 5, mode: 'Regional Maritime', air_lead_time: 1, desc: 'Nhava Sheva Sea Gate + Inland Depot' },
  'Country 031': { code: 'Country 031', name: 'Germany', lead_time: 3, mode: 'Road / Rail', air_lead_time: 1, desc: 'Central European Cross-Border Trucking' },
  'Germany':     { code: 'Country 031', name: 'Germany', lead_time: 3, mode: 'Road / Rail', air_lead_time: 1, desc: 'Central European Cross-Border Trucking' },
  'Country 032': { code: 'Country 032', name: 'United Kingdom', lead_time: 3, mode: 'Maritime / Road', air_lead_time: 1, desc: 'Channel Ferry + UK Regional Depot' },
  'United Kingdom': { code: 'Country 032', name: 'United Kingdom', lead_time: 3, mode: 'Maritime / Road', air_lead_time: 1, desc: 'Channel Ferry + UK Regional Depot' },
  'Country 038': { code: 'Country 038', name: 'France', lead_time: 3, mode: 'Road / Rail', air_lead_time: 1, desc: 'Western Europe Road Freight Network' },
  'France':      { code: 'Country 038', name: 'France', lead_time: 3, mode: 'Road / Rail', air_lead_time: 1, desc: 'Western Europe Road Freight Network' },
  'Country 045': { code: 'Country 045', name: 'Australia', lead_time: 7, mode: 'Sea Freight', air_lead_time: 2, desc: 'Southern Ocean Freight + Quarantine' },
  'Australia':   { code: 'Country 045', name: 'Australia', lead_time: 7, mode: 'Sea Freight', air_lead_time: 2, desc: 'Southern Ocean Freight + Quarantine' },
  'Country 049': { code: 'Country 049', name: 'Canada', lead_time: 4, mode: 'Sea / Intermodal', air_lead_time: 2, desc: 'St. Lawrence Seaway / Rail' },
  'Canada':      { code: 'Country 049', name: 'Canada', lead_time: 4, mode: 'Sea / Intermodal', air_lead_time: 2, desc: 'St. Lawrence Seaway / Rail' }
};

let _perMarketActive = false;
let _marketOverrides = {};

function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) {}
  return null;
}

export function isPerMarketActive() {
  const st = safeStorage();
  if (st) {
    const saved = st.getItem('novomonitor_per_market_active');
    if (saved !== null) _perMarketActive = saved === '1';
  }
  return _perMarketActive;
}

export function setPerMarketActive(active) {
  _perMarketActive = Boolean(active);
  const st = safeStorage();
  if (st) {
    st.setItem('novomonitor_per_market_active', _perMarketActive ? '1' : '0');
  }
  if (typeof window !== 'undefined') {
    window._perMarketActive = _perMarketActive;
    window.dispatchEvent(new CustomEvent('market-lt-mode-changed', { detail: { active: _perMarketActive } }));
  }
}

export function getMarketConfig(country) {
  const key = String(country || '').trim();
  if (_marketOverrides[key]) return _marketOverrides[key];
  if (DEFAULT_MARKET_LEAD_TIMES[key]) return DEFAULT_MARKET_LEAD_TIMES[key];
  for (const k of Object.keys(DEFAULT_MARKET_LEAD_TIMES)) {
    if (k.toLowerCase() === key.toLowerCase() || (DEFAULT_MARKET_LEAD_TIMES[k].name && DEFAULT_MARKET_LEAD_TIMES[k].name.toLowerCase() === key.toLowerCase())) {
      return DEFAULT_MARKET_LEAD_TIMES[k];
    }
  }
  return { code: key, name: key, lead_time: 3, mode: 'Standard Corridor', air_lead_time: 1, desc: 'Standard Supply Lead Time' };
}

export function getMarketLeadTime(country, fallbackLt = 3) {
  if (!country) return fallbackLt;
  const cfg = getMarketConfig(country);
  return cfg && cfg.lead_time !== undefined ? cfg.lead_time : fallbackLt;
}

export function setMarketLeadTime(country, weeks, mode = null) {
  const key = String(country || '').trim();
  const existing = getMarketConfig(key);
  const updated = {
    ...existing,
    lead_time: Math.max(1, Math.min(52, Number(weeks) || 3)),
    mode: mode || existing.mode || 'Sea Freight'
  };
  _marketOverrides[key] = updated;
  if (existing.code) _marketOverrides[existing.code] = updated;
  if (existing.name) _marketOverrides[existing.name] = updated;
  const st = safeStorage();
  if (st) {
    st.setItem('novomonitor_market_overrides', JSON.stringify(_marketOverrides));
  }
}

export function resetMarketLeadTimes() {
  _marketOverrides = {};
  const st = safeStorage();
  if (st) {
    st.removeItem('novomonitor_market_overrides');
  }
}

// Initialize from storage if available
const _stInit = safeStorage();
if (_stInit) {
  try {
    const raw = _stInit.getItem('novomonitor_market_overrides');
    if (raw) _marketOverrides = JSON.parse(raw);
    const savedActive = _stInit.getItem('novomonitor_per_market_active');
    if (savedActive !== null) _perMarketActive = savedActive === '1';
  } catch (e) {
    // Ignore storage parse errors
  }
}

/**
 * Recomputes PRS scores, urgency, arrival target, and recommended quantity for signals.
 * Enhanced to support per-market lead times and freight cliff alerting.
 */
export function recomputeSignalScores(signals, leadTimeWeeks, ceilMult, marketOverrides = null, forcePerMarket = null) {
  if (!Array.isArray(signals)) return [];
  const globalLt = Math.max(1, Number(leadTimeWeeks) || 3);
  const usePerMarket = forcePerMarket !== null ? Boolean(forcePerMarket) : _perMarketActive;

  return signals.map(sig => {
    const origDt = sig.delta_t_weeks !== undefined ? sig.delta_t_weeks : (sig.breach_week ? Math.max(0, sig.breach_week - 1) : 0);
    const mktCfg = getMarketConfig(sig.country);
    const mktLt = usePerMarket ? (mktCfg.lead_time || globalLt) : globalLt;
    const ltDiff = mktLt - 3;
    const adjDelta = Math.max(0, origDt - ltDiff);
    const rawUrgency = computeUrgency(adjDelta, mktLt);
    // PRS bounded in [0, 100], normalizing max urgency 1.60 to 1.00 for 60% weight
    const normUrgency = clamp(rawUrgency / 1.60, 0, 1);
    const severity = clamp(sig.severity || 0.5, 0, 1);
    const prs      = +clamp((0.6 * normUrgency + 0.4 * severity) * 100, 0, 100).toFixed(1);

    const breachWk = sig.breach_week || (origDt + 1);
    const countryName = mktCfg.name || sig.country || 'China';

    // Feasibility & Cliff check per Ravi's specification:
    // When breach week occurs before replenishment lead time, standard sea freight cannot arrive in time!
    // Example: China breach at week 14 — with 36-week lead time, this is ALREADY TOO LATE for sea freight.
    const isLateForSea = usePerMarket && (mktLt >= 6) && (breachWk < mktLt);
    let freightCallout = '';
    if (isLateForSea) {
      freightCallout = `${countryName} breach at week ${breachWk} — with ${mktLt}-week lead time, this is ALREADY TOO LATE for sea freight. Only air freight can save this.`;
    }

    let qty = sig.recommended_qty_units || 0;
    const traj = sig.trajectory;
    if (traj && traj.inventory && traj.ssd) {
      const targetWk = Math.min(52, breachWk + mktLt);
      const horizonIdx = clamp(targetWk - 1, 0, 51);
      const inv = traj.inventory[horizonIdx] || 0;
      const ssd = traj.ssd[horizonIdx] || 0;
      const dem = (traj.demand && traj.demand[horizonIdx]) || 0;
      const sup = (traj.supply && traj.supply[horizonIdx]) || 0;
      const mid = ssd * (1 + ceilMult) / 2;
      qty = Math.max(0, Math.round(mid - inv - sup + dem));
    }

    return {
      ...sig,
      prs_score: prs,
      urgency: +rawUrgency.toFixed(4),
      delta_t_weeks: adjDelta,
      breach_week: breachWk,
      arrival_target_week: Math.min(52, breachWk + mktLt),
      market_lead_time: mktLt,
      market_name: countryName,
      market_mode: mktCfg.mode || 'Sea Freight',
      is_late_for_sea: isLateForSea,
      freight_callout: freightCallout,
      recommended_qty_units: qty
    };
  }).sort((a, b) => b.prs_score - a.prs_score);
}

let _understockGate = 5;
let _overstockGate  = 4;

export function openScenarioDrawer(data, options = {}) {
  window.closeAllDrawers && window.closeAllDrawers();

  const drawer  = document.getElementById('drawer-scenario');
  const overlay = document.getElementById('drawer-overlay');
  const body    = document.getElementById('scenario-body');
  if (!drawer || !body) return;

  const baseCHI = (data && data.corridor_health && data.corridor_health.global_chi) || 85.3;
  const defaultTab = (options && options.defaultTab) || (_perMarketActive ? 'market' : 'global');

  body.innerHTML = `
    <div class="scenario-chi-card">
      <div class="detail-section-label">SIMULATED CORRIDOR HEALTH INDEX</div>
      <output class="scenario-chi-val tabular-nums" id="scenario-chi">${baseCHI.toFixed(1)}</output>
      <div style="font-size:9px;color:var(--muted);letter-spacing:0.06em">INSTANT MATRIX LOOKUP · REAL-TIME RECALCULATION</div>
    </div>

    <!-- Administrative Configuration Tabs -->
    <div class="scenario-tab-bar">
      <button class="scenario-tab-btn ${defaultTab === 'global' ? 'active' : ''}" id="tab-btn-global">GLOBAL PARAMETERS</button>
      <button class="scenario-tab-btn ${defaultTab === 'market' ? 'active' : ''}" id="tab-btn-market">⚙ PER-MARKET CONFIG</button>
    </div>

    <!-- PANEL 1: Global Scenario Modeller -->
    <div id="panel-scenario-global" style="display:${defaultTab === 'global' ? 'block' : 'none'}">
      <div class="slider-group">
        <div class="slider-row">
          <span class="slider-label-text">GLOBAL LEAD TIME PARAMETER</span>
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

      <button class="btn-primary" id="btn-reset-scenario" style="width:100%;margin-top:14px">RESET TO DEFAULTS</button>
    </div>

    <!-- PANEL 2: Administrative Per-Market Configuration -->
    <div id="panel-scenario-market" style="display:${defaultTab === 'market' ? 'block' : 'none'}">
      <div class="market-admin-header-card">
        <div class="market-admin-toggle-row">
          <div>
            <div class="market-admin-title">PER-MARKET DYNAMIC OVERRIDE</div>
            <div class="market-admin-desc">Override lead times per country corridor (Sea vs Air feasibility)</div>
          </div>
          <label class="switch-industrial">
            <input type="checkbox" id="toggle-per-market" ${_perMarketActive ? 'checked' : ''}>
            <span class="switch-slider"></span>
          </label>
        </div>
        <div class="market-active-indicator ${_perMarketActive ? 'market-active-indicator--on' : ''}" id="market-active-pill">
          ${_perMarketActive ? '● PER-MARKET OVERRIDE ACTIVE' : '○ GLOBAL PARAMETERS ACTIVE'}
        </div>
      </div>

      <!-- Strategic Callout Quote -->
      <div class="market-quote-card">
        <div class="market-quote-label">STRATEGIC FREIGHT RULE (SECTION 6.4)</div>
        <div class="market-quote-text">
          &ldquo;China breach at week 14 — with 36-week lead time, this is <strong>ALREADY TOO LATE</strong> for sea freight. Only air freight can save this.&rdquo;
        </div>
      </div>

      <!-- Quick Preset Actions -->
      <div class="market-preset-row">
        <button class="btn-preset-sm" id="preset-sea-default">🌊 STANDARD SEA FREIGHT (36W China · 8W Brazil · 4W Japan)</button>
        <button class="btn-preset-sm" id="preset-air-all">✈️ AIR EXPEDITE ALL CORRIDORS (1–2W)</button>
      </div>

      <!-- Market Lead Times Table -->
      <div class="detail-section-label" style="margin-top:14px">CORRIDOR SUPPLY LEAD TIMES</div>
      <div class="market-table-container">
        <table class="market-config-table" id="market-config-table">
          <thead>
            <tr>
              <th>MARKET / CODE</th>
              <th>MODE</th>
              <th class="text-right">LEAD TIME</th>
              <th>FEASIBILITY</th>
            </tr>
          </thead>
          <tbody id="market-table-body">
            <!-- Rendered by renderMarketRows -->
          </tbody>
        </table>
      </div>

      <button class="btn-primary" id="btn-reset-market-defaults" style="width:100%;margin-top:14px">RESET CORRIDORS TO DEFAULTS</button>
    </div>
  `;

  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  if (overlay) overlay.classList.add('active');

  // Wire tabs
  const tabGlobal = document.getElementById('tab-btn-global');
  const tabMarket = document.getElementById('tab-btn-market');
  const panGlobal = document.getElementById('panel-scenario-global');
  const panMarket = document.getElementById('panel-scenario-market');

  tabGlobal.addEventListener('click', () => {
    tabGlobal.classList.add('active');
    tabMarket.classList.remove('active');
    panGlobal.style.display = 'block';
    panMarket.style.display = 'none';
  });

  tabMarket.addEventListener('click', () => {
    tabMarket.classList.add('active');
    tabGlobal.classList.remove('active');
    panMarket.style.display = 'block';
    panGlobal.style.display = 'none';
  });

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
      const recomp  = recomputeSignalScores(appData.top_signals, lt, cm, _marketOverrides, _perMarketActive);
      const approved = window._approvedSignals || {};
      renderSignalCards(recomp, approved);
    }
    renderMarketRows();
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

  // Wire per-market toggle
  const toggleMkt = document.getElementById('toggle-per-market');
  const pillMkt   = document.getElementById('market-active-pill');
  if (toggleMkt) {
    toggleMkt.addEventListener('change', () => {
      setPerMarketActive(toggleMkt.checked);
      if (pillMkt) {
        pillMkt.className = `market-active-indicator ${_perMarketActive ? 'market-active-indicator--on' : ''}`;
        pillMkt.textContent = _perMarketActive ? '● PER-MARKET OVERRIDE ACTIVE' : '○ GLOBAL PARAMETERS ACTIVE';
      }
      recalc();
    });
  }

  // Presets
  const btnPresetSea = document.getElementById('preset-sea-default');
  if (btnPresetSea) {
    btnPresetSea.addEventListener('click', () => {
      setMarketLeadTime('Country 013', 36, 'Sea Freight');
      setMarketLeadTime('China', 36, 'Sea Freight');
      setMarketLeadTime('Country 017', 8, 'Sea Freight');
      setMarketLeadTime('Brazil', 8, 'Sea Freight');
      setMarketLeadTime('Country 053', 4, 'Maritime / Air');
      setMarketLeadTime('Japan', 4, 'Maritime / Air');
      setPerMarketActive(true);
      if (toggleMkt) toggleMkt.checked = true;
      if (pillMkt) {
        pillMkt.className = 'market-active-indicator market-active-indicator--on';
        pillMkt.textContent = '● PER-MARKET OVERRIDE ACTIVE';
      }
      recalc();
    });
  }

  const btnPresetAir = document.getElementById('preset-air-all');
  if (btnPresetAir) {
    btnPresetAir.addEventListener('click', () => {
      setMarketLeadTime('Country 013', 2, 'Air Expedite');
      setMarketLeadTime('China', 2, 'Air Expedite');
      setMarketLeadTime('Country 017', 2, 'Air Expedite');
      setMarketLeadTime('Brazil', 2, 'Air Expedite');
      setMarketLeadTime('Country 053', 1, 'Air Expedite');
      setMarketLeadTime('Japan', 1, 'Air Expedite');
      setPerMarketActive(true);
      if (toggleMkt) toggleMkt.checked = true;
      if (pillMkt) {
        pillMkt.className = 'market-active-indicator market-active-indicator--on';
        pillMkt.textContent = '● PER-MARKET OVERRIDE ACTIVE';
      }
      recalc();
    });
  }

  const btnResetMkt = document.getElementById('btn-reset-market-defaults');
  if (btnResetMkt) {
    btnResetMkt.addEventListener('click', () => {
      resetMarketLeadTimes();
      setPerMarketActive(false);
      if (toggleMkt) toggleMkt.checked = false;
      if (pillMkt) {
        pillMkt.className = 'market-active-indicator';
        pillMkt.textContent = '○ GLOBAL PARAMETERS ACTIVE';
      }
      recalc();
    });
  }

  function renderMarketRows() {
    const tbody = document.getElementById('market-table-body');
    if (!tbody) return;

    const keyMarkets = [
      { code: 'Country 013', name: 'China', defaultLt: 36, defaultMode: 'Sea Freight' },
      { code: 'Country 017', name: 'Brazil', defaultLt: 8, defaultMode: 'Sea Freight' },
      { code: 'Country 053', name: 'Japan', defaultLt: 4, defaultMode: 'Maritime / Air' },
      { code: 'Country 020', name: 'United States', defaultLt: 6, defaultMode: 'Sea / Intermodal' },
      { code: 'Country 025', name: 'India', defaultLt: 5, defaultMode: 'Regional Maritime' },
      { code: 'Country 031', name: 'Germany', defaultLt: 3, defaultMode: 'Road / Rail' },
      { code: 'Country 032', name: 'United Kingdom', defaultLt: 3, defaultMode: 'Maritime / Road' },
      { code: 'Country 038', name: 'France', defaultLt: 3, defaultMode: 'Road / Rail' },
      { code: 'Country 045', name: 'Australia', defaultLt: 7, defaultMode: 'Sea Freight' },
      { code: 'Country 049', name: 'Canada', defaultLt: 4, defaultMode: 'Sea / Intermodal' }
    ];

    const appData = window.DATA || {};
    const sigs = appData.top_signals || [];

    tbody.innerHTML = keyMarkets.map(m => {
      const cfg = getMarketConfig(m.code);
      const lt = cfg.lead_time || m.defaultLt;
      const mode = cfg.mode || m.defaultMode;

      const mSigs = sigs.filter(s => s.country === m.code || s.country === m.name);
      const earliestBreach = mSigs.length ? Math.min(...mSigs.map(s => s.breach_week || 99)) : 99;
      const isCliff = _perMarketActive && lt >= 6 && earliestBreach < lt;

      const statusBadge = isCliff
        ? `<span class="feasibility-tag feasibility-tag--cliff">🚨 LATE FOR SEA (W${earliestBreach} &lt; ${lt}W)</span>`
        : `<span class="feasibility-tag feasibility-tag--ok">✓ ON CADENCE</span>`;

      return `
        <tr>
          <td>
            <div class="mkt-name">${m.name}</div>
            <div class="mkt-code">${m.code}</div>
          </td>
          <td>
            <button class="mkt-mode-btn ${mode.includes('Air') ? 'mkt-mode-btn--air' : 'mkt-mode-btn--sea'}" data-mkt="${m.code}">
              ${mode.includes('Air') ? '✈️ AIR' : '🌊 SEA'}
            </button>
          </td>
          <td class="text-right">
            <div class="mkt-lt-control">
              <input type="number" class="mkt-lt-input tabular-nums" data-mkt="${m.code}" min="1" max="52" value="${lt}">
              <span class="mkt-lt-unit">W</span>
            </div>
          </td>
          <td>${statusBadge}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.mkt-lt-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const mkt = e.target.getAttribute('data-mkt');
        const val = Math.max(1, Math.min(52, parseInt(e.target.value) || 3));
        e.target.value = val;
        setMarketLeadTime(mkt, val);
        recalc();
      });
    });

    tbody.querySelectorAll('.mkt-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mkt = e.currentTarget.getAttribute('data-mkt');
        const cfg = getMarketConfig(mkt);
        const isAir = (cfg.mode || '').includes('Air');
        const newMode = isAir ? 'Sea Freight' : 'Air Expedite';
        const newLt = isAir ? (DEFAULT_MARKET_LEAD_TIMES[mkt] ? DEFAULT_MARKET_LEAD_TIMES[mkt].lead_time : 36) : (cfg.air_lead_time || 2);
        setMarketLeadTime(mkt, newLt, newMode);
        recalc();
      });
    });
  }

  renderMarketRows();
}

export function closeScenarioDrawer() {
  const drawer = document.getElementById('drawer-scenario');
  if (drawer) { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
}
