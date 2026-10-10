# GDI External Anchor — 30-Day Observation Period Settlement Report (P-2)

**Verdict: ① Adopted for scoring (turned into a regular metric)**
Decided by: Yilan · 2026-10-09
Observation window: 2026-09-05 → 2026-10-05 (actual snapshots from 2026-09-23 onward — see §4 Honest Boundaries)
Criteria doc: `docs/gdi-anchor-settlement-criteria.md` (v0.2 · thresholds fixed 2026-09-23)
Machine-readable: `data/gdi/settlement/2026-10-09.json` (`verdict.option = "①"`)
Chinese version: `docs/gdi-settlement-report-2026-10-09.md`

---

## 1. One-line conclusion

The external anchor (Witness / delegation / provenance provenance) **proved effective over the 30-day observation period**: it covers (A1 100%), it discriminates (Group B shape on target), it resists gaming (C5 at 0.55× baseline after fix), and it is trustworthy (all Group D hard gates passed) → **adopted for scoring, entering regular observation**.

## 2. Four criterion groups, item by item

| Group | Verdict | Key data (as of settlement 2026-10-09) |
|---|---|---|
| **A Coverage** | ✅ Pass | A1 real snapshots **16/16 = 100%** (threshold ≥80%) · A2 max gap **1 day** (≤3) · A3 witness: **7 distinct subjects / 11 witnesses / 14 relationship pairs** (≥2, the adoption threshold) · A4 delegation audit `N/A` (none landed in window, recorded honestly) |
| **B Discrimination** | ✅ Shape on target | B1 top1 share 0.412, subject Gini 0.3866 (≠0, not all-tied-perfect) · B2 daily sealed-rate range 0–0.6667 (non-constant) · B3 no-interaction baseline to be built post-adoption (non-blocking) |
| **C Robustness** | ✅ Pass | C1 self-reference violations **0** (hard gate) · C5 counter-example test **0.55× honest baseline** (≤2×) · C2 same-pair decay / reciprocity halving / C3 time decay / C4 de-scaling all structurally present |
| **D Reliability** | ✅ Pass | D1 snapshot timestamps **17/17 = 100%** · D2 repeat-run consistency · D3 audit chain `N/A` (no data, not fabricated) · D4 missing values recorded as `N/A`, never 0 |

## 3. One real bug found and fixed during observation (C5)

The Day-18 first test (2026-09-23) **failed C5**: reciprocity halving was a constant 0.5 rather than marginal decay, so same-pair repetition accumulated linearly — "spam the same pair 100 times" scored 45.14 = **11.52× the honest baseline** (threshold ≤2×).

**Fix** (shipped the same day): `engine/witness.js` introduced same-pair decay — the n-th interaction in the same relationship direction is weighted ×1/n, reciprocity halving retained.

**Retest**: same-pair spam 45.14 → **2.17** (0.55× baseline) ✅ · mutual spam 45.14 → 2.17 ✅ · stale spam → 0.07 (decay works) ✅ · unclaimed rewrite → 0 ✅

Direction preserved: **genuinely diverse witnesses > same-pair repetition**.

## 4. Honest boundaries (this section must not be removed)

| Source | Gap / limitation | Handling |
|---|---|---|
| provenance | **18 days with no real snapshots (09-05 → 09-22)** (collector only went live 09-23) | Backfilled data labeled `reconstructed` (look-ahead bias, optimistic), **excluded from A1**; we do not pretend to have a 30-day curve |
| delegation | No audit entries landed during the window | Recorded as `N/A`, **never as a fake 0** |
| witness | 6 early entries were manually registered | Carry `evidence` provenance; human-confirmed, not automatic |

A1's denominator starts at the collector go-live date (decided 2026-09-24): it measures **whether collection can be sustained**, not whether we can travel back in time.

## 5. Operations actions (same day, 2026-10-09)

- ✅ The 23:35 `GDI daily collection` agentTurn cron is **disabled** — its observation-period mission is complete; re-reporting the same verdict daily after the verdict exists is noise
- ✅ **`gdi-catchup.sh` (inside the 20-minute keepalive) kept** — it continues the daily snapshots at zero cost, so the data continuity never breaks (snapshots honestly labeled `lateRun=true`)
- Re-settlement on demand: `gdi-collect-daily.sh --date <date>` + `gdi-anchor-settlement.js --date <date>`

## 6. Follow-ups (post-adoption)

1. Define and test the **B3 no-interaction baseline set** (the hard contrast for discrimination)
2. Fold GDI scores into the regular observation cadence (quarterly light checks / semi-annual deep calibration, consistent with existing practice)
3. Publish this report bilingually to the forum (signed Ruozhuo 🌸) + archive cross-reference

---

*Settlement criteria and daily snapshots: `csb-aep/data/gdi/` · Archived 2026-10-09*
