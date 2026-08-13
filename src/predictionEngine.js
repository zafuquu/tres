const SLOTS = ["slot1", "slot2", "slot3"];
const SLOT_LABELS = { slot1: "2PM", slot2: "5PM", slot3: "9PM" };
const POSITION_COUNT = 3;
const DIGITS = 10;
const RECENCY_WINDOWS = [30, 60, 90, 180];
const DEFAULT_RECENCY_WINDOW = 90;
const MIN_TRAINING_EVENTS = 45;
const TUNING_EVENTS = 24;
const TUNING_MIN_HISTORY = 45;
const BACKTEST_RETRAIN_EVERY = 240;
export const MODEL_VERSION = "TWE-2.1";

export const FEATURE_LABELS = {
  base: "Timeframe frequency",
  recent: "Recency",
  transition: "Cross-timeframe transition",
  calendar: "Calendar context",
  pair: "Digit-pair structure",
  triple: "Exact triple history",
  structure: "Double/triple structure",
  family: "Permutation family",
  angle: "Angle / mirror",
};

const BASE_WEIGHTS = {
  base: 0.25,
  recent: 0.16,
  transition: 0.22,
  calendar: 0.06,
  pair: 0.10,
  triple: 0.07,
  structure: 0.05,
  family: 0.08,
  angle: 0.01,
};
const DEFAULT_TEMPERATURE = 1.0;

function cleanDigit(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 9 ? Number(value) : null;
}

export function isComplete(result) {
  return Array.isArray(result) && result.length === 3 && result.every((d) => cleanDigit(d) !== null);
}

export function normalizeRecords(records) {
  return [...(records || [])]
    .map((r) => ({
      date: r.date,
      slot1: isComplete(r.slot1) ? r.slot1.map(Number) : null,
      slot2: isComplete(r.slot2) ? r.slot2.map(Number) : null,
      slot3: isComplete(r.slot3) ? r.slot3.map(Number) : null,
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildEventSequence(records) {
  const normalized = normalizeRecords(records);
  const events = [];
  normalized.forEach((r) => {
    SLOTS.forEach((slot, slotIndex) => {
      if (r[slot]) events.push({
        date: r.date,
        slot,
        slotIndex,
        label: SLOT_LABELS[slot],
        digits: r[slot].slice(),
      });
    });
  });
  return events;
}

function zeros(size) { return new Array(size).fill(0); }

function makeState() {
  return {
    totalBySlot: [0, 0, 0],
    positionCounts: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => zeros(DIGITS))),
    recentQueues: Array.from({ length: 3 }, () => Object.fromEntries(RECENCY_WINDOWS.map((w) => [w, []]))),
    recentCounts: Array.from({ length: 3 }, () => Object.fromEntries(RECENCY_WINDOWS.map((w) => [w, Array.from({ length: 3 }, () => zeros(DIGITS))]))),
    transitionCounts: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => Array.from({ length: 10 }, () => zeros(DIGITS)))),
    weekdayCounts: Array.from({ length: 3 }, () => Array.from({ length: 7 }, () => Array.from({ length: 3 }, () => zeros(DIGITS)))),
    dayDigitCounts: Array.from({ length: 3 }, () => Array.from({ length: 10 }, () => Array.from({ length: 3 }, () => zeros(DIGITS)))),
    pairCounts: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => zeros(100))),
    tripleCounts: Array.from({ length: 3 }, () => zeros(1000)),
    familyCounts: Array.from({ length: 3 }, () => new Map()),
    structureCounts: Array.from({ length: 3 }, () => zeros(5)),
    lastEvent: null,
    eventCount: 0,
  };
}

function structureIndex(digits) {
  const [a, b, c] = digits;
  if (a === b && b === c) return 4;
  if (a === b) return 1;
  if (a === c) return 2;
  if (b === c) return 3;
  return 0;
}

