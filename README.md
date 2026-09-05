# 🌐 Corridor Health Monitor (CIPHER)
### Novo Nordisk Global Business Services (GBS) — Hackathon 2026
> **Problem Statement 5**: Inventory Corridor Health Check Monitoring & Predictive Stock-Out Signal Capturing  
> **Enterprise Classification**: Internal GxP Governance · 21 CFR Part 11 Electronic Records Compliant  
> **Target Audience**: Global Supply Chain Leadership (Ashish & Ravi), Regional Planners, Inventory Controllers, and GxP Quality Assurance

---

## Executive Overview & Core Value Proposition

Modern pharmaceutical supply networks face severe friction when global ERP/OMP systems generate thousands of false stock-out alarms, diluting planner focus and triggering unnecessary, costly ocean air freight overrides.

**Corridor Health Monitor (Team CIPHER)** is an autonomous, multi-tier decision-intelligence system engineered on **260,000 SKU-week records** across **5,000 global corridors**. It completely replaces static threshold-based alerting with:

1. **Global Corridor Health Index (CHI™)**: A mathematically rigorous network-equilibrium metric (0–100) aggregating weekly stockout penalties, lead-time cliffs, and ceiling multipliers.
2. **Priority Risk Score (PRS™)**: Dynamic signal ranking that elevates true acute crises (Week 1–4 breaches) while eliminating false alerts caused by misconfigured safety parameters.
3. **Autonomous Monday 08:00 AM AI Supply Directive**: Synthesizes weekly network shifts, calculates lifelong chronic diabetes patient churn risk, and generates the **Top 3 Mandatory Leadership Decisions** required before 12:00 PM.
4. **Inter-Market Stock Re-Allocation**: Intelligent donor-recipient pairing that solves imminent deep-sea ocean stockouts via emergency air charters without compromising donor market safety floors (>45 days DOH).
5. **Master Data Parameter Recalibration**: Identifies chronic calibration series with frozen Safety Stock Days (SSD), liberating **₹1,498.7 Cr** in trapped working capital.

---

## ⚡ Quick Start Guide (Run Locally in 60 Seconds)

### 1. Prerequisites & Dependencies
Ensure **Python 3.10+** and **Node.js 18+** are installed. Install Python requirements:

```bash
pip install -r requirements.txt
```

### 2. Start the Application Server
Run the Flask server from the repository root:

```bash
python cipher-corridor-monitor/backend/server.py
```

*Or from inside the application directory:*
```bash
cd cipher-corridor-monitor
python backend/server.py
```

### 3. Open in Browser
Navigate to your local browser:
```
http://localhost:8000
```

---

## 🖥 Application Architecture & Workflow

