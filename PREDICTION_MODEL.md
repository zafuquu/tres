# Swertres Prediction Engine — TWE-2.2

This application is a statistical research tool. It does not establish that lottery outcomes are predictable, and its rankings should not be treated as guaranteed forecasts.

## Model structure

The engine predicts the next chronological timeframe independently:

- 2 PM
- 5 PM
- 9 PM
- then the next day's 2 PM

The immediate previous observed draw is included as a cross-timeframe transition context.

## Candidate generation

The model evaluates all 1,000 exact 3-digit combinations (`000` through `999`). Candidate scores use smoothed log-frequency features rather than raw counts.

## Features

1. Timeframe frequency
2. Rolling recency (automatically selected from 30 / 60 / 90 / 180 draws)
3. Cross-timeframe digit transitions
4. Weekday and day-of-month-digit context
5. Digit-pair structure
6. Exact triple history
7. ABC / AAB / ABA / ABB / AAA structure
8. Permutation-family history
9. Angle Guide and mirror hypotheses

## Tier-3 optimization

The current implementation adds:

- Bayesian-style evidence shrinkage for feature reliability
- automatic recency-window selection
- automated feature weighting from out-of-sample historical ranks
- feature-weight regularization toward stable baseline priors
- per-feature maximum-weight protection against overfitting
- score-temperature calibration for the displayed relative probabilities
- walk-forward validation with periodic re-learning

The Angle / Mirror feature is explicitly capped and cannot dominate the ensemble.

## Walk-forward validation

Historical evaluation only allows information available before each test draw. During validation, learned weights are periodically frozen for a block of future test observations before being re-learned from prior data.

Reported metrics include:

- Top-1 exact hit
- Top-3 exact hit
- Top-5 exact hit
- Top-1 permutation-family hit
- Top-5 permutation-family hit
- Mean reciprocal rank
- per-timeframe breakdown

A simple random baseline is shown beside the model. A result above baseline is evidence to investigate, not proof of a mechanical edge.

## Probability display

The candidate percentages are calibrated softmax probabilities over the model's 1,000 candidate space. They are relative model probabilities, not physical lottery probabilities.

## Data caveat

The embedded current-machine history contains gaps in calendar coverage. Missing history is not interpreted as an observed outcome. The application should be updated with verified official results as new draws become available.

## TWE-2.2 changes

- **Disjoint tuning blocks.** Feature weights and the recency window are learned from the older part of a 72-draw validation block (48 draws), while the score temperature is calibrated on the newest 24 draws only. Previously the temperature was fitted on the same draws used to learn the weights, which let it overfit those outcomes.
- **Feature standardization.** Each feature is z-scored across the 1,000 candidates before weighting. Features are log-probabilities on very different scales; without standardization a single feature could dominate the ensemble through raw scale alone (the "structure" weight repeatedly hit its 0.30 cap).
- **Larger validation block.** The tuning block grew from 24 to 72 draws, which materially reduces the variance of the learned weights.
- **Coverage reporting.** Walk-forward backtests now track Top-10 / Top-20 / Top-30 exact rates against their random baselines (1% / 2% / 3%), and every prediction ships with a distinct-permutation-family slate whose straight and Rambolito odds are reported explicitly (`slate`, `slateCoverage`), plus ranks 11–20 (`extended`).
- Removed dead code in the temperature calibration loop.

## What actually moves your odds

No ranking can raise the chance that a specific exact combination is drawn — every exact outcome is always 1 in 1,000, and this project's own backtests have never beaten that baseline consistently. The only levers that change real odds are: (1) how many **distinct** combinations you play, and (2) play type — a Rambolito ticket on an all-distinct family wins on 6 of 1,000 ordered outcomes, a double on 3, a triple on 1. The slate and coverage fields exist to make those trade-offs explicit instead of implying model skill that does not exist.
