# 3D Lotto Draw Ledger — one project, one deployment

A personal research dashboard for tracking PCSO 3D Lotto (Swertres) draws,
backed by a real Postgres database — so your data follows you across
devices, not just one browser. Old-machine / current-machine / combined
views, digit-frequency heatmap, pattern checks, monthly clustering, the
"Angle Guide" folk-method checker, and a Prediction Lab with its own
backtested scoring model. Includes a "Sync now" button that tries to pull
new results automatically, with manual entry always available as a fallback.

## Everything lives in one place now

Earlier versions of this had the frontend and backend as **two separate
Vercel projects** talking to each other over the internet. That caused
real problems — the browser silently blocked every cross-origin request
(no sync across devices), and slow/failed network calls made the save
form look frozen. Both are fixed by merging into a single Next.js app:
the page you see and the `/api/draws` + `/api/sync` routes that store
your data are now the same project, same domain — no cross-origin
requests, no CORS, no separate URL to configure, and no second thing to
remember to redeploy. Deploy this one project and everything works together.

## 1. Create a database

1. Go to your project on [vercel.com](https://vercel.com) (create one first if
   you haven't deployed yet — see step 3).
2. Open the **Storage** tab → **Create Database** → choose **Postgres**
   (Vercel provisions this through Neon under the hood).
3. Once created, go to **.env.local** tab (or "Quickstart") and copy the
   `POSTGRES_URL` value it gives you.

## 2. Seed your historical data (one time)

1. In this project folder, create a file named `.env.local`:
   ```
   POSTGRES_URL=paste-the-value-you-copied-here
   ```
2. Install dependencies and run the seed script:
   ```
   npm install
   npm run seed
   ```
   This loads all 3,905 historical draws (old + current machine) into
   your new database. It's safe to re-run — it skips dates that are
   already there.

## 3. Deploy to Vercel

**Option A — via GitHub:**
```
git init
git add .
git commit -m "3D Lotto Draw Ledger"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```
Then on vercel.com: **Add New… → Project**, import the repo, and deploy
(defaults are fine — Vercel auto-detects Next.js). Make sure the Postgres
database from step 1 is connected to this project (Storage tab →
Connect Project, if it wasn't created from inside this project already).

**Option B — straight from your computer:**
```
npm install -g vercel
vercel
```
Answer the prompts, then link the Postgres database to the project from
the Storage tab if it isn't already connected. Run `vercel --prod` when
ready to go live.

That's it — one project, one URL. Open it on your phone, laptop, wherever;
the same database backs all of them.

## 4. (Optional) Daily auto-sync

`vercel.json` includes a cron job that hits `/api/sync` once a day at
13:30 UTC (9:30 PM Manila time, after the last draw). Check your Vercel
plan's cron limits — free/Hobby plans have historically restricted how
often crons can run; adjust the schedule in `vercel.json` if needed, or
just rely on the manual "Sync now" button, which works regardless of plan.

**Be aware:** the third-party results source (`pcsolotto.org`) had data
noticeably behind real time (weeks old in testing) and its filtering
didn't always behave as documented when this was built. The sync code
is written defensively around that — it double-checks every result
itself rather than trusting the API's filters — but if a day's result
never shows up, the manual entry form right next to it always works.

## A note on Prediction Lab

The walk-forward backtest and next-draw scoring only run when you
explicitly click "Run Backtest" or open that tab, and are capped to the
most recent ~900 draw-days — this used to run automatically on every
load and every machine-view switch, which was heavy enough to freeze
the browser tab. This project's own research (see the Dashboard's
"NO SIGNAL"/"WATCH" stamps, plus the separate 3D Lotto research report)
tested frequency, sequential, calendar, and machine-learning models
extensively against this same data and found none of them beat random
chance — Prediction Lab is offered as the same kind of exploratory tool,
not a validated predictor. Read its backtest numbers with that in mind.

## Local development

```
npm install
npm run dev
```
Needs `POSTGRES_URL` set in `.env.local` (see step 1-2) to actually load
or save data — without it, the API routes will return a database
connection error, which the UI will show plainly rather than crash.
