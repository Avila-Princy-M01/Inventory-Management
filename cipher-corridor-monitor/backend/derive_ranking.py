"""
derive_ranking.py — Team Cipher ranking validation (one-shot, reproducible).

Builds breach-episode features known AT EPISODE START, labels maturation into
physical stock-out, derives a direction-aware explainable ensemble, and
time-split-validates it (train: episodes starting weeks 1-40, test: 41-52).

Outputs: breach_episodes.parquet, episode_features.parquet, ranking_weights.json
Run:     python derive_ranking.py   (from cipher-corridor-monitor/backend/)
"""
import json

import numpy as np
import pandas as pd

# ── 1. Panel + episodes ──────────────────────────────────────────────────
df = pd.read_parquet("corridor_panel.parquet").sort_values(["row_id", "week_seq"])

d = df["breach"] != df.groupby("row_id")["breach"].shift()
df["ep"] = d.groupby(df["row_id"]).cumsum()
eps = (
    df[df["breach"]]
    .groupby(["row_id", "ep"])
    .agg(start=("week_seq", "min"), end=("week_seq", "max"))
    .reset_index()
)

first_out = df[df["is_out"]].groupby("row_id")["week_seq"].min().to_dict()
eps["matured"] = eps.apply(
    lambda r: r.row_id in first_out and first_out[r.row_id] <= r.end + 12, axis=1
)
eps["prior_episodes"] = eps.groupby("row_id").cumcount()

# ── 2. Features known at episode start ───────────────────────────────────
g = df.groupby("row_id")
rows = []
for r in eps.itertuples():
    s = r.start
    grp = g.get_group(r.row_id)
    w0 = grp[grp.week_seq == s]
    if w0.empty:
        continue
    w0 = w0.iloc[0]
    doh = w0["Days On Hands (in days)"]
    ssd = w0["Safety Stock Days"]
    dem_now = w0["Demand For Week"]
    past = grp[(grp.week_seq >= s - 4) & (grp.week_seq < s)]
    dem_past = past["Demand For Week"].mean() if len(past) else dem_now
    sup_past = past["Total Supply"].mean() if len(past) else w0["Total Supply"]
    rows.append(
        {
            "row_id": r.row_id,
            "ep": r.ep,
            "start": s,
            "end": r.end,
            "matured": bool(r.matured),
            "coverage": (doh / ssd) if ssd > 0 else 99.0,
            "demand_surge": (dem_now / dem_past) if dem_past > 0 else 1.0,
            "supply_drop": ((sup_past - w0["Total Supply"]) / sup_past) if sup_past > 0 else 0.0,
            "unconfirmed_share": (w0["Unconfirmed Orders"] / w0["Total Supply"]) if w0["Total Supply"] > 0 else 0.0,
            "dem_cv": (past["Demand For Week"].std() / max(dem_past, 1.0)) if len(past) > 2 else 0.0,
            "prior_episodes": int(r.prior_episodes),
        }
    )
F = pd.DataFrame(rows)
F.to_parquet("episode_features.parquet")

