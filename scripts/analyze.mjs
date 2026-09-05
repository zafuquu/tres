// Read-only statistical audit + next-draw prediction for the 3D Lotto ledger.
//
//   npm run analyze                       # current machine (default)
//   npm run analyze -- --old              # retired machine data
//   npm run analyze -- --combined         # old + current merged
//   npm run analyze -- --backtest=800     # walk-forward over the last N days
//   npm run analyze -- --backtest=0       # skip the backtest
//
// What it does:
//   1. Loads data/old_machine.json and data/new_machine.json and audits them
//      (day counts, date ranges, duplicated whole-day rows, calendar gaps).
//   2. Tests every timeframe/position against the fair-random expectation
//      (chi-square), plus structure classes and 90-draw hot/cold digits.
//   3. Runs the production prediction engine (lib/predictionEngine.js) on the
//      selected dataset and prints the next-draw ranking, the distinct-family
//      slate, and what that slate is actually worth in odds.
//
// The engine file uses ESM syntax but lives in a CommonJS package, so this
// script evaluates it by stripping the `export` keywords. This script never
// writes anything and never touches the database.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const argv = process.argv.slice(2);
const args = new Set(argv);
const DATASET = args.has("--old") ? "old" : args.has("--combined") ? "combined" : "new";
const backtestArg = argv.find((a) => a.startsWith("--backtest="));
const BACKTEST_DAYS = backtestArg ? Math.max(0, Number(backtestArg.split("=")[1]) || 0) : 400;

const SLOT_KEYS = ["slot1", "slot2", "slot3"];
const SLOT_NAMES = ["2PM", "5PM", "9PM"];