The platform operates as a cohesive, single-page executive decision cockpit structured across five dedicated operational views:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                      CIPHER CORRIDOR HEALTH MONITOR                              │
├──────────────┬───────────────────┬───────────────────┬─────────────┬─────────────┤
│   VIEW 00    │      VIEW 01      │      VIEW 02      │   VIEW 03   │   VIEW 04   │
│  Ingestion   │  Strategic Signal │ Executive Monday  │ Master Data │  GxP Audit  │
│  & Benchmark │      Console      │     Briefing      │ Governance  │    Trail    │
└──────────────┴───────────────────┴───────────────────┴─────────────┴─────────────┘
```

### View 00 — Ingestion Landing Page
- **Drag & Drop Upload**: Ingest any `.xlsx` supply chain workbook with an `Export` tab.
- **1-Click Hackathon Benchmark**: Click `[ ⚡ LOAD HACKATHON BENCHMARK ]` for zero-wait startup pre-loaded with the 260,000 SKU-week baseline.
- **5-Stage Mechanical Stepper**: Real-time progress telemetry tracking file validation, recursion evaluation, WSP calculation, PRS ranking, and CHI matrix compilation.

### View 01 — Strategic Signal Console
- **Real-Time KPI Banner**: Global CHI (86.8%), Active Crises count, Capital at Risk (₹ Cr), and Contractual OTIF Fulfillment Rate (98.5% vs 95.0% target).
- **Ranked Exception Queue**: Top 15 critical signals prioritized by PRS score with 5-key contract badges (`ACTIVE CRISIS`, `EMERGENCY EXPEDITE`, `STANDARD PO`, `EXCESS HOLDING`, `ADVISORY`).
- **Interactive Corridor Trajectory Drawer**: Click any card to inspect 52-week stock vs safety floor trajectories, breach annotations, recovery horizons, and root-cause breakdowns.
- **Scenario Modeller Sandbox**: Live simulation varying lead times (1–12 weeks) and safety stock ceiling multipliers (1.1×–3.0×) with real-time CHI matrix recomputation.

### View 02 — Executive Monday Briefing
- **Multi-Agent AI Executive Synthesis**: 60-second summary detailing week-over-week health deltas, resolved vs emerged crisis corridors, and chronic patient therapy exposure.
- **Emergency Action Visuals**:
  - *Acute Corridor Capital at Risk Bar Chart*: Ranked financial exposure (₹ Cr) across critical corridors.
  - *Maritime Cliff vs Air Charter Latency*: Evaluates China's 36-week Pacific ocean transit against emergency 4-day air transfers.
  - *Systemic Risk Pareto*: Mathematically proves risk is systemic (Top 5 corridors drive only 12.1% of exposure — 80/20 does not hold).
- **Meeting Governance Dossier**: Agenda formats, document IDs (`NN-GSC-SOP-2026-M09`), and executive minutes for S&OP Monthly, Weekly Tier-3 S&OE, and Emergency Triage.
- **5-Slide Executive Deck**: Built-in modal presentation deck ready for executive review.
- **Email Digest & Live Dispatch**: Tabbed modal featuring **Rich AI Executive View** with one-click live dispatch to planners via TLS SMTP.

### View 03 — Master Data Governance
- **379 Chronic Calibration Corridors**: Isolates corridors suffering 100% false-alarm rates due to static safety stock settings.
- **Stale Parameter Detection**: Filters 164 corridors where demand shifted ≥30% while SSD remained frozen in SAP/OMP.
- **Capital Liberation**: Highlights ₹14.9 Cr in holding buffer savings and provides instant CSV export formatted for SAP/OMP transport.

### View 04 — GxP Audit Trail
- **21 CFR Part 11 Compliance**: Immutable ledger recording planner approvals, electronic signatures, timestamps, reason codes, and SHA-256 session IDs.
- **Audit Export**: Single-click export of `gxp-audit-log.csv` for regulatory inspection.

---

## 📁 Repository Directory Structure

```
.
├── Inventry_Corridor_Alert_Weekly_Aug2026_Jul2027.xlsx # Source Excel dataset
├── corridor_pipeline.py                                # Core data recursion & ETL pipeline
├── corridor_panel.parquet                              # Tidy parquet: 260,000 rows × 26 columns
├── corridor_findings.json                              # Machine-readable analytical metrics
├── dashboard_data.json                                 # Pre-compiled benchmark dashboard payload
├── requirements.txt                                    # Root Python dependencies
├── README.md                                           # Master documentation
└── cipher-corridor-monitor/
    ├── .env.example                                    # Environment & SMTP configuration template
    ├── requirements.txt                                # Application dependencies
    ├── test_frontend.js                                # Frontend property & invariant test suite
    ├── check_spec.js                                   # Specification compliance checker (74 tests)
    ├── backend/
    │   ├── server.py                                   # Flask application server & REST APIs
    │   ├── email_service.py                            # Autonomous Monday 08:00 AM dispatch & SMTP
    │   ├── generate_dashboard_data.py                  # 5-layer scoring & WSP computation engine
    │   ├── dashboard_data.json                         # Backend synced dashboard data
    │   ├── brand_price_master.json                     # Standard pricing per unit across 5 brands
    │   └── test_generate_dashboard_data.py             # Pytest backend validation suite (37 tests)
    └── frontend/
        ├── index.html                                  # Single Page Application HTML5 markup
        └── src/
            ├── style.css                               # Swiss industrial print design tokens
            ├── main.js                                 # View routing, live KPI counters, audit bus
            ├── signals.js                              # Signal card rendering & badge normalizer
            ├── drawer-detail.js                        # 52-week trajectory drawer & Chart.js graph
            ├── drawer-scenario.js                      # What-if scenario modeller & CHI lookup
            ├── briefing.js                             # Executive briefing, charts, slides & email
            ├── masterdata.js                           # Master data table & SAP/OMP CSV exporter
            ├── audit.js                                # GxP audit trail table & CSV exporter
            ├── uploader.js                             # Excel drag-and-drop & mechanical stepper
            └── workflow.js                             # 24-hour SLA countdown & owner assignment