function pairIndex(a, b) { return a * 10 + b; }
function tripleIndex(digits) { return digits[0] * 100 + digits[1] * 10 + digits[2]; }
function familyKey(digits) { return digits.slice().sort((a, b) => a - b).join(""); }
function weekday(date) { return new Date(`${date}T12:00:00`).getDay(); }
function dayLastDigit(date) { return Number(date.slice(-1)); }

function addRecent(state, slotIndex, digits) {
  RECENCY_WINDOWS.forEach((window) => {
    const q = state.recentQueues[slotIndex][window];
    const counts = state.recentCounts[slotIndex][window];
    q.push(digits.slice());
    digits.forEach((d, p) => { counts[p][d] += 1; });
    while (q.length > window) {
      const removed = q.shift();
      removed.forEach((d, p) => { counts[p][d] -= 1; });
    }
  });
}

function addEvent(state, event) {
  const s = event.slotIndex;
  state.totalBySlot[s] += 1;
  event.digits.forEach((d, p) => { state.positionCounts[s][p][d] += 1; });
  addRecent(state, s, event.digits);
  const wd = weekday(event.date);
  const dd = dayLastDigit(event.date);
  event.digits.forEach((d, p) => {
    state.weekdayCounts[s][wd][p][d] += 1;
    state.dayDigitCounts[s][dd][p][d] += 1;
  });
  state.pairCounts[s][0][pairIndex(event.digits[0], event.digits[1])] += 1;
  state.pairCounts[s][1][pairIndex(event.digits[0], event.digits[2])] += 1;
  state.pairCounts[s][2][pairIndex(event.digits[1], event.digits[2])] += 1;
  state.tripleCounts[s][tripleIndex(event.digits)] += 1;
  const fam = familyKey(event.digits);
  state.familyCounts[s].set(fam, (state.familyCounts[s].get(fam) || 0) + 1);
  state.structureCounts[s][structureIndex(event.digits)] += 1;

  if (state.lastEvent) {
    const prev = state.lastEvent;
    for (let targetPos = 0; targetPos < 3; targetPos++) {
      for (let prevPos = 0; prevPos < 3; prevPos++) {
        state.transitionCounts[s][targetPos][prev.digits[prevPos]][event.digits[targetPos]] += 1;
      }
    }
  }
  state.lastEvent = event;
  state.eventCount += 1;
}

function buildState(events) {
  const state = makeState();
  events.forEach((event) => addEvent(state, event));
  return state;
}

function prob(count, total, smoothing = 1) { return (count + smoothing) / Math.max(total + smoothing * DIGITS, smoothing * DIGITS); }
function pairProb(count, totalPairs, smoothing = 0.35) { return (count + smoothing) / Math.max(totalPairs + smoothing * 100, smoothing * 100); }
function tripleProb(count, totalTriples, smoothing = 0.15) { return (count + smoothing) / Math.max(totalTriples + smoothing * 1000, smoothing * 1000); }
function familyProb(count, totalFamilies, smoothing = 0.25) { return (count + smoothing) / Math.max(totalFamilies + smoothing * 220, smoothing * 220); }

function angleGridForDate(date) {
  const day = Number(date.slice(8, 10));
  const c = day % 10;
  const m = (x) => ((x % 10) + 10) % 10;
  const grid = [[m(c + 1), m(c + 2), m(c + 3)], [m(c - 4), c, m(c + 4)], [m(c - 3), m(c - 2), m(c - 1)]];
  const combos = [
    [grid[0][0], grid[0][1], grid[0][2]], [grid[1][0], grid[1][1], grid[1][2]], [grid[2][0], grid[2][1], grid[2][2]],
    [grid[0][0], grid[1][0], grid[2][0]], [grid[0][1], grid[1][1], grid[2][1]], [grid[0][2], grid[1][2], grid[2][2]],
    [grid[0][0], grid[1][1], grid[2][2]], [grid[0][2], grid[1][1], grid[2][0]],
    [grid[0][1], grid[0][2], grid[1][1]], [grid[1][1], grid[1][2], grid[2][2]],
    [grid[1][0], grid[1][1], grid[2][0]], [grid[0][0], grid[0][1], grid[1][0]],
  ];
  return combos.map((d) => d.join(""));
}

