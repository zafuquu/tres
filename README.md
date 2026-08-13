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

The browser-only fallback uses localStorage, which is inherently device-specific. To make entries sync between phones/PCs, configure the optional Supabase sync layer:

1. Create a Supabase project.
2. Run `SUPABASE_SYNC.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Keep the same `VITE_SWERTRES_SYNC_ID` on every deployment/device build.
5. Deploy/rebuild the app.

The app merges complete draw slots from local and cloud copies, so a saved 2 PM result on one device will not be erased by a stale copy from another device.
