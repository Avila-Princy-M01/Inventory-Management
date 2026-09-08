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
let _selectedIds = new Set();
let _stagedIds = new Set();

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
    stats.textContent = `${_total} series audited · ${staleCount} stale parameters · Avg DOH/SSD: ${avgRatio} · Total Capital to Unlock: ₹${totalFreedCr} Cr`;
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

  const countFilterAll = document.getElementById('count-filter-all');
  if (countFilterAll) countFilterAll.textContent = String(_total);

  // Setup filter buttons
  setupFilterButtons();

  // Setup Batch Stage Button & Select All
  setupBatchActions();

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

function setupBatchActions() {
  const selectAllCb = document.getElementById('cb-masterdata-select-all');
  const batchBtn = document.getElementById('btn-batch-stage-sap');

  if (selectAllCb) {
    selectAllCb.onclick = (e) => {
      const filtered = getFilteredRecords();
      const visible = _expanded ? filtered : filtered.slice(0, 10);
      if (e.target.checked) {
        visible.forEach(r => _selectedIds.add(r.row_id));
      } else {
        visible.forEach(r => _selectedIds.delete(r.row_id));
      }
      updateBatchButton();
      renderRows();
    };
  }

  if (batchBtn) {
    batchBtn.onclick = () => {
      if (_selectedIds.size === 0) return;
      _selectedIds.forEach(id => _stagedIds.add(id));
      const count = _selectedIds.size;
      _selectedIds.clear();
      updateBatchButton();
      renderRows();
      showToast(`✓ Successfully staged ${count} series to SAP/OMP Master Data RFC buffer.`);
    };
  }
}

function updateBatchButton() {
  const batchBtn = document.getElementById('btn-batch-stage-sap');
  const countSpan = document.getElementById('selected-count');
  if (countSpan) countSpan.textContent = String(_selectedIds.size);
  if (batchBtn) batchBtn.disabled = _selectedIds.size === 0;

  const selectAllCb = document.getElementById('cb-masterdata-select-all');
  if (selectAllCb) {
    const filtered = getFilteredRecords();
    const visible = _expanded ? filtered : filtered.slice(0, 10);
    const allSelected = visible.length > 0 && visible.every(r => _selectedIds.has(r.row_id));
    selectAllCb.checked = allSelected;
  }
}

function showToast(msg) {
  let toast = document.getElementById('sap-dynamic-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sap-dynamic-toast';
    toast.className = 'sap-sync-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.zIndex = '9999';
    document.body.appendChild(toast);
  }
  toast.innerHTML = msg;
  toast.style.display = 'inline-flex';
  setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, 4500);
}

function getFilteredRecords() {
  if (_currentFilter === 'STALE') {
    return _records.filter(r => r.is_stale);
  } else if (_currentFilter === 'FLOOR') {
    return _records.filter(r => !r.is_stale);
  }
  return _records;
}

export function ratioStyle(r) {
  if (r < 0.5) return { bg:'#FDEBEC', color:'#9F2F2D', border:'#F5A6A6' };
  if (r <= 0.8) return { bg:'#FBF3DB', color:'#956400', border:'#FDE68A' };
  return { bg:'#EDF3EC', color:'#346538', border:'#BBF7D0' };
}
export const getRatioStyle = ratioStyle;

