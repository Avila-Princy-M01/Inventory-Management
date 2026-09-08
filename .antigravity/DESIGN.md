# Design System: Corridor Health Monitor (CHM)
Novo Nordisk Global Business Services (GBS) — Supply Chain Telemetry

## 1. Visual Theme & Atmosphere
- **Archetype:** Swiss Industrial Print (Light).
- **Density:** 6 (Cockpit Balanced — high telemetry clarity, macro-whitespace between functional compartments).
- **Variance:** 5 (Offset Asymmetric — hero exception prominence, rigid blueprint alignment).
- **Motion:** 3 (Static Restrained — micro-transitions on interactive controls, stagger reveals for data rows, hardware-accelerated transforms only, zero decorative bobbing).
- **Aesthetic Definition:** Unbleached technical documentation substrate (`#F4F4F0`), razor-sharp carbon ink (`#111111`), 1px visible compartment borders (`#D0CEC9`), and aviation hazard red (`#E61919`) strictly reserved for acute crises. Complete elimination of gradients, drop shadows, rounded pills, and decorative color fills.

## 2. Color Palette & Roles (16 Core Semantic Tokens + Declared Derived Ramp = 23 Tokens Total)

### 2.1 Core Semantic Tokens (16 Tokens in `:root`)
| Token | Hex / Value | Semantic Role |
| :--- | :--- | :--- |
| `--bg` | `#F4F4F0` | Unbleached matte technical paper substrate |
| `--surface` | `#FFFFFF` | Primary compartment & card surface |
| `--surface-subtle` | `#ECEAE5` | Muted compartment fill & tabular alternating background |
| `--border` | `#D0CEC9` | Structural 1px blueprint grid border |
| `--border-light` | `#EAEAEA` | Faint secondary internal divider |
| `--ink` | `#111111` | Carbon ink for primary typography, titles, and active boundaries |
| `--text-muted` | `#666666` | Technical descriptions, unit codes, secondary telemetry |
| `--hazard-red` | `#E61919` | Aviation hazard red — ONLY for genuine active crisis breach and hard stop alerts |
| `--status-crisis-bg` | `#FDEBEC` | Pale red background for acute crisis status tags |
| `--status-crisis-text` | `#9F2F2D` | Crisis label text (calibrated WCAG AA contrast) |
| `--status-warn-bg` | `#FBF3DB` | Pale amber background for warning thresholds and lead-time cliffs |
| `--status-warn-text` | `#956400` | Warning label text |
| `--status-ok-bg` | `#EDF3EC` | Pale green background for nominal certified buffers |
| `--status-ok-text` | `#346538` | Certified nominal label text |
| `--status-neutral-bg`| `#EAE8E3` | Greyscale functional background (EXCESS, CHANGED, SNOOZED, APPROVED, AI badge) |
| `--status-neutral-text`| `#333333` | Greyscale functional text |

### 2.2 Declared Derived Ramp & Chart Tokens (7 Tokens)
| Token | Hex / Value | Semantic Role |
| :--- | :--- | :--- |
| `--matrix-1` | `#EDF3EC` | Scenario CHI heatmap level 1 (Nominal / High health) |
| `--matrix-2` | `#F7F7F2` | Scenario CHI heatmap level 2 (Moderate health) |
| `--matrix-3` | `#FBF3DB` | Scenario CHI heatmap level 3 (Threshold advisory) |
| `--matrix-4` | `#FED7AA` | Scenario CHI heatmap level 4 (Severe buffer compression) |
| `--matrix-5` | `#FDEBEC` | Scenario CHI heatmap level 5 (Acute crisis / sea freight cliff) |
| `--chart-grid` | `#EAEAEA` | Chart.js Cartesian gridlines & radial axes |
| `--chart-ink` | `#111111` | Chart.js primary series stroke & axis typography |

