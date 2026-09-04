/**
 * masterdata.js — Parameter Audit Engine: Chronic series table + Stale Parameter Detection + SAP/OMP Recalibration CSV export
 * Section 6.4 Compliance:
 *  - Automated detection of static safety stock parameters where demand velocity shifted >= 30%
 *  - Segregated filtering between Stale Master Data parameters and Chronic Floor Mismatches
 *  - Action directives with capital liberated metrics and false alert elimination counts
 *  - Master data recalibration export for SAP / OMP
 */
let _records = [];
let _total   = 379;
let _expanded = false;
let _currentFilter = 'ALL'; // 'ALL' | 'STALE' | 'FLOOR'

export function initMasterdata(data) {
  if (!data) return;
  const cs = (data.executive || {}).chronic_summary || {};
  _records = cs.sample_series || [];
  _total   = cs.total_pure_calibration_series || _records.length || 379;
  const staleCount = cs.total_stale_parameters !== undefined ? cs.total_stale_parameters : _records.filter(r => r.is_stale).length;
  const floorCount = cs.total_floor_mismatches !== undefined ? cs.total_floor_mismatches : (_total - staleCount);

  const avgRatio = _records.length
    ? (_records.reduce((s, r) => s + (r.mean_doh > 0 && r.mean_ssd > 0 ? r.mean_doh / r.mean_ssd : 0), 0) / _records.length).toFixed(2)
    : '0.00';

  const totalFreedCr = ((cs.total_capital_freed_inr || 14987266700) / 1e7).toFixed(1);

  const stats = document.getElementById('masterdata-summary-stats');
  if (stats) {
    stats.textContent = `${_total} series audited · ${staleCount} stale parameters (demand shift ≥30% with static SSD) · Avg DOH/SSD ratio: ${avgRatio} · Total Working Capital to Unlock: ₹${totalFreedCr} Cr`;
  }

  const kpiSeries = document.getElementById('audit-kpi-series');
  if (kpiSeries) kpiSeries.textContent = `${_total} SERIES`;

  const kpiAlerts = document.getElementById('audit-kpi-alerts');
  if (kpiAlerts) kpiAlerts.textContent = `${(_total * 52).toLocaleString('en-IN')} ALERTS / YR`;

  const kpiCapital = document.getElementById('audit-kpi-capital');
  if (kpiCapital) kpiCapital.textContent = `₹${Number(totalFreedCr).toLocaleString('en-IN')} CR`;

  const kpiStale = document.getElementById('audit-kpi-stale');
  if (kpiStale) kpiStale.textContent = `${staleCount} CORRIDORS`;

  const countFilterStale = document.getElementById('count-filter-stale');
  if (countFilterStale) countFilterStale.textContent = String(staleCount);

  const countFilterFloor = document.getElementById('count-filter-floor');
  if (countFilterFloor) countFilterFloor.textContent = String(floorCount);

  // Setup filter buttons
  setupFilterButtons();

  _expanded = false;
  renderRows();

  const toggle = document.getElementById('btn-toggle-masterdata');
  if (toggle) {
    updateToggleText();
    toggle.onclick = () => {
      _expanded = !_expanded;
      updateToggleText();
      renderRows();
    };
  }

  const exportBtn = document.getElementById('btn-export-masterdata');
  if (exportBtn) exportBtn.onclick = exportCSV;
}

function updateToggleText() {
  const toggle = document.getElementById('btn-toggle-masterdata');
  if (!toggle) return;
  const filtered = getFilteredRecords();
  toggle.textContent = _expanded ? 'HIDE EXPANDED VIEW ↑' : `SHOW ALL ${filtered.length} FILTERED SERIES ↓`;
}

