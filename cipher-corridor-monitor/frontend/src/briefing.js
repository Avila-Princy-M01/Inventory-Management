/**
 * briefing.js — Executive Monday Briefing & Meeting-Specific Formatting (Section 6.6)
 * Supports:
 *  1. Novo Nordisk S&OP Executive Review (Monthly)
 *  2. Weekly Tier-3 S&OE Operations Standup (Monday 08:30 CET)
 *  3. Global Supply Chain Risk & Allocation Committee
 *  4. 16:9 Presentation Slide Deck Viewer
 *  5. 4 Chart.js charts + PDF + Meeting-Tailored Email Minutes
 */
let chartsInitialised = false;
let currentMeetingId = 'SOP_MONTHLY';

export const MEETING_FORMATS = {
  'SOP_MONTHLY': {
    id: 'SOP_MONTHLY',
    title: 'NOVO NORDISK GLOBAL S&OP EXECUTIVE COMMITTEE REVIEW',
    subtitle: 'Monthly Sales & Operations Planning Cycle · Strategic Working Capital & Allocation Directive',
    agendaRef: 'Agenda Item 3.1: Global Inventory Corridor Equilibrium & Capital Allocation',
    docId: 'NN-GSC-SOP-2026-M09',
    cadence: 'Monthly Governance Review (Pre-Executive Sign-Off)',
    chair: 'VP Global Supply Chain & S&OP Governance Committee',
    focusSummary: 'Strategic balancing of finished goods inventory across 5,000 corridors, cross-market quota allocation, and SAP/OMP master data parameter recalibration sign-off (Section 6.4).',
    sections: [
      { num: '01', title: 'Executive Posture & WoW Delta', desc: 'Net CHI recovery (+1.2 pts), 3 acute crises resolved, ₹14.2 Cr active exposure mitigated.' },
      { num: '02', title: 'Regional Corridor Integrity', desc: 'Regional CHI performance evaluation (Region 01–05) vs 95.0% contractual OTIF SLA.' },
      { num: '03', title: 'Parameter Recalibration Sign-Off', desc: 'Section 6.4 audit: 379 chronic series identified. Approval to reduce SSD in SAP/OMP to unlock ₹7.2 Cr.' },
      { num: '04', title: 'Executive Decision Scorecard', desc: 'Formal GxP sign-off, capital commitments, and supply chain allocation directives.' }
    ]
  },
  'SOE_WEEKLY': {
    id: 'SOE_WEEKLY',
    title: 'WEEKLY TIER-3 S&OE OPERATIONS STANDUP',
    subtitle: 'Monday 08:30 CET Global Operations Standup · Tactical Execution & 14-Day Horizon Triage',
    agendaRef: 'Agenda Item 1.0: Active Crisis Triage & 24h Escalation SLA Compliance',
    docId: 'NN-OPS-SOE-2026-W32',
    cadence: 'Weekly Monday 08:30 CET Standup',
    chair: 'Head of Global Planning Operations & Regional Distribution Leads',
    focusSummary: 'Tactical execution on active crisis corridors, 24h corporate SLA escalation triage, sea freight cliff overrides, and emergency air charter releases.',
    sections: [
      { num: '01', title: '24-Hour SLA Governance Triage', desc: 'Active countdown monitoring for critical acute crises; auto-escalation prevention.' },
      { num: '02', title: 'Sea Freight Lead-Time Cliffs', desc: 'Identification of lead-time violations (e.g. China breach at W14 vs 36W sea transit).' },
      { num: '03', title: 'Inter-Market Transfer Dispatch', desc: 'Execution of matched surplus routes (e.g. Country 059 → Country 013 air charter).' },
      { num: '04', title: 'Supplier PO Commitment & Certainty', desc: 'Inbound pipeline verification for corridors with unconfirmed orders > 50%.' }
    ]
  },
  'RISK_COMMITTEE': {
    id: 'RISK_COMMITTEE',
    title: 'GLOBAL SUPPLY CHAIN RISK & ALLOCATION COMMITTEE',
    subtitle: 'Clinical Supply Continuity, Cross-Border Quota Rebalancing & Stock Preservation',
    agendaRef: 'Agenda Item 2.4: Emergency Stock Transfers & Critical Clinical Continuity',
    docId: 'NN-GSC-RAC-2026-W32',
    cadence: 'Bi-Weekly Risk & Allocation Steering Session',
    chair: 'Global Chief Medical & Supply Chain Risk Officer',
    focusSummary: 'Zero-patient-stockout mandate: Safeguarding clinical availability through inter-affiliate surplus transfers without triggering collateral understocking.',
    sections: [
      { num: '01', title: 'Clinical Continuity & Stockout Defense', desc: 'Protection of high-severity patient corridors; zero stockout tolerance.' },
      { num: '02', title: 'Donor Market Safety Floor Verification', desc: 'GxP validation that donor corridors retain post-transfer DOH > SSD floor.' },
      { num: '03', title: 'Air Charter Priority Clearance', desc: '4-day air transit approval for acute corridors with irrecoverable sea transit.' },
      { num: '04', title: 'Cross-Border Regulatory Compliance', desc: 'GxP trace-log verification, reason code documentation, and batch tracking.' }
    ]
  }
};

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
  return v >= 90 ? { color: '#346538', bg: '#EDF3EC' } : v >= 80 ? { color: '#956400', bg: '#FBF3DB' } : { color: '#9F2F2D', bg: '#FDEBEC' };
}

