# Swertres Prediction Engine — TWE-2.1 (implemented version)

This application is a statistical research tool. It does not establish that lottery outcomes are predictable, and its rankings should not be treated as guaranteed forecasts.

## Prediction target

The engine follows the next chronological draw event: 2 PM, 5 PM, 9 PM, then the next day's 2 PM. Only earlier chronological events are used for a target. When an earlier result from the same day is available, it can be used as transition context. A missing result is not fabricated or treated as an observed outcome.

## Candidate generation

The engine scores all 1,000 ordered three-digit combinations, from `000` through `999`. Digits are stored in data files as separate integers so leading zeros remain intact.

## Current scoring features

The engine combines smoothed evidence from:
1. Same-timeframe position frequencies.
2. Rolling position frequencies over the 30, 60, 90, or 180 most recent draws.
3. Cross-timeframe digit transitions.
4. Weekday and last digit of the day-of-month.
5. Ordered digit-pair history.
6. Exact triple history.
7. Repeated-digit structures (ABC, AAB, ABA, ABB, AAA).
8. Permutation-family history.
9. Angle Guide / mirror hypotheses, deliberately capped at a low weight.

The final candidate score is a weighted combination of these features.

## Weight learning and calibration — current limitations

The implementation uses a maximum of 24 recent same-slot validation events when learning recency windows and feature weights, once enough history exists. Learned weights are shrunk toward baseline weights, individual weights are capped, and the Angle/Mirror weight is capped at 0.035.

Important distinction: **the code currently implements TWE-2.1, not TWE-2.2**. The temperature-calibration pass uses the same recent validation-event window used by the weight-learning pass, so these tuning stages are not disjoint. Feature vectors are not z-scored across all 1,000 candidates. An earlier version of this document described disjoint 48/24 tuning windows and feature standardization that are not present in the engine source; those claims have been removed rather than relabeling unimplemented code as a newer version.

A future model revision should implement separate tuning windows and feature standardization as code changes, with tests and a new untouched evaluation window, before using a TWE-2.2 version label.

## Walk-forward backtest

The backtest processes observed events chronologically, scores the current target using prior state, then adds the target to history. It reports exact-order hit rates for Top-1, Top-3, Top-5, Top-10, Top-20, and Top-30, mean reciprocal rank, permutation-family hit rates, and per-timeframe breakdowns.

For a uniformly random ranking over 1,000 exact combinations, the reference hit rates are:

| Metric | Random reference |
| --- | ---: |
| Top-1 | 0.1% |
| Top-3 | 0.3% |
| Top-5 | 0.5% |
| Top-10 | 1% |
| Top-20 | 2% |
| Top-30 | 3% |

An observed rate above a reference on one evaluation window can occur by chance, especially when many model variations are tried. Predictive-skill claims require repeatable performance on untouched future draws and appropriate uncertainty analysis. The current model should be treated as exploratory, not as an advantage over random chance.

## Score display

The prediction screen shows a softmax-derived relative score across the 1,000 scored candidates. It is a model-relative score, not the physical probability that a combination will be drawn. For a fair three-digit draw, each exact ordered result has a theoretical probability of 1 in 1,000.

## Data integrity

Machine histories are stored in `data/old_machine.json` and `data/new_machine.json`. The UI fallback and database seeder use these same files so they cannot silently drift apart. Run `npm run validate-data` to check row format, date ordering, duplicate dates, digit ranges, and old/current date overlap.

The current-machine snapshot includes supplemental rows through October 26, 2026. Their provenance is recorded in `data/update_manifest_2026-10-26.json`. LottoBot, Lotto.Works, and other public archives are independent sources, not PCSO-operated databases; verify important results with official PCSO publications when available. The automatic sync endpoint still uses `pcsolotto.org`, which has previously lagged and should be treated as best-effort, not as a complete or authoritative archive.
