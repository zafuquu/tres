# Swertres Research Ledger

A dark, mobile-friendly statistical ledger for Swertres / 3D Lotto history and research.

## Included

- Strict chronological manual entry: 2 PM → 5 PM → 9 PM → next day 2 PM
- Duplicate and out-of-sequence entry protection
- Old / Current / Combined machine views
- Position-level frequency analysis
- Pattern and monthly repeat analysis
- Date-driven Angle Guide with mirror display
- Timeframe-aware Prediction Lab
- Automatic signal-weight learning with regularization
- Recency-window selection
- Walk-forward validation and per-timeframe performance
- Ranked 1,000-candidate exact-combination board

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

See `PREDICTION_MODEL.md` for the prediction methodology and its limitations.

## Cross-device sync

The browser-only fallback uses localStorage, which is inherently device-specific.
This app is designed to pair with the `swertres-full` backend (Next.js + Postgres,
built and load-tested separately) rather than the originally-planned Supabase setup —
no separate database service to configure, and it's already working end-to-end.

1. Deploy `swertres-full` (see its own README: create a Vercel Postgres database,
   run its seed script, deploy).
2. Copy `.env.example` to `.env` here and set `VITE_API_BASE_URL` to that deployed
   app's URL (e.g. `https://your-swertres-backend.vercel.app`, no trailing slash).
3. Rebuild/redeploy this app.

The app merges complete draw slots from local and cloud copies, so a saved 2 PM
result on one device will not be erased by a stale/incomplete copy from another
device — each record is written individually to the database, not as one big
overwritable blob, so two devices saving near-simultaneously can't clobber
each other's data.

## A note on the Prediction Lab

The walk-forward backtest and next-draw scoring in Prediction Lab now only run
when you explicitly click "Run Backtest" / open that tab — earlier this ran
automatically on every load and every machine-view switch, scoring all 1,000
candidate combinations across the full history each time, which was heavy
enough to freeze the browser tab (especially on the Old/Combined views).
It's now also capped to the most recent ~900 draw-days for responsiveness.

Worth knowing going in: this project's own research (see the ledger's Dashboard
stamps, and the separate 3D Lotto research report) tested frequency, sequential,
calendar, and machine-learning models extensively against this same data and
found none of them beat random chance. Prediction Lab is offered as the same
kind of exploratory tool, not as a validated predictor — read its own backtest
results (Top-1/Top-3 hit rate vs. chance) with that in mind rather than as a
working forecast.