function mirrorDigit(d) { return d < 5 ? d + 5 : d - 5; }
function mirrorCombo(combo) { return combo.split("").map((d) => mirrorDigit(Number(d))).join(""); }

function featureNames() { return Object.keys(BASE_WEIGHTS); }

function makeFeatureScorer(state, targetEvent, recentWindow = DEFAULT_RECENCY_WINDOW) {
  const s = targetEvent.slotIndex;
  const total = state.totalBySlot[s];
  const recentTotal = state.recentQueues[s][recentWindow].length;
  const wd = weekday(targetEvent.date);
  const dd = dayLastDigit(targetEvent.date);
  const base = Array.from({ length: 3 }, () => zeros(DIGITS));
  const recent = Array.from({ length: 3 }, () => zeros(DIGITS));
  const transition = Array.from({ length: 3 }, () => zeros(DIGITS));
  const calendar = Array.from({ length: 3 }, () => zeros(DIGITS));

  for (let p = 0; p < 3; p++) {
    const wTotal = Math.max(0, state.weekdayCounts[s][wd][p].reduce((a, b) => a + b, 0));
    const dTotal = Math.max(0, state.dayDigitCounts[s][dd][p].reduce((a, b) => a + b, 0));
    for (let d = 0; d < DIGITS; d++) {
      base[p][d] = Math.log(prob(state.positionCounts[s][p][d], total, 1));
      recent[p][d] = Math.log(prob(state.recentCounts[s][recentWindow][p][d], recentTotal, 1));
      calendar[p][d] = 0.65 * Math.log(prob(state.weekdayCounts[s][wd][p][d], wTotal, 1)) + 0.35 * Math.log(prob(state.dayDigitCounts[s][dd][p][d], dTotal, 1));
      if (state.lastEvent) {
        let tr = 0;
        for (let prevPos = 0; prevPos < 3; prevPos++) {
          const prevDigit = state.lastEvent.digits[prevPos];
          const row = state.transitionCounts[s][p][prevDigit];
          const rowTotal = row.reduce((a, b) => a + b, 0);
          const q = Math.log(prob(row[d], rowTotal, 1));
          tr += (prevPos === p ? 0.68 : 0.16) * q;
        }
        transition[p][d] = tr;
      } else transition[p][d] = Math.log(0.1);
    }
  }

  const pair = [zeros(100), zeros(100), zeros(100)];
  for (let i = 0; i < 100; i++) {
    pair[0][i] = Math.log(pairProb(state.pairCounts[s][0][i], total));
    pair[1][i] = Math.log(pairProb(state.pairCounts[s][1][i], total));
    pair[2][i] = Math.log(pairProb(state.pairCounts[s][2][i], total));
  }
  const triple = zeros(1000);
  for (let i = 0; i < 1000; i++) triple[i] = Math.log(tripleProb(state.tripleCounts[s][i], total));
  const structure = zeros(5);
  for (let i = 0; i < 5; i++) structure[i] = Math.log(prob(state.structureCounts[s][i], Math.max(total, 1), 1));

  const familyTotal = state.totalBySlot[s];
  const familyScores = new Map();
  state.familyCounts[s].forEach((count, key) => familyScores.set(key, Math.log(familyProb(count, familyTotal))));
  const unseenFamilyScore = Math.log(familyProb(0, familyTotal));
  const angleSet = new Set(angleGridForDate(targetEvent.date));
  const mirrorSet = new Set([...angleSet].map(mirrorCombo));

  function featureVector(candidate) {
    const digits = candidate.split("").map(Number);
    const pairScore = (pair[0][pairIndex(digits[0], digits[1])] + pair[1][pairIndex(digits[0], digits[2])] + pair[2][pairIndex(digits[1], digits[2])]) / 3;
    const fam = familyKey(digits);
    const angle = angleSet.has(candidate) ? 1 : (mirrorSet.has(candidate) ? 0.35 : 0);
    return {
      base: base[0][digits[0]] + base[1][digits[1]] + base[2][digits[2]],
      recent: recent[0][digits[0]] + recent[1][digits[1]] + recent[2][digits[2]],
      transition: transition[0][digits[0]] + transition[1][digits[1]] + transition[2][digits[2]],
      calendar: calendar[0][digits[0]] + calendar[1][digits[1]] + calendar[2][digits[2]],
      pair: pairScore,
      triple: triple[tripleIndex(digits)],
      structure: structure[structureIndex(digits)],
      family: familyScores.get(fam) ?? unseenFamilyScore,
      angle,
    };
  }

  return { featureVector, recentWindow, angleSet, mirrorSet };
}