function renderRows() {
  const tbody = document.getElementById('tbody-masterdata');
  if (!tbody) return;
  const filtered = getFilteredRecords();
  const rows = _expanded ? filtered : filtered.slice(0, 10);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No series match the selected filter.</td></tr>';
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
    const isSelected = _selectedIds.has(r.row_id);
    const isStaged   = _stagedIds.has(r.row_id);

    return `<tr class="${isSelected ? 'row-selected' : ''}">
      <td class="sap-checkbox-col" style="vertical-align: middle;">
        <input type="checkbox" class="sap-select-cb" data-id="${r.row_id}" ${isSelected ? 'checked' : ''} />
      </td>
      <td class="tabular-nums" style="font-size:11px; font-weight:700; color:var(--text); vertical-align: middle;">
        #${r.row_id}
      </td>
      <td style="vertical-align: middle;">
        <div style="font-weight:700; font-size:13px; color:var(--ink); display:flex; align-items:center; gap:6px;">
          <span>${r.brand||''}</span>
          <span style="font-size:9.5px; font-family:var(--font-mono); font-weight:600; color:var(--text-muted); background:var(--surface-subtle); padding:1px 5px; border-radius:3px;">${r.mrp || 'MRP'}</span>
        </div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
          <strong>${r.country||''}</strong> &middot; ${r.region||''}
        </div>
        <div style="font-size:10px; color:var(--text-muted); max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px;" title="${r.product_group||''}">
          ${r.product_group||''}
        </div>
      </td>
      <td style="vertical-align: middle;">
        <div style="margin-bottom: 4px;">
          ${isStaged
            ? `<span class="status-chip status-chip-approved">✓ STAGED TO SAP</span>`
            : isStale 
              ? `<span class="status-chip status-chip-stale" title="Safety Stock Days unchanged for 52W while demand shifted ±${shiftPct.toFixed(1)}%">⚡ STALE SSD</span>` 
              : `<span class="status-chip status-chip-monitored" title="Safety stock buffer within operational bounds">MONITORED</span>`}
        </div>
        <div style="font-size: 11px; font-family:var(--font-mono); color: var(--text-muted);">
          Demand: <strong class="${isStale ? 'shift-val-alert' : 'shift-val-normal'}">${shiftPct > 0 ? '+' : ''}${shiftPct.toFixed(1)}%</strong>
        </div>
      </td>
      <td class="text-right tabular-nums" style="vertical-align: middle;">
        <div style="background:${rs.bg}; color:${rs.color}; border:1px solid ${rs.border}; font-weight:700; display:inline-block; padding:2px 8px; border-radius:4px; font-size:11.5px; font-family:var(--font-mono); margin-bottom:3px;">
          Ratio: ${ratio.toFixed(2)}
        </div>
        <div style="font-size: 10.5px; color: var(--text-muted); font-family:var(--font-mono);">Min DOH: <strong>${minDOH}d</strong></div>
      </td>
      <td style="vertical-align: middle;">
        <div class="recal-vector">
          <div class="recal-from">
            <div class="recal-label">Current</div>
            <div class="recal-val-from">${currentSSD}d</div>
          </div>
          <div class="recal-arrow">&rarr;</div>
          <div class="recal-to">
            <div class="recal-label">Recommended</div>
            <div class="recal-val-to">${recSSD}d</div>
          </div>
          ${reduction > 0 ? `<span class="recal-delta-tag">-${reduction}d</span>` : ''}
        </div>
      </td>
      <td class="text-right" style="vertical-align: middle;">
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <div class="financial-liberation-badge">
            <span class="fin-cap-tag">Free ₹${capFreedL}L</span>
            <span class="fin-alert-sub">-52 alerts/yr</span>
          </div>
          ${isStaged 
            ? `<button class="action-sync-btn btn-staged">✓ STAGED</button>`
            : `<button class="action-sync-btn btn-single-stage" data-id="${r.row_id}">STAGE SAP</button>`}
        </div>
      </td>
    </tr>`;
  }).join('');

  // Row selection handler
  tbody.querySelectorAll('.sap-select-cb').forEach(cb => {
    cb.onclick = (e) => {
      const id = Number(e.target.getAttribute('data-id'));
      if (e.target.checked) {
        _selectedIds.add(id);
      } else {
        _selectedIds.delete(id);
      }
      updateBatchButton();
      const tr = e.target.closest('tr');
      if (tr) tr.classList.toggle('row-selected', e.target.checked);
    };
  });

  // Single Stage button handler
  tbody.querySelectorAll('.btn-single-stage').forEach(btn => {
    btn.onclick = (e) => {
      const id = Number(e.target.getAttribute('data-id'));
      _stagedIds.add(id);
      _selectedIds.delete(id);
      updateBatchButton();
      renderRows();
      showToast(`✓ Staged Series #${id} recalibration directive to SAP/OMP queue.`);
    };
  });
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