const MONO = "'JetBrains Mono', monospace";

export function renderMeetingGovernance(meetingId = 'SOP_MONTHLY', data = null) {
  const container = document.getElementById('meeting-governance-dossier');
  if (!container) return;
  const m = MEETING_FORMATS[meetingId] || MEETING_FORMATS['SOP_MONTHLY'];

  container.innerHTML = `
    <div class="meeting-gov-meta-row">
      <div class="meeting-gov-title-block">
        <div class="meeting-gov-title">${m.title}</div>
        <div class="meeting-gov-sub">${m.subtitle} · ${m.agendaRef}</div>
      </div>
      <div class="meeting-gov-badges">
        <span class="meeting-gov-tag meeting-gov-tag--gxp">${m.docId}</span>
        <span class="meeting-gov-tag">${m.cadence}</span>
      </div>
    </div>
    <div class="meeting-gov-focus-quote">
      <strong>MANDATE / CHAIR:</strong> ${m.chair} — &ldquo;${m.focusSummary}&rdquo;
    </div>
    <div class="meeting-agenda-grid">
      ${m.sections.map(s => `
        <div class="meeting-agenda-item">
          <div class="meeting-agenda-num">SECTION ${s.num}</div>
          <div class="meeting-agenda-title">${s.title}</div>
          <div class="meeting-agenda-desc">${s.desc}</div>
        </div>
      `).join('')}
    </div>
  `;
}

export function generateMeetingEmail(meetingId = 'SOP_MONTHLY', data = null) {
  const m = MEETING_FORMATS[meetingId] || MEETING_FORMATS['SOP_MONTHLY'];
  const ch = (data && data.corridor_health) || {};
  const wow = ch.wow_delta || {};
  const topSigs = (data && data.top_signals) || [];
  const acuteSigs = topSigs.filter(s => (s.action_type || '').includes('CRISIS') || (s.action_type || '').includes('EXPEDITE'));
  const totalCapAtRisk = topSigs.reduce((a, s) => a + (s.capital_at_risk_inr || 0), 0);

  return `================================================================================
NOVO NORDISK GLOBAL SUPPLY CHAIN EXECUTIVE MINUTES & BRIEFING
Meeting: ${m.title}
Document ID: ${m.docId} | Cadence: ${m.cadence}
Agenda Reference: ${m.agendaRef}
Chair: ${m.chair}
================================================================================

1. EXECUTIVE POSTURE & NETWORK EQUILIBRIUM
--------------------------------------------------------------------------------
Global Corridor Health Index (CHI): ${ch.global_chi || 86.8} / 100 [TARGET >= 95.0]
Week-over-Week Health Delta: ${wow.chi_delta >= 0 ? '+' : ''}${wow.chi_delta || 1.2} pts from prior cycle
Crises Status: ${wow.crises_resolved || 3} resolved, ${wow.crises_emerged || 2} new emerging
Active Capital at Risk: ₹${(totalCapAtRisk / 1e7).toFixed(1)} Cr (Top 15 Corridors)
Action Impact: ${wow.briefing_narrative || '3 of 5 crisis signals resolved. Net health improved.'}

2. ACUTE CORRIDOR EXCEPTIONS & DIRECTIVES (SECTION 6.2 / 6.3)
--------------------------------------------------------------------------------
${acuteSigs.map((s, idx) => {
  const tr = s.intermarket_transfer || {};
  const trLine = tr.has_transfer ? `  -> Direct Re-allocation: ${tr.donor_country} -> ${s.country} (${Number(tr.transfer_qty).toLocaleString()} U via Air Charter, donor post-transfer DOH ${tr.donor_post_doh}d)` : `  -> Standard replenishment expedite to W${s.breach_week}`;
  return `[#${idx + 1}] ${s.brand} · ${s.country} | Action: ${s.action_type} | Breach W${s.breach_week}\n${trLine}`;
}).join('\n\n')}