# ── 3. Discrimination + direction ────────────────────────────────────────
def auc(y, x):
    y = np.asarray(y).astype(int)
    x = np.asarray(x, dtype=float)
    if y.sum() == 0 or (1 - y).sum() == 0:
        return 0.5
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(len(x))
    ranks[order] = np.arange(1, len(x) + 1)
    xs = pd.Series(x)
    tie = xs.map(xs.value_counts())
    ranks = ranks - (tie - 1) / 2.0
    n1, n0 = y.sum(), (1 - y).sum()
    return float((ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


# danger direction per feature: +1 = higher value is more dangerous,
# -1 = lower value is more dangerous (decided on TRAIN only).
FEATURES = ["coverage_deficit", "demand_erosion", "demand_stability",
            "supply_drop", "unconfirmed_share", "first_episode"]
F["coverage_deficit"] = (1.0 - F["coverage"]).clip(0, 1)
F["demand_erosion"] = (1.0 - F["demand_surge"]).clip(-5, 5)   # steady demand = worse
F["demand_stability"] = (1.0 - F["dem_cv"]).clip(-5, 5)       # low volatility = worse
F["first_episode"] = (F["prior_episodes"] == 0).astype(float)  # novel breach = worse

train = F[F.start <= 40]
test = F[F.start > 40]
ytr = train["matured"].values.astype(int)
yte = test["matured"].values.astype(int)

DIRECTION, RAW_AUC, WEIGHTS = {}, {}, {}
for f in FEATURES:
    a_tr = auc(ytr, train[f].values)
    RAW_AUC[f] = round(a_tr, 3)
    DIRECTION[f] = 1 if a_tr >= 0.5 else -1
    WEIGHTS[f] = max(0.0, abs(a_tr - 0.5))
wsum = sum(WEIGHTS.values())
WEIGHTS = {f: w / wsum for f, w in WEIGHTS.items()} if wsum else {f: 1/len(FEATURES) for f in FEATURES}

print(f"episodes: {len(F)}  matured: {int(y_all.sum() if False else F.matured.sum())} ({100*F.matured.mean():.1f}%)")
print(f"train: {len(train)} ({ytr.sum()} matured) | test: {len(test)} ({yte.sum()} matured)")
for f in FEATURES:
    print(f"  {f:18s} train AUC={RAW_AUC[f]:.3f}  dir={DIRECTION[f]:+d}  weight={WEIGHTS[f]:.3f}")


def score(frame):
    s = np.zeros(len(frame))
    for f, w in WEIGHTS.items():
        r = frame[f].rank(pct=True, method="average").values
        s += w * (r if DIRECTION[f] == 1 else 1.0 - r)
    return s


def directional_auc(y, s):
    return auc(y, s)


train_score = score(train)
test_score = score(test)
e_auc_train = directional_auc(ytr, train_score)
e_auc_test = directional_auc(yte, test_score)
cov_auc_test = auc(yte, (1.0 - test["coverage"]).values)
cov_auc_train = auc(ytr, (1.0 - train["coverage"]).values)
print(f"TRAIN AUC  ensemble={e_auc_train:.3f}  coverage-only={cov_auc_train:.3f}")
print(f"TEST  AUC  ensemble={e_auc_test:.3f}  coverage-only={cov_auc_test:.3f}")


# ── 4. Precision@K on the TEST window (what a planner actually feels) ────
def precision_at_k(y, s, k):
    order = np.argsort(-s)[:k]
    return float(np.asarray(y)[order].mean()), order


for k in (15, 50, 100):
    p_ens, _ = precision_at_k(yte, test_score, k)
    p_cov, _ = precision_at_k(yte, (1.0 - test["coverage"]).values, k)
    rng = np.random.default_rng(42)
    p_rand = float(np.mean([np.asarray(yte)[rng.choice(len(yte), k, replace=False)].mean() for _ in range(200)]))
    print(f"TEST precision@{k:<4} ensemble={p_ens:.3f}  coverage-rule={p_cov:.3f}  random={p_rand:.3f}"
          f"  lift={p_ens/max(p_rand,1e-9):.1f}x")

out = {
    "method": (
        "Direction-aware rank-ensemble over breach episodes; features known at episode start; "
        "directions and weights derived on episodes starting weeks 1-40 only; validated on held-out "
        "episodes starting weeks 41-52. Label: episode matures into a physical stock-out within 12 "
        "weeks of its end."
    ),
    "features": RAW_AUC,
    "directions": DIRECTION,
    "weights": {f: round(w, 4) for f, w in WEIGHTS.items()},
    "validation": {
        "train_episodes": int(len(train)),
        "train_matured": int(ytr.sum()),
        "train_auc": round(e_auc_train, 3),
        "test_episodes": int(len(test)),
        "test_matured": int(yte.sum()),
        "test_auc": round(e_auc_test, 3),
        "naive_coverage_train_auc": round(cov_auc_train, 3),
        "naive_coverage_test_auc": round(cov_auc_test, 3),
    },
}
with open("ranking_weights.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=2)
print("Saved: ranking_weights.json")
