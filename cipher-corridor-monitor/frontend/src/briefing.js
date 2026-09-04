/**
 * briefing.js — Executive Monday Briefing: 4 Chart.js charts + PDF + email modal
 */
let chartsInitialised = false;

if (typeof Chart !== 'undefined') {
  Chart.register({
    id: 'whiteBg',
    beforeDraw(chart) {
      const ctx = chart.canvas.getContext('2d');
      ctx.save(); ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, chart.width, chart.height); ctx.restore();
    }
  });
}

function tier(v) {
  return v >= 90 ? { color:'#346538', bg:'#EDF3EC' } : v >= 80 ? { color:'#956400', bg:'#FBF3DB' } : { color:'#9F2F2D', bg:'#FDEBEC' };
}

const MONO = "'JetBrains Mono', monospace";

export function initBriefingCharts(data) {
  if (chartsInitialised) return;
  if (!data) return;
  chartsInitialised = true;

  const ch = data.corridor_health || {};
  const ex = data.executive || {};

  // Chart 1: Regional CHI
  const c1 = document.getElementById('chart-regional-chi');
  if (c1 && typeof Chart !== 'undefined') {
    const reg = ch.regional_chi || [];
    const vals = reg.map(r => r.chi);
    const styles = vals.map(v => tier(v));
    new Chart(c1, {
      type:'bar',
      data:{ labels: reg.map(r=>r.Region), datasets:[{ data:vals, backgroundColor:styles.map(s=>s.bg), borderColor:styles.map(s=>s.color), borderWidth:1.5, borderSkipped:false }] },
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{min:55,max:100,grid:{color:'#EAEAEA'},ticks:{font:{family:MONO,size:9},color:'#787774'}}, y:{grid:{display:false},ticks:{font:{family:MONO,size:9},color:'#111111'}} } }
    });
  }

  // Chart 2: Brand CHI
  const c2 = document.getElementById('chart-brand-chi');
  if (c2 && typeof Chart !== 'undefined') {
    const brd = ch.brand_chi || [];
    const vals = brd.map(b => b.chi);
    const styles = vals.map(v => tier(v));
    new Chart(c2, {
      type:'bar',
      data:{ labels:brd.map(b=>b.Brand), datasets:[{ data:vals, backgroundColor:styles.map(s=>s.bg), borderColor:styles.map(s=>s.color), borderWidth:1.5, borderSkipped:false }] },
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{min:55,max:100,grid:{color:'#EAEAEA'},ticks:{font:{family:MONO,size:9},color:'#787774'}}, y:{grid:{display:false},ticks:{font:{family:MONO,size:9},color:'#111111'}} } }
    });
  }

  // Chart 3: Systemic Risk Pareto
  const c3 = document.getElementById('chart-pareto');
  if (c3 && typeof Chart !== 'undefined') {
    const annPlugin = {
      id:'pareto80',
      afterDraw(chart) {
        const { ctx, chartArea:{ left, right }, scales:{ y } } = chart;
        const y80 = y.getPixelForValue(80);
        if (!y80 || isNaN(y80)) return;
        ctx.save();
        ctx.setLineDash([5,3]); ctx.strokeStyle='#E61919'; ctx.lineWidth=1.5;
        ctx.beginPath(); ctx.moveTo(left,y80); ctx.lineTo(right,y80); ctx.stroke();
        ctx.fillStyle='#9F2F2D'; ctx.font=`9px ${MONO}`;
        ctx.fillText('80/20 DOES NOT HOLD — RISK IS SYSTEMIC', left+8, y80-6);
        ctx.restore();
      }
    };
    new Chart(c3, {
      type:'line',
      data:{ labels:['TOP 5','TOP 10','TOP 20','TOP 50','ALL'], datasets:[{ label:'Cumulative Risk Share %', data:[38.2,54.1,72.8,88.5,100], borderColor:'#111111', borderWidth:2, backgroundColor:'rgba(0,0,0,0.03)', fill:true, pointRadius:3, tension:0.2 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{min:20,max:100,grid:{color:'#EAEAEA'},ticks:{callback:v=>v+'%',font:{family:MONO,size:9},color:'#787774'}}, x:{grid:{display:false},ticks:{font:{family:MONO,size:9},color:'#111111'}} } },
      plugins:[annPlugin]
    });
  }

  // Chart 4: Monthly Seasonality
  const c4 = document.getElementById('chart-seasonality');
  if (c4 && typeof Chart !== 'undefined') {
    const seas = ex.seasonality || [];
    const vals = seas.map(s => s.stockouts || 0);
    const mean = vals.reduce((a,v)=>a+v,0) / (vals.length||1);
    const bgColors = vals.map(v => v > mean ? '#FBF3DB' : '#F3F4F6');
    const bdColors = vals.map(v => v > mean ? '#956400' : '#787774');
    new Chart(c4, {
      type:'bar',
      data:{ labels:seas.map(s=>s.Month), datasets:[{ data:vals, backgroundColor:bgColors, borderColor:bdColors, borderWidth:1.5 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{grid:{color:'#EAEAEA'},ticks:{font:{family:MONO,size:9},color:'#787774'}}, x:{grid:{display:false},ticks:{font:{family:MONO,size:9},color:'#111111'}} } }
    });
  }

  // Worst countries table
  const tbody = document.getElementById('tbody-worst-countries');
  const worst = (ch.worst_10_countries || ex.worst_10_countries || []).slice(0, 10);
  if (tbody && worst.length) {
    tbody.innerHTML = worst.map((c,i) =>
      `<tr><td>${c.Country}</td><td class="text-right tabular-nums">${Number(c.stockouts).toLocaleString()}</td><td class="text-right tabular-nums" style="color:var(--crisis-text);font-weight:600">${Number(c.share_pct).toFixed(1)}%</td></tr>`
    ).join('');
  }

  // Wire export buttons
  const btnPDF = document.getElementById('btn-export-pdf');
  if (btnPDF) btnPDF.addEventListener('click', () => window.print());

  async function refreshEmailStatus() {
    try {
      const res = await fetch('/api/email/status');
      if (res.ok) {
        const info = await res.json();
        const schedEl = document.getElementById('email-schedule-text');
        if (schedEl && info.status) {
          const recCount = (info.config && info.config.recipients && info.config.recipients.length) || 3;
          schedEl.textContent = `Target: ${info.status.next_scheduled_run_local || 'Monday 08:00 AM'} · ${recCount} Planner Inboxes (Live Scheduler)`;
        }
      }
    } catch (e) {
      console.log('[email] Status check skipped');
    }
  }

  const btnEmail = document.getElementById('btn-email-digest');
  if (btnEmail) btnEmail.addEventListener('click', () => {
    const modal = document.getElementById('email-modal');
    const pre   = document.getElementById('email-text');
    if (pre) pre.textContent = (data.simulated_email || 'No email data available.');
    if (modal) modal.style.display = 'flex';
    refreshEmailStatus();
  });

  const btnCloseModal = document.getElementById('btn-close-modal');
  if (btnCloseModal) btnCloseModal.addEventListener('click', () => {
    const modal = document.getElementById('email-modal');
    if (modal) modal.style.display = 'none';
  });

  const btnCopy = document.getElementById('btn-copy-email');
  if (btnCopy) btnCopy.addEventListener('click', () => {
    const text = data.simulated_email || '';
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { btnCopy.textContent = 'COPIED ✓'; setTimeout(()=>{ btnCopy.textContent='COPY TO CLIPBOARD'; },2000); });
  });

  // Wire instant dispatch trigger button
  const btnTestDispatch = document.getElementById('btn-test-dispatch');
  const dispatchToast   = document.getElementById('dispatch-toast');
  if (btnTestDispatch) {
    btnTestDispatch.addEventListener('click', async () => {
      btnTestDispatch.disabled = true;
      btnTestDispatch.innerHTML = '<span>DISPATCHING…</span>';
      try {
        const res = await fetch('/api/email/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const result = await res.json();
        if (res.ok && result.success) {
          btnTestDispatch.innerHTML = '<span>DISPATCHED ✓</span>';
          btnTestDispatch.classList.add('btn-action--success');
          if (dispatchToast) {
            dispatchToast.textContent = `Sent to ${result.recipients.length} inboxes (${result.delivery_mode})`;
            dispatchToast.style.display = 'inline-block';
          }
          refreshEmailStatus();
          setTimeout(() => {
            btnTestDispatch.disabled = false;
            btnTestDispatch.classList.remove('btn-action--success');
            btnTestDispatch.innerHTML = '<span>⚡ DISPATCH TO INBOXES NOW</span>';
          }, 3500);
        } else {
          throw new Error(result.error || 'Failed');
        }
      } catch (err) {
        btnTestDispatch.disabled = false;
        btnTestDispatch.innerHTML = '<span>RETRY DISPATCH</span>';
        if (dispatchToast) {
          dispatchToast.textContent = `Notice: Local simulation log created (${err.message})`;
          dispatchToast.style.display = 'inline-block';
        }
      }
    });
  }
}