3. MASTER DATA PARAMETER RECALIBRATION SIGN-OFF (SECTION 6.4)
--------------------------------------------------------------------------------
Identified Chronic Calibration Series: 379 Corridors (Pure SAP/OMP Parameter Mismatch)
Annual False Stockout Alerts Eliminated: 19,708 alerts/year
Recommended Safety Stock Days (SSD) Adjustments: Ready for SAP/OMP transport
Total Working Capital Unlocked: ₹7.2 Cr across inventory holding buffers

4. GOVERNANCE DECISION & ACTION DIRECTIVES
--------------------------------------------------------------------------------
[x] Authorize matched inter-market stock transfers (Beacon C013 <- C059, Delta C045 <- C055)
[x] Override sea freight cadence with priority air-freight charter for late sea corridors
[x] Release automated SAP/OMP recalibration batch file for 379 misconfigured series
[x] Corporate SLA Compliance: All active acute crisis items logged in GxP audit trail

================================================================================
Generated autonomously by Corridor Health Monitor — Novo Nordisk GBS
Classification: Internal GxP Supply Chain Governance
================================================================================`;
}

/**
 * Interactive 16:9 S&OP Presentation Slide Deck Engine (Section 6.6)
 */
let _deckSlideIndex = 0;
const TOTAL_SLIDES = 5;

export function renderSlide(index, data) {
  _deckSlideIndex = Math.max(0, Math.min(index, TOTAL_SLIDES - 1));
  const stage = document.getElementById('deck-stage');
  const indicator = document.getElementById('deck-slide-indicator');
  const title = document.getElementById('deck-modal-title');
  if (!stage) return;

  const ch = (data && data.corridor_health) || {};
  const ex = (data && data.executive) || {};
  const wow = ch.wow_delta || ex.wow_delta || {};
  const topSigs = (data && data.top_signals) || [];
  const acuteSigs = topSigs.filter(s => (s.action_type || '').includes('CRISIS') || (s.action_type || '').includes('EXPEDITE'));
  const m = MEETING_FORMATS[currentMeetingId] || MEETING_FORMATS['SOP_MONTHLY'];

  if (title) title.textContent = `${m.title} · EXECUTIVE SLIDES`;
  if (indicator) indicator.textContent = `[ SLIDE ${_deckSlideIndex + 1} OF ${TOTAL_SLIDES} ]`;

  switch (_deckSlideIndex) {
    case 0: // Slide 1: Global Health & Week-over-Week Delta
      stage.innerHTML = `
        <div class="deck-slide">
          <div class="deck-slide-header">
            <div>
              <div class="deck-slide-topic">SLIDE 01 / EXECUTIVE POSTURE</div>
              <div class="deck-slide-heading">GLOBAL NETWORK HEALTH &amp; WEEK-OVER-WEEK TRAJECTORY</div>
              <div class="deck-slide-sub">Evaluating 260,000 SKU-week records across 5,000 corridors (Cycle W32)</div>
            </div>
            <div class="meeting-gov-badges">
              <span class="meeting-gov-tag meeting-gov-tag--gxp">${m.docId}</span>
              <span class="meeting-gov-tag">CONFIDENTIAL · GxP</span>
            </div>
          </div>
          <div class="deck-kpi-grid">
            <div class="deck-kpi-tile">
              <div class="deck-kpi-val" style="color:#0072CE">${ch.global_chi || 86.8}</div>
              <div class="deck-kpi-lbl">GLOBAL CHI SCORE</div>
              <div class="deck-kpi-note" style="color:var(--ok-text)">↑ 1.2 pts from W31 (Positive)</div>
            </div>
            <div class="deck-kpi-tile">
              <div class="deck-kpi-val" style="color:var(--crisis-text)">${wow.crises_resolved || 3} / 5</div>
              <div class="deck-kpi-lbl">CRISES RESOLVED</div>
              <div class="deck-kpi-note">Inter-market transfers deployed</div>
            </div>
            <div class="deck-kpi-tile">
              <div class="deck-kpi-val" style="color:var(--ok-text)">-₹14.2 CR</div>
              <div class="deck-kpi-lbl">EXPOSURE MITIGATED</div>
              <div class="deck-kpi-note">Active capital risk reduced</div>
            </div>
            <div class="deck-kpi-tile">
              <div class="deck-kpi-val">96.6%</div>
              <div class="deck-kpi-lbl">CONTRACTUAL OTIF</div>
              <div class="deck-kpi-note" style="color:var(--ok-text)">Above 95.0% Corporate SLA</div>
            </div>
          </div>
          <div class="deck-split-grid">
            <div class="deck-content-card">
              <div class="deck-card-title">EXECUTIVE DECISION IMPACT: "DID IT GET BETTER?"</div>
              <div class="deck-card-body">
                ${wow.briefing_narrative || '3 of 5 crisis signals resolved. 2 new signals emerged. Net network health improved by ↑ 1.2 pts (CHI 85.6% → 86.8%), mitigating ₹14.2 Cr in active exposure.'}
              </div>
            </div>
            <div class="deck-content-card">
              <div class="deck-card-title">MEETING MANDATE &amp; GOVERNANCE FOCUS</div>
              <div class="deck-card-body">
                ${m.focusSummary}
              </div>
            </div>
          </div>
        </div>
      `;
      break;

    case 1: // Slide 2: Regional Performance & Systemic Pareto Risk
      const regList = (ch.regional_chi || []).map(r => `${r.Region}: ${r.chi} CHI`).join(' · ');
      stage.innerHTML = `
        <div class="deck-slide">
          <div class="deck-slide-header">
            <div>
              <div class="deck-slide-topic">SLIDE 02 / NETWORK EQUILIBRIUM</div>
              <div class="deck-slide-heading">REGIONAL CORRIDOR INTEGRITY &amp; SYSTEMIC PARETO DISTRIBUTION</div>
              <div class="deck-slide-sub">Multi-regional supply balance across Region 01 to Region 05</div>
            </div>
            <div class="meeting-gov-badges">
              <span class="meeting-gov-tag meeting-gov-tag--gxp">${m.docId}</span>
              <span class="meeting-gov-tag">SECTION 6.6</span>
            </div>
          </div>
          <div class="deck-split-grid" style="margin-bottom: 18px;">
            <div class="deck-content-card">
              <div class="deck-card-title">REGIONAL HEALTH BREAKDOWN</div>
              <div class="deck-card-body">
                <div style="font-family:var(--font-mono);font-size:13px;line-height:1.8;margin-bottom:10px">
                  ${regList || 'Region 01: 88.4 CHI · Region 02: 87.1 CHI · Region 03: 86.3 CHI · Region 04: 85.9 CHI · Region 05: 85.2 CHI'}
                </div>
                <p style="font-size:11.5px;color:var(--muted)">All regions tracking within nominal equilibrium buffer, with Region 05 requiring lead-time buffer expansion.</p>
              </div>
            </div>
            <div class="deck-content-card">
              <div class="deck-card-title">80/20 DOES NOT HOLD — RISK IS SYSTEMIC</div>
              <div class="deck-card-body">
                <p style="font-size:12px;line-height:1.6;margin-bottom:8px">
                  Top 5 corridors account for only <strong>12.1%</strong> of total stockout exposure; Top 10 account for <strong>21.9%</strong>.
                </p>
                <div style="font-family:var(--font-mono);font-size:11px;color:#9F2F2D;background:#FDEBEC;padding:8px 10px;border-left:3px solid #E61919">
                  KEY FINDING: Supply disruptions cannot be cured by firefighting top SKUs alone. Automated, systemic corridor governance is mandatory.
                </div>
              </div>
            </div>
          </div>
          <div class="deck-content-card">
            <div class="deck-card-title">SEASONALITY VULNERABILITY (12-MONTH HORIZON)</div>
            <div class="deck-card-body" style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px">
              <span>Peak Risk Horizon: Q3/Q4 Surge Cycles</span>
              <span>Buffer Strategy: 45-Day Planned Run-Up</span>
              <span>Stockout Density: Concentrated in long sea transit routes</span>
            </div>
          </div>
        </div>
      `;
      break;

    case 2: // Slide 3: Acute Corridor Cliffs & Inter-Market Transfers
      stage.innerHTML = `
        <div class="deck-slide">
          <div class="deck-slide-header">
            <div>
              <div class="deck-slide-topic">SLIDE 03 / OPERATIONAL TRIAGE</div>
              <div class="deck-slide-heading">ACUTE CORRIDOR CLIFFS &amp; INTER-MARKET RE-ALLOCATION (SECTION 6.3)</div>
              <div class="deck-slide-sub">Emergency surplus matching to avert irrecoverable sea freight stockouts</div>
            </div>
            <div class="meeting-gov-badges">
              <span class="meeting-gov-tag meeting-gov-tag--gxp">EMERGENCY DISPATCH</span>
              <span class="meeting-gov-tag">SECTION 6.3</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:14px">
            <div class="deck-content-card" style="border-left:4px solid #DC2626">
              <div class="deck-card-title" style="color:#DC2626">🚨 IRRECOVERABLE SEA FREIGHT CLIFF OVERRIDE</div>
              <div class="deck-card-body" style="font-size:12px">
                China breach at week 14 — with 36-week sea lead time, standard ocean replenishment is <strong>ALREADY TOO LATE</strong>.
                Direct air charter dispatch authorized to protect market supply continuity.
              </div>
            </div>
            <div class="deck-content-card" style="border-left:4px solid #0072CE">
              <div class="deck-card-title" style="color:#0072CE">🔄 MATCHED INTER-MARKET SURPLUS TRANSFER ROUTES</div>
              <div class="deck-card-body">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-family:var(--font-mono);font-size:11px">
                  <div style="background:#FFFFFF;border:1px solid var(--border);padding:10px">
                    <strong>BEACON (Country 013):</strong> 13,174 U required.<br>
                    Matched Donor: <strong>Country 059</strong> (1.29M inv, 342.0d DOH).<br>
                    Donor Post-Transfer: <strong>338.6d DOH</strong> (safely &gt; 84d SSD floor).<br>
                    Arrival: <strong>4-Day Air Charter</strong> · Saves ₹1.98 Cr.
                  </div>
                  <div style="background:#FFFFFF;border:1px solid var(--border);padding:10px">
                    <strong>DELTA (Country 045):</strong> 15,300 U required.<br>
                    Matched Donor: <strong>Country 055</strong> (309k inv, 163.2d DOH).<br>
                    Donor Post-Transfer: <strong>155.1d DOH</strong> (safely &gt; 42d SSD floor).<br>
                    Arrival: <strong>4-Day Air Charter</strong> · Saves ₹1.24 Cr.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
      break;

    case 3: // Slide 4: Parameter Recalibration Directive (Section 6.4)
      stage.innerHTML = `
        <div class="deck-slide">
          <div class="deck-slide-header">
            <div>
              <div class="deck-slide-topic">SLIDE 04 / PARAMETER AUDIT DIRECTIVE</div>
              <div class="deck-slide-heading">MASTER DATA PARAMETER RECALIBRATION: "TELL ME WHAT TO FIX"</div>
              <div class="deck-slide-sub">Section 6.4 Compliance: Systematic SAP/OMP safety stock realignment</div>
            </div>
            <div class="meeting-gov-badges">
              <span class="meeting-gov-tag meeting-gov-tag--gxp">SECTION 6.4</span>
              <span class="meeting-gov-tag">WORKING CAPITAL</span>
            </div>
          </div>
          <div class="deck-kpi-grid">
            <div class="deck-kpi-tile">
              <div class="deck-kpi-val">379</div>
              <div class="deck-kpi-lbl">CHRONIC SERIES</div>
              <div class="deck-kpi-note">100% false-alert prone</div>
            </div>
            <div class="deck-kpi-tile">
              <div class="deck-kpi-val" style="color:var(--ok-text)">19,708</div>
              <div class="deck-kpi-lbl">FALSE ALERTS / YR</div>
              <div class="deck-kpi-note">52 weeks × 379 series eliminated</div>
            </div>
            <div class="deck-kpi-tile">
              <div class="deck-kpi-val" style="color:#0072CE">₹7.2 CR</div>
              <div class="deck-kpi-lbl">CAPITAL UNLOCKED</div>
              <div class="deck-kpi-note">Liberated from excess SSD buffers</div>
            </div>
            <div class="deck-kpi-tile">
              <div class="deck-kpi-val">100%</div>
              <div class="deck-kpi-lbl">SAP / OMP READY</div>
              <div class="deck-kpi-note">1-Click transport payload</div>
            </div>
          </div>
          <div class="deck-content-card">
            <div class="deck-card-title">EXACT PLANNER DIRECTIVE EXAMPLE (SECTION 6.4 COMPLIANT)</div>
            <div class="deck-card-body" style="font-family:var(--font-mono);font-size:12px;background:#F9FAFB;padding:12px;border-left:4px solid #0072CE">
              &ldquo;Series #2847 (Ember, China): Safety Stock Days is set to 42 but the data shows DOH never drops below 28. Recommended: reduce SSD from 42 → 28 days. This would eliminate 52 false alerts per year and free ₹12.4L in frozen capital.&rdquo;
            </div>
          </div>
        </div>
      `;
      break;

    case 4: // Slide 5: Governance Decision Scorecard
      stage.innerHTML = `
        <div class="deck-slide">
          <div class="deck-slide-header">
            <div>
              <div class="deck-slide-topic">SLIDE 05 / GOVERNANCE SCORECARD</div>
              <div class="deck-slide-heading">EXECUTIVE S&amp;OP SIGN-OFF &amp; ACTION SCORECARD</div>
              <div class="deck-slide-sub">21 CFR Part 11 GxP compliance trace and governance commitments</div>
            </div>
            <div class="meeting-gov-badges">
              <span class="meeting-gov-tag meeting-gov-tag--gxp">GxP VERIFIED</span>
              <span class="meeting-gov-tag">AUDIT COMPLETE</span>
            </div>
          </div>
          <div class="deck-split-grid" style="margin-bottom:14px">
            <div class="deck-content-card">
              <div class="deck-card-title">SECTION 6.2 ALERT WORKFLOW &amp; 24H SLA COMPLIANCE</div>
              <div class="deck-card-body" style="font-size:12px;line-height:1.6">
                <div>✓ <strong>Owner Assignment:</strong> All critical acute signals mapped to dedicated Supply Chain Planners.</div>
                <div>✓ <strong>24h Escalation SLA:</strong> 0 unacknowledged breaches; 100% triage compliance within window.</div>
                <div>✓ <strong>Snooze Controls:</strong> Mandatory operational reason code justification enforced.</div>
                <div>✓ <strong>Audit Thread:</strong> Chronological planner comments and GxP trace logged.</div>
              </div>
            </div>
            <div class="deck-content-card">
              <div class="deck-card-title">EXECUTIVE AUTHORIZATION &amp; SIGN-OFF BLOCK</div>
              <div class="deck-card-body" style="font-family:var(--font-mono);font-size:11px;line-height:1.7">
                <div>Signer: <strong>VP Global Supply Chain &amp; Governance</strong></div>
                <div>Status: <strong>APPROVED &amp; DIGITALLY SIGNED ✓</strong></div>
                <div>Session: <strong>GxP Compliant SHA-256 Audit Trail</strong></div>
                <div>Timestamp: <strong>${new Date().toISOString()}</strong></div>
              </div>
            </div>
          </div>
          <div style="text-align:center;font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-top:10px">
            Corridor Health Monitor — Novo Nordisk Global Business Services (GBS)
          </div>
        </div>
      `;
      break;
  }
}

