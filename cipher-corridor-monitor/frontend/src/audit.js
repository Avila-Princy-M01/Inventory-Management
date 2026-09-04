/**
 * audit.js — GxP Audit Log: Proxy-driven table + CSV export
 */
import { getBadgeConfig } from './signals.js';

let _log = [];

export const REASON_CODES = ['Standard Order','Emergency Re-Allocation','Master Data Fix','Advisory Acknowledged','Excess Deferred'];

export function initAuditTable(logProxy) {
  _log = logProxy || [];
  renderTable();
  const btn = document.getElementById('btn-export-audit');
  if (btn) btn.onclick = exportAuditCSV;
}

export function renderTable() {
  const tbody = document.getElementById('tbody-audit');
  if (!tbody) return;
  if (!_log.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="audit-empty">[ NO ACTIONS LOGGED ]</td></tr>';
    return;
  }
  tbody.innerHTML = _log.map((e, i) => {
    const badge = getBadgeConfig(e.action_type || 'STANDARD PO');
    const opts  = REASON_CODES.map(rc => `<option value="${rc}" ${rc === (e.reason_code||'Standard Order') ? 'selected':''} >${rc}</option>`).join('');
    return `<tr>
      <td class="tabular-nums" style="font-size:10px;color:var(--muted);white-space:nowrap">${e.timestamp_utc||''}</td>
      <td class="tabular-nums" style="font-weight:600">#${(e.id||'').slice(0,8)}</td>
      <td style="font-weight:500">${e.sku||''}</td>
      <td><span class="badge ${badge.cls}">${badge.label}</span></td>
      <td class="text-right tabular-nums" style="font-weight:600">${Number(e.approved_qty||0).toLocaleString('en-IN')}</td>
      <td><select class="reason-select" data-idx="${i}">${opts}</select></td>
      <td style="font-size:10px;color:var(--ok-text);font-weight:600">${e.signature||'Analyst Session — GxP Compliant'}</td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('.reason-select').forEach(sel => {
    sel.addEventListener('change', e => { const idx = Number(e.target.dataset.idx); if (_log[idx]) _log[idx].reason_code = e.target.value; });
  });
}

export function exportAuditCSV() {
  const hdr = 'TIMESTAMP_UTC,ACTION_ID,SKU,ACTION_TYPE,APPROVED_QTY,REASON_CODE,ELECTRONIC_SIGNATURE\r\n';
  const rows = _log.map(e =>
    [`"${e.timestamp_utc||''}"`, `"${e.id||''}"`, `"${(e.sku||'').replace(/"/g,'""')}"`,
     `"${(e.action_type||'').replace(/"/g,'""')}"`, e.approved_qty||0,
     `"${(e.reason_code||'').replace(/"/g,'""')}"`, `"${(e.signature||'').replace(/"/g,'""')}"`].join(',')
  ).join('\r\n');
  const blob = new Blob([hdr + rows], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `gxp-audit-log-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