## 3. Typographic Architecture
- **Display / Structural UI:** `Outfit`, `-apple-system`, `BlinkMacSystemFont`, `sans-serif`. Tracked tight (`-0.02em`), uppercase for operational labels, high-contrast weight (600/700).
- **Body:** `Outfit`, `sans-serif` (`line-height: 1.5`, **`13px` base font size** for high-clarity room projection).
- **Monospace & Telemetry:** `JetBrains Mono`, `SF Mono`, `monospace`. Applied to EVERY numerical readout, SKU, currency, percentage, lead-time week, and audit timestamp. Always `font-variant-numeric: tabular-nums`.
- **Viewport Limit:** Maximum 3 distinct font sizes visible in any single viewport (View Title `20px`, Primary Metric `28px`, Tabular/Body `13px` / `11px mono`).
- **Absolute Bans:** `Inter` is completely eliminated. Generic serifs are forbidden in this technical dashboard.

## 4. Component Behaviors & Invariants
- **Geometry & Border-Radius Rule:**
  - `border-radius: 0` on base and component layer. Rectangular 90° corners for buttons, cards, containers, tags, drawers, and dialogs.
  - Brutalist rectangular tags win over pill shapes.
  - **Documented Exception:** Circular CHI dial (`.chi-dial`, `border-radius: 50%`) and circular status indicators (`.live-dot`, `border-radius: 50%`). Global `!important` on `border-radius` is strictly prohibited.
- **Compartmentalization:** Distinct zones demarcated with `1px solid var(--border)`. No soft box-shadows.
- **Buttons:**
  - Primary Action: Solid carbon ink (`#111111`), text `#FFFFFF`, 0 border-radius. Active state: `-1px` transform.
  - Secondary Action: Ghost outline `1px solid var(--border)`, background `var(--surface)`, text `var(--ink)`.
  - Hazard Action: Solid or outlined in `var(--hazard-red)` strictly for crisis escalation.
- **Loaders:** CSS skeleton pulse matching compartment dimensions (`var(--surface-subtle)` to `var(--border-light)`). No circular spinners.
- **Inline Style Policy:**
  - Initial `display` state attributes (`style="display:none;"`) are application state and **exempt**.
  - All 103 cosmetic inline styles (colors, fonts, borders, margins, paddings) are removed and replaced by CSS classes.
- **Emoji Scope Policy:**
  - Rendered DOM emoji count must equal 0. Replaced with inline SVGs or ASCII markers (`[ ]`, `>>>`, `+`, `///`, `■`, `▲`, `▼`).
  - Export payloads (email bodies in `simulated_email`, CSV export columns, and GxP signature text strings in data layers) are preserved data.

## 5. Persistent Chrome & View Focal Points

| Region | Primary Focal Point | Demoted / Progressive Elements |
| :--- | :--- | :--- |
| **Persistent Chrome (Header, Nav, KPI)** | **CHI Dial (`#chi-value`)** — prominent hero readout | Active Crises, Capital at Risk, and OTIF demoted to small mono text on a single baseline. Nav items stripped of decorative icons, displaying clean technical indexing (`00`, `01`, `02`, `03`, `04`). |
| **Ingest (`view-ingest`)** | **The Dropzone (`#main-dropzone`)** | Enterprise architecture notes recede into blueprint footnotes below. |
| **Signals (`view-signals`)** | **Ranked Exception Queue** — #1 PRS signal rendered as high-contrast hero row | Secondary signals recede. 7 filter pills collapsed into 5-button segmented control + "More filters". Secondary batch actions in overflow menu. |
| **Briefing (`view-briefing`)** | **Single Headline Risk Statement + 1 Primary Chart** | Deep-dive charts in tabs or scroll-reveal; governance dossiers, meeting minutes, and slides accessed via discrete entry points. |
| **Master Data (`view-masterdata`)** | **Recalibration Queue Table** | Planner directives cleanly anchored directly above grid. |
| **Audit (`view-audit`)** | **GxP Signature Ledger** | High-density monospace tabular telemetry with 21 CFR Part 11 certification stamp. |
