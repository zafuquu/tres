# 3D Lotto Draw Ledger

A personal research dashboard for tracking PCSO 3D Lotto (Swertres) draws —
old-machine / current-machine / combined views, digit-frequency heatmap,
same-day and cross-day pattern checks, monthly clustering, and the
"Angle Guide" folk-method checker. Pre-loaded with 3,905 historical draws.

## Run locally

    npm install
    npm run dev

Then open the printed localhost URL.

## Deploy to Vercel

**Option A — via GitHub (recommended):**
1. Create a new GitHub repo and push this folder to it:
   ```
   git init
   git add .
   git commit -m "3D Lotto Draw Ledger"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
2. Go to https://vercel.com → **Add New… → Project**.
3. Import that GitHub repo. Vercel auto-detects Vite — leave the defaults
   (Build Command: `vite build`, Output Directory: `dist`) and click **Deploy**.
4. You'll get a live URL like `your-app.vercel.app` in about a minute.

**Option B — straight from your computer, no GitHub needed:**
1. Install the Vercel CLI once: `npm install -g vercel`
2. From inside this folder, run: `vercel`
3. Answer the prompts (it will offer sensible defaults for a Vite app).
4. Run `vercel --prod` when you're ready to make it the live URL.

## Notes

- Data is saved in the browser's `localStorage`, so it's per-device/per-browser —
  entries you add on your phone won't automatically show up on your laptop.
  (The Claude artifact version behaves the same way, just backed by a different
  storage system.)
- All historical data (old + current machine) is bundled directly into the
  app, so it works fully offline once loaded.