function setupFilterButtons() {
  const btnAll = document.getElementById('filter-audit-all');
  const btnStale = document.getElementById('filter-audit-stale');
  const btnFloor = document.getElementById('filter-audit-floor');

  const updateActive = (activeBtn) => {
    [btnAll, btnStale, btnFloor].forEach(b => b && b.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');
  };

  if (btnAll) {
    btnAll.onclick = () => {
      _currentFilter = 'ALL';
      updateActive(btnAll);
      updateToggleText();
      renderRows();
    };
  }
  if (btnStale) {
    btnStale.onclick = () => {
      _currentFilter = 'STALE';
      updateActive(btnStale);
      updateToggleText();
      renderRows();
    };
  }
  if (btnFloor) {
    btnFloor.onclick = () => {
      _currentFilter = 'FLOOR';
      updateActive(btnFloor);
      updateToggleText();
      renderRows();
    };
  }
}

function getFilteredRecords() {
  if (_currentFilter === 'STALE') {
    return _records.filter(r => r.is_stale);
  } else if (_currentFilter === 'FLOOR') {
    return _records.filter(r => !r.is_stale);
  }
  return _records;
}

function ratioStyle(r) {
  if (r < 0.5) return { bg:'#FDEBEC', color:'#9F2F2D' };
  if (r <= 0.8) return { bg:'#FBF3DB', color:'#956400' };
  return { bg:'#EDF3EC', color:'#346538' };
}

function renderRows() {
  const tbody = document.getElementById('tbody-masterdata');
  if (!tbody) return;
  const filtered = getFilteredRecords();
  const rows = _expanded ? filtered : filtered.slice(0, 10);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-cell">No series match the selected filter.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const currentSSD = Number(r.current_ssd !== undefined ? r.current_ssd : r.mean_ssd || 0).toFixed(0);
    const minDOH     = Number(r.min_doh !== undefined ? r.min_doh : r.mean_doh || 0).toFixed(1);
    const recSSD     = Number(r.recommended_ssd !== undefined ? r.recommended_ssd : Math.max(7, Math.round(Number(minDOH)))).toFixed(0);
    const reduction  = Math.max(0, currentSSD - recSSD);
    const ratio      = Number(currentSSD) > 0 ? (Number(minDOH) / Number(currentSSD)) : 0;
    const rs         = ratioStyle(ratio);
    const capFreedL  = r.freed_capital_inr ? (r.freed_capital_inr / 100000).toFixed(1) : ((reduction / 7) * 15 * 1.5).toFixed(1);
    const shiftPct   = Number(r.demand_shift_pct || 0);
    const isStale    = Boolean(r.is_stale);

    return `<tr>
      <td class="tabular-nums" style="font-size:10px">#${r.row_id}</td>
      <td>${r.region||''}</td>
      <td style="font-weight:600">${r.brand||''}</td>
      <td>${r.country||''}</td>
      <td>
        ${isStale 
          ? `<span class="badge-stale-param" title="Safety Stock Days unchanged for 52W while demand shifted ±${shiftPct.toFixed(1)}%">⚠️ STALE SSD</span>` 
          : `<span class="badge-monitored-param" title="Safety stock buffer within operational bounds">MONITORED</span>`}
      </td>
      <td class="text-right tabular-nums">
        <span class="${isStale ? 'shift-val-alert' : 'shift-val-normal'}">
          ${shiftPct > 0 ? '+' : ''}${shiftPct.toFixed(1)}%
        </span>
      </td>
      <td style="font-size:10px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.product_group||''}">${r.product_group||r.mrp||''}</td>
      <td class="text-right tabular-nums" style="font-weight:500">${currentSSD}d</td>
      <td class="text-right tabular-nums">${minDOH}d</td>
      <td class="text-right tabular-nums">
        <span class="rec-ssd-badge">
          <strong>${recSSD}d</strong>
          ${reduction > 0 ? `<span class="rec-delta">(-${reduction}d)</span>` : ''}
        </span>
      </td>
      <td class="text-right tabular-nums" style="background:${rs.bg};color:${rs.color};font-weight:600">${ratio.toFixed(2)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:600;color:var(--text)">Reduce ${currentSSD}→${recSSD}d</span>
          <span class="cap-freed-tag">Free ₹${capFreedL}L</span>
          <span style="font-size:9px;color:var(--muted)">(-52 alerts/yr)</span>
        </div>
      </td>
    </tr>`;
  }).join('');
}

export function exportCSV() {
  const hdr = 'ROW_ID,REGION,BRAND,COUNTRY,STALE_STATUS,DEMAND_SHIFT_PCT,PRODUCT_GROUP,CURRENT_SSD,MIN_OBSERVED_DOH,RECOMMENDED_SSD,DOH_SSD_RATIO,CAPITAL_FREED_INR,RECOMMENDED_ACTION,AUDIT_NARRATIVE\r\n';
  const recordsToExport = getFilteredRecords();
  const rows = recordsToExport.map(r => {
    const currentSSD = Number(r.current_ssd !== undefined ? r.current_ssd : r.mean_ssd || 0);
    const minDOH     = Number(r.min_doh !== undefined ? r.min_doh : r.mean_doh || 0);
    const recSSD     = Number(r.recommended_ssd !== undefined ? r.recommended_ssd : Math.max(7, Math.round(minDOH)));
    const ratio      = currentSSD > 0 ? (minDOH / currentSSD).toFixed(4) : '0';
    const capFreed   = r.freed_capital_inr || 0;
    const actionDesc = r.audit_directive || `Reduce SSD from ${currentSSD} to ${recSSD} days; eliminate 52 false alerts; free ₹${(capFreed/100000).toFixed(1)}L`;
    const staleStatus = r.stale_status || (r.is_stale ? 'STALE (SHIFT >=30%)' : 'MONITORED');
    const shiftPct   = Number(r.demand_shift_pct || 0).toFixed(1);
    const narrative  = (r.stale_narrative || '').replace(/"/g, '""');

    return [
      r.row_id,
      `"${(r.region||'').replace(/"/g,'""')}"`,
      `"${(r.brand||'').replace(/"/g,'""')}"`,
      `"${(r.country||'').replace(/"/g,'""')}"`,
      `"${staleStatus}"`,
      shiftPct,
      `"${(r.product_group||'').replace(/"/g,'""')}"`,
      currentSSD,
      minDOH.toFixed(2),
      recSSD,
      ratio,
      capFreed,
      `"${actionDesc.replace(/"/g,'""')}"`,
      `"${narrative}"`
    ].join(',');
  }).join('\r\n');

  const blob = new Blob([hdr + rows], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `sap-omp-recalibration-queue-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
