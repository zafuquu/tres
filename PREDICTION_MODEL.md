# Swertres Prediction Engine — TWE-2.0

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