```

---

## 🧪 Comprehensive Verification & Test Suite

The system includes automated unit, property, and specification test suites covering every layer of the application:

```bash
# 1. Backend Pytest Suite (37 / 37 passed)
python -m pytest cipher-corridor-monitor/backend/test_generate_dashboard_data.py -v

# 2. Frontend Property & Invariant Test Suite (28 / 28 passed)
node cipher-corridor-monitor/test_frontend.js

# 3. Specification Compliance Audit (74 / 74 checks passed)
node cipher-corridor-monitor/check_spec.js
```

### Validation Highlights:
- **Badge Contract Invariant**: 500 randomized tests verifying action types resolve strictly to the 5 normalized keys.
- **CHI Matrix Lookup**: 500 combinations verifying bilinear interpolation and monotonic consistency across lead times and ceiling multipliers.
- **Inter-Market Transfer Safe Floor**: Verifies donor markets retain >45 days DOH post-transfer.
- **Meeting Formats & Minutes**: Asserts full document governance structure (`NN-GSC-SOP-2026-M09`) across all agenda formats.

---

## 📬 Live Email Dispatch & Automated Monday Scheduler

The application includes an enterprise-ready background scheduling engine in `backend/email_service.py`:

- **Autonomous Monday 08:00 AM Dispatch**: Automatically computes the exact timedelta to next Monday 08:00 CET and triggers the executive briefing to regional planners.
- **Live SMTP Transmission**: Built-in TLS SMTP support for Gmail, Microsoft 365, SendGrid, and corporate relays.
- **Configuration**: Copy `.env.example` to `.env` in `cipher-corridor-monitor/` and supply credentials:
  ```env
  SMTP_HOST=smtp.gmail.com
  SMTP_PORT=587
  SMTP_TLS=true
  SMTP_USER=your_email@gmail.com
  SMTP_PASS=your_app_password
  SMTP_FROM="Novo Nordisk Supply Chain AI <your_email@gmail.com>"
  DIGEST_RECIPIENTS=ravi.planner@novonordisk.com,ashish.supplychain@novonordisk.com
  ```

---

## 🎨 Design System Philosophy

The visual interface is crafted in accordance with high-end editorial and industrial software aesthetics:
- **Swiss Industrial Print Archetype**: Off-white `#F4F4F0` newsprint background, `#111111` deep carbon typography, `#0072CE` Novo Nordisk blue accents, and `#DC2626` aviation alert red for critical items.
- **Typography**: Dual-font hierarchy pairing modern geometric headings (`Outfit`) with dense tabular telemetry in `JetBrains Mono`.
- **Zero Generic Slop**: Flat, high-density information layout with micro-interactions, tactile `:active` state depression, and strict tabular numeric alignment (`font-variant-numeric: tabular-nums`).

---

## 👥 Hackathon Team CIPHER
- **Novo Nordisk GBS Hackathon 2026** — Supply Chain Analytics & Digital Innovation
- Developed in full alignment with the Novo Nordisk problem statement brief and GxP standards.