const ALL_CANDIDATES = Array.from({ length: 1000 }, (_, i) => i.toString().padStart(3, "0"));

function weightedScore(features, weights) {
  return featureNames().reduce((sum, name) => sum + (weights[name] || 0) * features[name], 0);
}

function scoreAll(featureScorer, weights) {
  return ALL_CANDIDATES.map((candidate) => {
    const features = featureScorer.featureVector(candidate);
    return { candidate, features, score: weightedScore(features, weights) };
  });
}

function buildFeatureMatrix(featureScorer) {
  return ALL_CANDIDATES.map((candidate) => ({ candidate, features: featureScorer.featureVector(candidate) }));
}

function rankFromMatrix(matrix, featureName, actual) {
  const actualRow = matrix.find((row) => row.candidate === actual);
  const actualScore = actualRow?.features?.[featureName] ?? -Infinity;
  let rank = 1;
  for (const row of matrix) {
    if (row.candidate !== actual && row.features[featureName] > actualScore) rank += 1;
  }
  return rank;
}

function rankOf(scored, actual) {
  for (let i = 0; i < scored.length; i++) if (scored[i].candidate === actual) return i + 1;
  return scored.length;
}

function topKRate(scored, actual, k) { return scored.slice(0, k).some((x) => x.candidate === actual) ? 1 : 0; }

function validationEvents(events, targetSlotIndex) {
  const slotEvents = events.filter((e) => e.slotIndex === targetSlotIndex);
  if (slotEvents.length <= TUNING_MIN_HISTORY) return [];
  return slotEvents.slice(-Math.min(TUNING_EVENTS, slotEvents.length - TUNING_MIN_HISTORY));
}

function learnRecentWindow(events, target) {
  const candidates = RECENCY_WINDOWS.map((window) => ({ window, mrr: 0, top3: 0, n: 0 }));
  const vals = validationEvents(events, target.slotIndex);
  if (!vals.length) return DEFAULT_RECENCY_WINDOW;
  vals.forEach((validationTarget) => {
    const prior = events.filter((e) => e.date < validationTarget.date || (e.date === validationTarget.date && e.slotIndex < validationTarget.slotIndex));
    const state = buildState(prior);
    RECENCY_WINDOWS.forEach((window, idx) => {
      const scorer = makeFeatureScorer(state, validationTarget, window);
      const matrix = buildFeatureMatrix(scorer);
      const actual = validationTarget.digits.join("");
      const rank = rankFromMatrix(matrix, "recent", actual);
      candidates[idx].mrr += 1 / rank;
      candidates[idx].top3 += rank <= 3 ? 1 : 0;
      candidates[idx].n += 1;
    });
  });
  candidates.forEach((x) => { x.mrr /= x.n || 1; x.top3 /= x.n || 1; });
  candidates.sort((a, b) => (b.mrr + b.top3 * 0.35) - (a.mrr + a.top3 * 0.35));
  return candidates[0]?.window || DEFAULT_RECENCY_WINDOW;
}