function loadMachine(file) {
  const rows = JSON.parse(readFileSync(join(ROOT, "data", file), "utf8"));
  return rows
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r.length === 10)
    .map((r) => ({ date: r[0], slot1: r.slice(1, 4), slot2: r.slice(4, 7), slot3: r.slice(7, 10) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function loadEngine() {
  const src = readFileSync(join(ROOT, "lib", "predictionEngine.js"), "utf8").replace(/^export /gm, "");
  return new Function(
    `${src}\nreturn { buildPrediction, getNextPredictionTarget, runWalkForwardBacktest, MODEL_VERSION };`
  )();
}

function audit(rows, label) {
  const dates = rows.map((r) => r.date);
  const seen = new Map();
  let dup = 0;
  const dupExamples = [];
  for (const r of rows) {
    const key = [...r.slot1, ...r.slot2, ...r.slot3].join("");
    if (seen.has(key) && seen.get(key) !== r.date) {
      dup += 1;
      if (dupExamples.length < 4) dupExamples.push(`${seen.get(key)} == ${r.date}`);
    } else if (!seen.has(key)) {
      seen.set(key, r.date);
    }
  }
  let gaps = 0;
  for (let i = 1; i < dates.length; i++) {
    const d = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
    if (d > 1) gaps += d - 1;
  }
  console.log(
    `\n[${label}] ${rows.length} days, ${dates[0]} -> ${dates[dates.length - 1]}, ` +
    `${gaps} missing calendar days, ${dup} duplicated whole-day rows` +
    (dupExamples.length ? ` (e.g. ${dupExamples.join("; ")})` : "")
  );
}

function fairnessCheck(rows, label) {
  const structureNames = ["ABC(all-different)", "AAB", "ABA", "ABB", "AAA"];
  const structureExpected = [72, 9, 9, 9, 1];
  console.log(`\n[${label}] fairness check vs fair random (chi-square df=9: expect 9 +/- 4.2 per position):`);
  for (let s = 0; s < 3; s++) {
    for (let p = 0; p < 3; p++) {
      const counts = Array(10).fill(0);
      rows.forEach((r) => { counts[r[SLOT_KEYS[s]][p]] += 1; });
      const n = rows.length;
      const chi = counts.reduce((a, x) => a + ((x - n / 10) ** 2) / (n / 10), 0);
      const hot = counts.indexOf(Math.max(...counts));
      const cold = counts.indexOf(Math.min(...counts));
      console.log(`  ${SLOT_NAMES[s]} pos${p + 1}: chi2=${chi.toFixed(1)}  hottest=${hot} (${counts[hot]})  coldest=${cold} (${counts[cold]})`);
    }
    const structure = [0, 0, 0, 0, 0];
    rows.forEach((r) => {
      const d = r[SLOT_KEYS[s]];
      const i = d[0] === d[1] && d[1] === d[2] ? 4 : d[0] === d[1] ? 1 : d[0] === d[2] ? 2 : d[1] === d[2] ? 3 : 0;
      structure[i] += 1;
    });
    const n = rows.length;
    console.log(`  ${SLOT_NAMES[s]} structure: ${structureNames.map((nm, i) => `${nm}=${((structure[i] / n) * 100).toFixed(1)}% (exp ${structureExpected[i]}%)`).join("  ")}`);
  }
}

function hotCold(rows, slotIndex, label) {
  const last = rows.slice(-90);
  for (let p = 0; p < 3; p++) {
    const counts = Array(10).fill(0);
    last.forEach((r) => { counts[r[SLOT_KEYS[slotIndex]][p]] += 1; });
    console.log(`  ${label} last-90 pos${p + 1}: ${counts.map((x, d) => `${d}:${x}`).join(" ")}`);
  }
}

// ---- execution ----
const oldRows = loadMachine("old_machine.json");
const newRows = loadMachine("new_machine.json");
const engine = loadEngine();

console.log(`3D LOTTO LEDGER ANALYSIS  |  engine ${engine.MODEL_VERSION}  |  dataset: ${DATASET}`);
audit(oldRows, "old machine (retired)");
audit(newRows, "current machine");

const records =
  DATASET === "old" ? oldRows
  : DATASET === "combined" ? [...oldRows, ...newRows].sort((a, b) => a.date.localeCompare(b.date))
  : newRows;
const statsRows = DATASET === "combined" ? newRows : records;

fairnessCheck(statsRows, `${DATASET} machine`);
for (let s = 0; s < 3; s++) hotCold(statsRows, s, SLOT_NAMES[s]);

// Next chronological target — mirrors the app's own predictionEntry logic.
let nextEntry;
const latest = statsRows[statsRows.length - 1];
for (const slot of SLOT_KEYS) {
  const s = latest[slot];
  if (!Array.isArray(s) || s.length !== 3) { nextEntry = { date: latest.date, slot }; break; }
}
if (!nextEntry) {
  const d = new Date(`${latest.date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  nextEntry = { date: d.toLocaleDateString("en-CA"), slot: "slot1" };
}

const target = engine.getNextPredictionTarget(records, nextEntry);
const prediction = engine.buildPrediction(records, target);

console.log(`\n=== NEXT DRAW ${target.date} ${target.label} ===`);
if (!prediction.ready) {
  console.log(`Not ready: only ${prediction.trainingEvents} training events (need 45).`);
} else {
  console.log(`training=${prediction.trainingEvents}  source=${prediction.config.source}  recencyWindow=${prediction.config.recentWindow}  temperature=${prediction.config.temperature}  confidence=${prediction.confidence}`);
  console.log(`weights: ${Object.entries(prediction.config.weights).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v.toFixed(3)}`).join("  ")}`);
  console.log(`angle presence in top 10: direct=${prediction.angleDirect}  mirror=${prediction.angleMirror}`);
  console.log("\nTop 10 (model-relative score, NOT a physical probability):");
  prediction.candidates.forEach((c) => {
    console.log(`  ${String(c.rank).padStart(2)}. ${c.candidate}  ${c.displayScore.toFixed(2)}  (${c.reasons.join(" + ")})`);
  });
  console.log("\nRanks 11-20:");
  prediction.extended.slice(10).forEach((c) => {
    console.log(`  ${String(c.rank).padStart(2)}. ${c.candidate}  ${c.displayScore.toFixed(2)}`);
  });
  console.log("\nDistinct-family slate (best coverage per ticket):");
  prediction.slate.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.candidate}  straight ${(s.straightOdds * 100).toFixed(2)}%  rambolito ${(s.rambolitoOdds * 100).toFixed(2)}% (${s.perms} permutations)`);
  });
  console.log(`\nSlate odds if played: straight ${(prediction.slateCoverage.straight * 100).toFixed(2)}%  |  rambolito ${(prediction.slateCoverage.rambolito * 100).toFixed(2)}%`);
  console.log("(Every exact-order outcome is always 1/1000. Real odds grow only with the number of DISTINCT tickets you actually play.)");
}

if (prediction.ready && BACKTEST_DAYS > 0) {
  const slice = records.slice(-BACKTEST_DAYS);
  const bt = engine.runWalkForwardBacktest(slice, null);
  const pct = (x) => (x * 100).toFixed(2) + "%";
  console.log(`\n=== WALK-FORWARD BACKTEST (last ${BACKTEST_DAYS} days, n=${bt.n} test draws) ===`);
  console.log(`  Top-1  ${pct(bt.top1Rate)}  (random ${pct(bt.randomTop1Rate)})`);
  console.log(`  Top-3  ${pct(bt.top3Rate)}  (random ${pct(bt.randomTop3Rate)})`);
  console.log(`  Top-5  ${pct(bt.top5Rate)}  (random ${pct(bt.randomTop5Rate)})`);
  console.log(`  Top-10 ${pct(bt.top10Rate)}  (random ${pct(bt.randomTop10Rate)})`);
  console.log(`  Top-20 ${pct(bt.top20Rate)}  (random ${pct(bt.randomTop20Rate)})`);
  console.log(`  Top-30 ${pct(bt.top30Rate)}  (random ${pct(bt.randomTop30Rate)})`);
  console.log(`  Family top-1 ${pct(bt.family1Rate)} (random ${pct(bt.randomFamily1Rate)})   family top-5 ${pct(bt.family5Rate)} (random ${pct(bt.randomFamily5Rate)})`);
  console.log(`  MRR ${bt.mrr.toFixed(4)}  |  Rates above baseline on one sample are noise until they persist across many redraws.`);
}
