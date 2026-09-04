# Pharma Corridor Monitor — Novo Nordisk GBS Hackathon 2026

> **Problem Statement 5**: Inventory Corridor Health Check Monitoring & Predictive Stock-Out Signal Capturing  
> **Target Audience**: Supply Chain Planners, GBS Executives, GxP Quality Assurance, Inventory Controllers

---

## ⚡ Quick Start Guide (Run Locally in 60 Seconds)

### 1. Prerequisites & Dependencies
Ensure Python 3.10+ is installed on your system. Install the required Python packages:

```bash
pip install flask openpyxl pandas pyarrow
```

### 2. Start the Development Server
From the repository root or backend directory:

```bash
cd cipher-corridor-monitor/backend
python server.py
```

*Alternative from project root:*
```bash
python cipher-corridor-monitor/backend/server.py
```

### 3. Open in Browser
Navigate to:
```
http://localhost:8000
```

---

## 🚀 Application Workflow

1. **View 00 — Ingestion Landing Page**:
   - **Drag & Drop**: Upload any `.xlsx` supply chain workbook containing an `Export` tab.
   - **1-Click Hackathon Benchmark**: Click `[ ⚡ LOAD HACKATHON BENCHMARK ]` for instant zero-wait startup using the pre-processed 260,000 SKU-week baseline dataset.
   - **Telemetry Stepper**: Watch the real-time 5-stage mechanical progress indicator as the analytical pipeline processes and scores signals.
2. **View 01 — Signal Console**:
   - Real-time KPI banner: Global Corridor Health Index (CHI), Active Crisis Count, At-Risk Inventory Value ($), and Dynamic OTIF Fulfillment Rate vs Contractual 95.0% SLA Target.
   - Top 15 Critical Signals ranked by Priority Risk Score (PRS) with normalized action badges.
   - Click any card to inspect the **52-Week Interactive Corridor Trajectory Drawer**.
   - Click `[ ⚙ SCENARIO SANDBOX ]` to run interactive what-if simulations altering lead time (1–12 weeks) and safety stock ceiling multipliers (1.1×–3.0×).
3. **View 02 — Executive Briefing**:
   - 4 Chart.js analytical charts: Root-Cause Pareto (80/20 systemic rule), Brand Fragility, Regional Risk Concentration, and 52-Week Seasonality Heatmap.
   - Systemic calibration insights, simulated GxP executive broadcast email modal, and print-ready one-click executive PDF report.
4. **View 03 — Master Data Governance**:
   - Complete inventory master dataset of 379 chronic calibration series with DOH/SSD ratio color codes and CSV export for SAP/OMP.
5. **View 04 — GxP Audit Trail**:
   - 21 CFR Part 11 compliant immutable action log with reason codes, cryptographic session signatures, and audit export.

---

## 🏗 System Architecture

```
d:\novo\
├── corridor_pipeline.py            # Reproducible data pipeline (ETL, recursion, breach detection)
├── corridor_panel.parquet          # Tidy panel: 260,000 rows (5,000 series × 52 weeks)
├── corridor_findings.json          # Machine-readable analytical findings & metrics
├── Inventry_Corridor_Alert_...xlsx # Source Excel dataset
└── cipher-corridor-monitor/
    ├── backend/
    │   ├── server.py               # Flask development server & REST API
    │   ├── generate_dashboard_data.py # 5-layer dashboard data scoring pipeline
    │   ├── dashboard_data.json     # Pre-calculated benchmark dataset
    │   ├── brand_price_master.json # Standard unit pricing per brand
    │   └── test_generate_dashboard_data.py # Pytest backend verification suite (25 tests)
    └── frontend/
        ├── index.html              # Single Page Application entry point (all 5 views)
        └── src/
            ├── style.css           # Design system tokens (Swiss industrial print)
            ├── main.js             # View router, KPI counter, global audit store
            ├── signals.js          # Signal card renderer & badge normalizer
            ├── drawer-detail.js    # Chart.js 52W corridor chart & approval workflow
            ├── drawer-scenario.js  # Live scenario simulation & CHI matrix lookup
            ├── briefing.js         # Executive charts, PDF print, email modal
            ├── masterdata.js       # 379 chronic series master table & CSV export
            ├── audit.js            # Immutable GxP audit log & CSV export
            └── uploader.js         # File drag-and-drop & 5-stage mechanical stepper
```

### Zero Cloud / Local-Only Processing
- **No Supabase or External Cloud Needed**: All analytical computations run 100% locally on your machine via Python and Flask.
- **Bi-Directional Path Resolution**: `server.py` and `generate_dashboard_data.py` resolve scripts, parquet caches, and findings across both `d:\novo\` and `backend/` automatically.

---

## 🎨 Design System Philosophy

Synthesized across three specialized design standards:
- **`industrial-brutalist-ui`**: Swiss Industrial Print archetype, `#F4F4F0` newsprint canvas, `#111111` high-contrast carbon ink, `#E61919` aviation alert red for critical items, rigid modular grids, zero border-radius.
- **`minimalist-ui`**: Bone canvas, pure white `#FFFFFF` cards, muted pastels (`#FDEBEC`, `#FBF3DB`, `#EDF3EC`), micro-interactions with tactile `:active` push feedback (`scale(0.98)`).
- **`stitch-design-taste`**: Monospace `JetBrains Mono` telemetry, tabular numerical alignment (`font-variant-numeric: tabular-nums`), hardware-accelerated animations (`transform`, `opacity` only).

---

## 🧪 Testing & Validation Suite

Run any of the automated test suites from `d:\novo\cipher-corridor-monitor`:

```powershell
# 1. Backend Pytest Suite (25 / 25 passed)
python -m pytest backend/test_generate_dashboard_data.py -v

# 2. Frontend Spec Property & Invariant Tests (10 / 10 passed)
node test_frontend.js

# 3. Specification Invariant Suite (74 / 74 passed)
node check_spec.js

# 4. Backend Structural Assertions
python backend/verify.py

# 5. Upload Error Endpoint Validation
python C:/Users/PC/.gemini/antigravity-ide/brain/d63df20f-c2d8-42b9-bbe7-53f5c323aef1/scratch/test_upload_endpoints.py
```

---

## 📋 API Endpoints Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/` | `GET` | Serves frontend Single Page Application (`frontend/index.html`) |
| `/dashboard_data.json` | `GET` | Returns active 5-layer dashboard dataset |
| `/load-demo` | `POST` / `GET` | Loads or generates benchmark dataset instantly |
| `/upload` | `POST` | Uploads `.xlsx` multipart workbook, triggers pipeline rebuild, returns updated dataset |

---

## 👥 Hackathon Team & Acknowledgements
- **Novo Nordisk GBS Hackathon 2026** — Supply Chain Analytics Division
- Built strictly adhering to specifications in `.kiro/specs/pharma-corridor-monitor-frontend/`