function learnedWeightsFor(events, target) {
  const names = featureNames();
  const vals = validationEvents(events, target.slotIndex);
  if (!vals.length) return { weights: { ...BASE_WEIGHTS }, validation: null };
  const metrics = Object.fromEntries(names.map((name) => [name, { n: 0, top1: 0, top5: 0, mrr: 0 }]));
  const window = learnRecentWindow(events, target);

  vals.forEach((validationTarget) => {
    const prior = events.filter((e) => e.date < validationTarget.date || (e.date === validationTarget.date && e.slotIndex < validationTarget.slotIndex));
    const state = buildState(prior);
    const scorer = makeFeatureScorer(state, validationTarget, window);
    const matrix = buildFeatureMatrix(scorer);
    const actual = validationTarget.digits.join("");
    names.forEach((name) => {
      const rank = rankFromMatrix(matrix, name, actual);
      metrics[name].n += 1;
      metrics[name].top1 += rank === 1 ? 1 : 0;
      metrics[name].top5 += rank <= 5 ? 1 : 0;
      metrics[name].mrr += 1 / rank;
    });
  });

  const posterior = {};
  names.forEach((name) => {
    const m = metrics[name];
    // Beta(1,999) prior matches the 0.1% exact-hit baseline.
    const alpha = 1 + m.top1;
    const beta = 999 + Math.max(0, m.n - m.top1);
    const top1Posterior = alpha / (alpha + beta);
    const mrr = m.mrr / (m.n || 1);
    const top5 = m.top5 / (m.n || 1);
    const evidence = Math.max(0, (mrr - 0.001) * 1.7 + (top5 - 0.005) * 0.9 + (top1Posterior - 0.001) * 2.5);
    const priorWeight = name === "angle" ? 0.004 : 0.03;
    posterior[name] = Math.max(name === "angle" ? 0.001 : 0, priorWeight + evidence);
  });

  posterior.angle = Math.min(posterior.angle, 0.035);
  const rawSum = Object.values(posterior).reduce((a, b) => a + b, 0) || 1;
  const learnedNorm = Object.fromEntries(names.map((name) => [name, posterior[name] / rawSum]));
  // Regularize toward stable baseline weights so a small validation sample cannot dominate the ensemble.
  const SHRINK = 0.55;
  const maxWeight = 0.30;
  const blended = Object.fromEntries(names.map((name) => [name, SHRINK * learnedNorm[name] + (1 - SHRINK) * BASE_WEIGHTS[name]]));
  blended.angle = Math.min(blended.angle, 0.035);
  let excess = 0;
  names.forEach((name) => {
    if (blended[name] > maxWeight) { excess += blended[name] - maxWeight; blended[name] = maxWeight; }
  });
  if (excess > 0) {
    const adjustable = names.filter((name) => blended[name] < maxWeight && name !== "angle");
    const adjSum = adjustable.reduce((sum, name) => sum + blended[name], 0) || 1;
    adjustable.forEach((name) => { blended[name] += excess * (blended[name] / adjSum); });
  }
  const sum = Object.values(blended).reduce((a, b) => a + b, 0) || 1;
  const weights = Object.fromEntries(names.map((name) => [name, blended[name] / sum]));
  const validation = {
    n: vals.length,
    recentWindow: window,
    metrics: Object.fromEntries(names.map((name) => {
      const m = metrics[name];
      return [name, { top1: m.top1 / (m.n || 1), top5: m.top5 / (m.n || 1), mrr: m.mrr / (m.n || 1), weight: weights[name] }];
    })),
  };
  return { weights, validation };
}

function calibrateTemperature(events, target, config) {
  const vals = validationEvents(events, target.slotIndex).slice(-24);
  if (!vals.length) return DEFAULT_TEMPERATURE;
  const temperatures = [0.45, 0.65, 0.85, 1, 1.2, 1.5, 2, 2.5];
  let best = { temperature: 1, loss: Infinity };
  vals.forEach(() => {});
  temperatures.forEach((temperature) => {
    let loss = 0;
    vals.forEach((validationTarget) => {
      const prior = events.filter((e) => e.date < validationTarget.date || (e.date === validationTarget.date && e.slotIndex < validationTarget.slotIndex));
      const state = buildState(prior);
      const scorer = makeFeatureScorer(state, validationTarget, config.weights ? config.recentWindow : DEFAULT_RECENCY_WINDOW);
      const scored = scoreAll(scorer, config.weights);
      const max = Math.max(...scored.map((x) => x.score));
      let denom = 0;
      for (const x of scored) denom += Math.exp((x.score - max) / temperature);
      const actual = validationTarget.digits.join("");
      const actualRow = scored.find((x) => x.candidate === actual);
      const p = Math.exp((actualRow.score - max) / temperature) / Math.max(denom, Number.EPSILON);
      loss -= Math.log(Math.max(p, 1e-12));
    });
    loss /= vals.length;
    if (loss < best.loss) best = { temperature, loss };
  });
  return best.temperature;
}