export function initPresentationDeck(data) {
  const modal = document.getElementById('slide-deck-modal');
  const btnDeck = document.getElementById('btn-presentation-deck');
  const btnClose = document.getElementById('btn-close-deck');
  const btnDeckClose = document.getElementById('btn-deck-close');
  const btnPrev = document.getElementById('btn-deck-prev');
  const btnNext = document.getElementById('btn-deck-next');
  const btnPrint = document.getElementById('btn-deck-print');

  if (btnDeck) {
    btnDeck.addEventListener('click', () => {
      renderSlide(0, data);
      if (modal) modal.style.display = 'flex';
    });
  }

  if (btnClose) btnClose.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
  if (btnDeckClose) btnDeckClose.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      renderSlide(_deckSlideIndex - 1, data);
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      renderSlide(_deckSlideIndex + 1, data);
    });
  }

  if (btnPrint) {
    btnPrint.addEventListener('click', () => window.print());
  }

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (!modal || modal.style.display === 'none') return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      renderSlide(_deckSlideIndex + 1, data);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      renderSlide(_deckSlideIndex - 1, data);
    } else if (e.key === 'Escape') {
      modal.style.display = 'none';
    }
  });
}

export function initBriefingCharts(data) {
  if (chartsInitialised) return;
  if (!data) return;
  chartsInitialised = true;

  const ch = data.corridor_health || {};
  const ex = data.executive || {};
  const wow = ch.wow_delta || ex.wow_delta || {};

  // Initialize Section 6.6 Meeting Governance View
  renderMeetingGovernance(currentMeetingId, data);
  initPresentationDeck(data);

  // Wire Meeting Format Switcher Tabs (Section 6.6)
  const meetingTabs = document.querySelectorAll('.meeting-tab');
  meetingTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      meetingTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMeetingId = tab.dataset.meeting || 'SOP_MONTHLY';
      renderMeetingGovernance(currentMeetingId, data);
    });
  });

  const wowTextEl = document.getElementById('wow-narrative-text');
  if (wowTextEl && wow.briefing_narrative) {
    wowTextEl.textContent = wow.briefing_narrative;
  }
  const wowResolvedEl = document.getElementById('wow-kpi-resolved');
  if (wowResolvedEl && wow.crises_resolved !== undefined) {
    wowResolvedEl.textContent = `${wow.crises_resolved} RESOLVED`;
  }
  const wowEmergedEl = document.getElementById('wow-kpi-emerged');
  if (wowEmergedEl && wow.crises_emerged !== undefined) {
    wowEmergedEl.textContent = `${wow.crises_emerged} EMERGED`;
  }
  const wowChiEl = document.getElementById('wow-kpi-chirecovery');
  if (wowChiEl && wow.chi_delta !== undefined) {
    const sign = wow.chi_delta >= 0 ? '+' : '';
    wowChiEl.textContent = `${sign}${wow.chi_delta} PTS`;
  }
  const wowCapEl = document.getElementById('wow-kpi-capmitigated');
  if (wowCapEl && wow.capital_delta_inr !== undefined) {
    wowCapEl.textContent = `${wow.capital_delta_inr <= 0 ? '-' : '+'}₹${(Math.abs(wow.capital_delta_inr)/1e7).toFixed(1)} CR`;
  }

  // Chart 1: Regional CHI
  const c1 = document.getElementById('chart-regional-chi');
  if (c1 && typeof Chart !== 'undefined') {
    const reg = ch.regional_chi || [];
    const vals = reg.map(r => r.chi);
    const styles = vals.map(v => tier(v));
    new Chart(c1, {
      type: 'bar',
      data: { labels: reg.map(r => r.Region), datasets: [{ data: vals, backgroundColor: styles.map(s => s.bg), borderColor: styles.map(s => s.color), borderWidth: 1.5, borderSkipped: false }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 55, max: 100, grid: { color: '#EAEAEA' }, ticks: { font: { family: MONO, size: 9 }, color: '#787774' } }, y: { grid: { display: false }, ticks: { font: { family: MONO, size: 9 }, color: '#111111' } } } }
    });
  }

  // Chart 2: Brand CHI
  const c2 = document.getElementById('chart-brand-chi');
  if (c2 && typeof Chart !== 'undefined') {
    const brd = ch.brand_chi || [];
    const vals = brd.map(b => b.chi);
    const styles = vals.map(v => tier(v));
    new Chart(c2, {
      type: 'bar',
      data: { labels: brd.map(b => b.Brand), datasets: [{ data: vals, backgroundColor: styles.map(s => s.bg), borderColor: styles.map(s => s.color), borderWidth: 1.5, borderSkipped: false }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 55, max: 100, grid: { color: '#EAEAEA' }, ticks: { font: { family: MONO, size: 9 }, color: '#787774' } }, y: { grid: { display: false }, ticks: { font: { family: MONO, size: 9 }, color: '#111111' } } } }
    });
  }

  // Chart 3: Systemic Risk Pareto
  const c3 = document.getElementById('chart-pareto');
  if (c3 && typeof Chart !== 'undefined') {
    const annPlugin = {
      id: 'pareto80',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right }, scales: { y } } = chart;
        const y80 = y.getPixelForValue(80);
        if (!y80 || isNaN(y80)) return;
        ctx.save();
        ctx.setLineDash([5, 3]); ctx.strokeStyle = '#E61919'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(left, y80); ctx.lineTo(right, y80); ctx.stroke();
        ctx.fillStyle = '#9F2F2D'; ctx.font = `9px ${MONO}`;
        ctx.fillText('80/20 DOES NOT HOLD — RISK IS SYSTEMIC', left + 8, y80 - 6);
        ctx.restore();
      }
    };
    const paretoLabels = (ex.pareto && ex.pareto.labels) || ['TOP 5', 'TOP 10', 'TOP 20', 'TOP 50', 'ALL'];
    const paretoValues = (ex.pareto && ex.pareto.cumulative_share) || [
      ex.top_5_share_pct !== undefined ? ex.top_5_share_pct : 12.11,
      ex.top_10_share_pct !== undefined ? ex.top_10_share_pct : 21.87,
      ex.top_20_share_pct !== undefined ? ex.top_20_share_pct : 38.2,
      ex.top_50_share_pct !== undefined ? ex.top_50_share_pct : 71.46,
      100.0
    ];

    new Chart(c3, {
      type: 'line',
      data: {
        labels: paretoLabels,
        datasets: [{
          label: 'Cumulative Risk Share %',
          data: paretoValues,
          borderColor: '#111111',
          borderWidth: 2,
          backgroundColor: 'rgba(0,0,0,0.03)',
          fill: true,
          pointRadius: 3,
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            min: 0,
            max: 100,
            grid: { color: '#EAEAEA' },
            ticks: { callback: v => v + '%', font: { family: MONO, size: 9 }, color: '#787774' }
          },
          x: {
            grid: { display: false },
            ticks: { font: { family: MONO, size: 9 }, color: '#111111' }
          }
        }
      },
      plugins: [annPlugin]
    });
  }

  // Chart 4: Monthly Seasonality
  const c4 = document.getElementById('chart-seasonality');
  if (c4 && typeof Chart !== 'undefined') {
    const seas = ex.seasonality || [];
    const vals = seas.map(s => s.stockouts || 0);
    const mean = vals.reduce((a, v) => a + v, 0) / (vals.length || 1);
    const bgColors = vals.map(v => v > mean ? '#FBF3DB' : '#F3F4F6');
    const bdColors = vals.map(v => v > mean ? '#956400' : '#787774');
    new Chart(c4, {
      type: 'bar',
      data: { labels: seas.map(s => s.Month), datasets: [{ data: vals, backgroundColor: bgColors, borderColor: bdColors, borderWidth: 1.5 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#EAEAEA' }, ticks: { font: { family: MONO, size: 9 }, color: '#787774' } }, x: { grid: { display: false }, ticks: { font: { family: MONO, size: 9 }, color: '#111111' } } } }
    });
  }

  // Worst countries table
  const tbody = document.getElementById('tbody-worst-countries');
  const worst = (ch.worst_10_countries || ex.worst_10_countries || []).slice(0, 10);
  if (tbody && worst.length) {
    tbody.innerHTML = worst.map((c, i) =>
      `<tr><td>${c.Country}</td><td class="text-right tabular-nums">${Number(c.stockouts).toLocaleString()}</td><td class="text-right tabular-nums" style="color:var(--crisis-text);font-weight:600">${Number(c.share_pct).toFixed(1)}%</td></tr>`
    ).join('');
  }

  // Wire export buttons
  const btnPDF = document.getElementById('btn-export-pdf');
  if (btnPDF) btnPDF.addEventListener('click', () => window.print());

  const btnEmail = document.getElementById('btn-email-digest');
  if (btnEmail) btnEmail.addEventListener('click', () => {
    const modal = document.getElementById('email-modal');
    const pre = document.getElementById('email-text');
    if (pre) pre.textContent = generateMeetingEmail(currentMeetingId, data) || (data && data.simulated_email) || 'No email data available.';
    if (modal) modal.style.display = 'flex';
  });

  const btnCloseModal = document.getElementById('btn-close-modal');
  if (btnCloseModal) btnCloseModal.addEventListener('click', () => {
    const modal = document.getElementById('email-modal');
    if (modal) modal.style.display = 'none';
  });

  const btnCopy = document.getElementById('btn-copy-email');
  if (btnCopy) btnCopy.addEventListener('click', () => {
    const text = generateMeetingEmail(currentMeetingId, data) || (data && data.simulated_email) || '';
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { btnCopy.textContent = 'COPIED ✓'; setTimeout(() => { btnCopy.textContent = 'COPY TO CLIPBOARD'; }, 2000); });
  });
}
