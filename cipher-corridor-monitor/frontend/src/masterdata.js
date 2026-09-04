/**
 * masterdata.js — Chronic series table + CSV export
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

  const stats = document.getElementById('masterdata-summary-stats');
  if (stats) stats.textContent = `${_total} series with chronic safety stock floor mismatches · Avg DOH/SSD ratio: ${avgRatio} (target ≥ 1.00)`;

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
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">No chronic series data available.</td></tr>'; return; }
  tbody.innerHTML = rows.map(r => {
    const doh   = Number(r.mean_doh || 0).toFixed(1);
    const ssd   = Number(r.mean_ssd || 0).toFixed(1);
    const ratio = Number(r.mean_ssd) > 0 ? (Number(r.mean_doh) / Number(r.mean_ssd)) : 0;
    const rs    = ratioStyle(ratio);
    return `<tr>
      <td class="tabular-nums" style="font-size:10px">#${r.row_id}</td>
      <td>${r.region||''}</td>
      <td style="font-weight:500">${r.brand||''}</td>
      <td>${r.country||''}</td>
      <td style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.product_group||''}">${r.product_group||r.mrp||''}</td>
      <td class="text-right tabular-nums">${doh}d</td>
      <td class="text-right tabular-nums">${ssd}d</td>
      <td class="text-right tabular-nums" style="background:${rs.bg};color:${rs.color};font-weight:600">${ratio.toFixed(2)}</td>
      <td style="font-size:10px;color:var(--warn-text)">${r.action||'RECALIBRATE SAP/OMP'}</td>
    </tr>`;
  }).join('');
}

export function exportCSV() {
  const hdr = 'ROW_ID,REGION,BRAND,COUNTRY,PRODUCT_GROUP,MEAN_DOH,MEAN_SSD,DOH_SSD_RATIO,ACTION\r\n';
  const rows = _records.map(r => {
    const ratio = Number(r.mean_ssd) > 0 ? (Number(r.mean_doh)/Number(r.mean_ssd)).toFixed(4) : '0';
    return [r.row_id, `"${(r.region||'').replace(/"/g,'""')}"`, `"${(r.brand||'').replace(/"/g,'""')}"`,
      `"${(r.country||'').replace(/"/g,'""')}"`, `"${(r.product_group||'').replace(/"/g,'""')}"`,
      Number(r.mean_doh||0).toFixed(2), Number(r.mean_ssd||0).toFixed(2), ratio, `"${(r.action||'').replace(/"/g,'""')}"`].join(',');
  }).join('\r\n');
  const blob = new Blob([hdr + rows], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `sap-omp-recalibration-queue-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