function explainReasons(features) {
  return Object.entries(features)
    .filter(([name]) => name !== "angle")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => FEATURE_LABELS[name]);
}

function learnModelConfig(events, target) {
  const learned = learnedWeightsFor(events, target);
  const recentWindow = learned.validation?.recentWindow || DEFAULT_RECENCY_WINDOW;
  const configBase = {
    weights: learned.weights,
    recentWindow,
    validation: learned.validation,
    source: learned.validation ? "learned" : "baseline",
  };
  const temperature = calibrateTemperature(events, target, configBase);
  return { ...configBase, temperature };
}

export function buildPrediction(records, target) {
  const events = buildEventSequence(records);
  const priorEvents = events.filter((event) => event.date < target.date || (event.date === target.date && event.slotIndex < target.slotIndex));
  if (priorEvents.length < MIN_TRAINING_EVENTS) return { ready: false, candidates: [], trainingEvents: priorEvents.length, target, modelVersion: MODEL_VERSION };

  const config = learnModelConfig(priorEvents, target);
  const state = buildState(priorEvents);
  const scorer = makeFeatureScorer(state, target, config.recentWindow);
  const scored = scoreAll(scorer, config.weights).sort((a, b) => b.score - a.score);
  const max = scored[0]?.score ?? 0;
  const denom = scored.reduce((sum, item) => sum + Math.exp((item.score - max) / config.temperature), 0);
  const top = scored.slice(0, 10).map((x, idx) => ({
    ...x.features,
    candidate: x.candidate,
    reasons: explainReasons(x.features),
    permutationKey: x.candidate.split("").sort().join(""),
    displayScore: denom ? (Math.exp((x.score - max) / config.temperature) / denom) * 100 : 0,
    rank: idx + 1,
  }));
  const angleSet = new Set(angleGridForDate(target.date));
  const mirrorSet = new Set([...angleSet].map(mirrorCombo));
  const top1 = top[0];
  const gap = top[0] && top[1] ? top[0].displayScore - top[1].displayScore : 0;
  const confidence = top1 ? (top1.displayScore >= 0.25 && gap >= 0.03 ? "RELATIVE STRONG" : top1.displayScore >= 0.15 || gap >= 0.02 ? "RELATIVE WATCH" : "LOW SEPARATION") : "UNAVAILABLE";

  return {
    ready: true,
    target,
    trainingEvents: priorEvents.length,
    previous: priorEvents.length ? priorEvents[priorEvents.length - 1] : null,
    candidates: top,
    angleCombos: angleGridForDate(target.date),
    modelVersion: MODEL_VERSION,
    config: {
      weights: config.weights,
      recentWindow: config.recentWindow,
      temperature: config.temperature,
      source: config.source,
      validationN: config.validation?.n || 0,
    },
    confidence,
    top1Probability: top1 ? top1.displayScore / 100 : 0,
    angleDirect: top.filter((x) => angleSet.has(x.candidate)).length,
    angleMirror: top.filter((x) => mirrorSet.has(x.candidate)).length,
  };
}

function sameFamily(a, b) { return a.split("").sort().join("") === b.split("").sort().join(""); }

