/**
 * masterdata.js — Parameter Audit Engine: Chronic series table + SAP/OMP Recalibration CSV export
 */
let _records = [];
let _total   = 379;
let _expanded = false;

export function initMasterdata(data) {
  if (!data) return;
  const cs = (data.executive || {}).chronic_summary || {};
  _records = cs.sample_series || [];
  _total   = cs.total_pure_calibration_series || _records.length || 379;

  const avgRatio = _records.length
    ? (_records.reduce((s, r) => s + (r.mean_doh > 0 && r.mean_ssd > 0 ? r.mean_doh / r.mean_ssd : 0), 0) / _records.length).toFixed(2)
    : '0.00';

  const totalFreedCr = ((cs.total_capital_freed_inr || 14987266700) / 1e7).toFixed(1);

  const stats = document.getElementById('masterdata-summary-stats');
  if (stats) {
    stats.textContent = `${_total} series with chronic safety stock floor mismatches · Avg DOH/SSD ratio: ${avgRatio} (target ≥ 1.00) · Total Working Capital to Unlock: ₹${totalFreedCr} Cr`;
  }

  const kpiSeries = document.getElementById('audit-kpi-series');
  if (kpiSeries) kpiSeries.textContent = `${_total} SERIES`;

  const kpiAlerts = document.getElementById('audit-kpi-alerts');
  if (kpiAlerts) kpiAlerts.textContent = `${(_total * 52).toLocaleString('en-IN')} ALERTS / YR`;

  const kpiCapital = document.getElementById('audit-kpi-capital');
  if (kpiCapital) kpiCapital.textContent = `₹${Number(totalFreedCr).toLocaleString('en-IN')} CR`;

  _expanded = false;
  renderRows();

  const toggle = document.getElementById('btn-toggle-masterdata');
  if (toggle) {
    toggle.textContent = `SHOW ALL ${_total} SERIES ↓`;
    toggle.onclick = () => {
      _expanded = !_expanded;
      toggle.textContent = _expanded ? 'HIDE EXPANDED VIEW ↑' : `SHOW ALL ${_total} SERIES ↓`;
      renderRows();
    };
  }

  const exportBtn = document.getElementById('btn-export-masterdata');
  if (exportBtn) exportBtn.onclick = exportCSV;
}

function ratioStyle(r) {
  if (r < 0.5) return { bg:'#FDEBEC', color:'#9F2F2D' };
  if (r <= 0.8) return { bg:'#FBF3DB', color:'#956400' };
  return { bg:'#EDF3EC', color:'#346538' };
}

function renderRows() {
  const tbody = document.getElementById('tbody-masterdata');
  if (!tbody) return;
  const rows = _expanded ? _records : _records.slice(0, 10);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">No chronic series data available.</td></tr>';
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

    return `<tr>
      <td class="tabular-nums" style="font-size:10px">#${r.row_id}</td>
      <td>${r.region||''}</td>
      <td style="font-weight:600">${r.brand||''}</td>
      <td>${r.country||''}</td>
      <td style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.product_group||''}">${r.product_group||r.mrp||''}</td>
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
  const hdr = 'ROW_ID,REGION,BRAND,COUNTRY,PRODUCT_GROUP,CURRENT_SSD,MIN_OBSERVED_DOH,RECOMMENDED_SSD,DOH_SSD_RATIO,CAPITAL_FREED_INR,RECOMMENDED_ACTION\r\n';
  const rows = _records.map(r => {
    const currentSSD = Number(r.current_ssd !== undefined ? r.current_ssd : r.mean_ssd || 0);
    const minDOH     = Number(r.min_doh !== undefined ? r.min_doh : r.mean_doh || 0);
    const recSSD     = Number(r.recommended_ssd !== undefined ? r.recommended_ssd : Math.max(7, Math.round(minDOH)));
    const ratio      = currentSSD > 0 ? (minDOH / currentSSD).toFixed(4) : '0';
    const capFreed   = r.freed_capital_inr || 0;
    const actionDesc = r.audit_directive || `Reduce SSD from ${currentSSD} to ${recSSD} days; eliminate 52 false alerts; free ₹${(capFreed/100000).toFixed(1)}L`;

    return [
      r.row_id,
      `"${(r.region||'').replace(/"/g,'""')}"`,
      `"${(r.brand||'').replace(/"/g,'""')}"`,
      `"${(r.country||'').replace(/"/g,'""')}"`,
      `"${(r.product_group||'').replace(/"/g,'""')}"`,
      currentSSD,
      minDOH.toFixed(2),
      recSSD,
      ratio,
      capFreed,
      `"${actionDesc.replace(/"/g,'""')}"`
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