export function runWalkForwardBacktest(records, machineCutoff = null) {
  let events = buildEventSequence(records);
  if (machineCutoff) events = events.filter((e) => e.date >= machineCutoff);
  const state = makeState();
  const eligible = [];
  let top1 = 0, top3 = 0, top5 = 0, family1 = 0, family5 = 0, mrr = 0;
  const bySlot = { slot1: { n: 0, top1: 0, top3: 0, top5: 0 }, slot2: { n: 0, top1: 0, top3: 0, top5: 0 }, slot3: { n: 0, top1: 0, top3: 0, top5: 0 } };
  const sample = [];
  const configBySlot = {};
  const checkpoints = {};

  events.forEach((target, index) => {
    const sKey = target.slot;
    const priorSnapshotCount = checkpoints[sKey] ?? 0;
    if (state.totalBySlot[target.slotIndex] >= MIN_TRAINING_EVENTS) {
      if (!configBySlot[sKey] || (state.totalBySlot[target.slotIndex] - priorSnapshotCount) >= BACKTEST_RETRAIN_EVERY) {
        const priorEvents = events.slice(0, index);
        const learned = learnedWeightsFor(priorEvents, target);
        configBySlot[sKey] = { weights: learned.weights, recentWindow: learned.validation?.recentWindow || DEFAULT_RECENCY_WINDOW, temperature: 1, validation: learned.validation, source: learned.validation ? "learned" : "baseline" };
        checkpoints[sKey] = state.totalBySlot[target.slotIndex];
      }
      const config = configBySlot[sKey];
      const scorer = makeFeatureScorer(state, target, config.recentWindow);
      const scored = scoreAll(scorer, config.weights).sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 5).map((x) => x.candidate);
      const actual = target.digits.join("");
      const rank = rankOf(scored, actual);
      const exact1 = rank === 1;
      const exact3 = rank <= 3;
      const exact5 = rank <= 5;
      const fam1 = sameFamily(top[0], actual);
      const fam5 = top.some((x) => sameFamily(x, actual));
      top1 += exact1 ? 1 : 0; top3 += exact3 ? 1 : 0; top5 += exact5 ? 1 : 0;
      family1 += fam1 ? 1 : 0; family5 += fam5 ? 1 : 0; mrr += 1 / rank;
      bySlot[target.slot].n += 1;
      bySlot[target.slot].top1 += exact1 ? 1 : 0;
      bySlot[target.slot].top3 += exact3 ? 1 : 0;
      bySlot[target.slot].top5 += exact5 ? 1 : 0;
      if (sample.length < 8) sample.push({ date: target.date, slot: target.label, actual, top: top.slice(0, 3), hit1: exact1, rank });
      eligible.push(target);
    }
    addEvent(state, target);
    return index;
  });

  const n = eligible.length;
  const slotSummary = Object.fromEntries(Object.entries(bySlot).map(([slot, row]) => [slot, {
    ...row,
    top1Rate: row.n ? row.top1 / row.n : 0,
    top3Rate: row.n ? row.top3 / row.n : 0,
    top5Rate: row.n ? row.top5 / row.n : 0,
  }]));
  const bestSlot = Object.entries(slotSummary).sort((a, b) => b[1].top3Rate - a[1].top3Rate)[0]?.[0] || null;
  return {
    modelVersion: MODEL_VERSION,
    n,
    top1, top3, top5, family1, family5,
    top1Rate: n ? top1 / n : 0,
    top3Rate: n ? top3 / n : 0,
    top5Rate: n ? top5 / n : 0,
    family1Rate: n ? family1 / n : 0,
    family5Rate: n ? family5 / n : 0,
    mrr: n ? mrr / n : 0,
    randomTop1Rate: 0.001,
    randomTop3Rate: 0.003,
    randomTop5Rate: 0.005,
    randomFamily1Rate: 0.006,
    randomFamily5Rate: 0.03,
    bySlot,
    slotSummary,
    bestSlot,
    sample,
  };
}

export function getNextPredictionTarget(records, nextEntry) {
  return { date: nextEntry.date, slot: nextEntry.slot, slotIndex: SLOTS.indexOf(nextEntry.slot), label: SLOT_LABELS[nextEntry.slot], digits: null };
}

export function formatPercent(value) { return `${(value * 100).toFixed(2)}%`; }
export function formatProbability(value) { return `${(value * 100).toFixed(3)}%`; }
