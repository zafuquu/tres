import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  { name: "old_machine.json" },
  { name: "new_machine.json" },
];

function fail(message) {
  console.error(`DATA VALIDATION FAILED: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function parseRealDate(value, file, index) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${file} row ${index + 1}: date must be YYYY-MM-DD`);
  }
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    fail(`${file} row ${index + 1}: invalid calendar date ${value}`);
  }
}

function loadAndValidate(file) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(ROOT, "data", file.name), "utf8"));
  } catch (error) {
    fail(`could not parse data/${file.name}: ${error.message}`);
  }
  if (!Array.isArray(rows) || rows.length === 0) fail(`data/${file.name} must be a non-empty array`);
  const seen = new Set();
  let previous = "";
  rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== 10) {
      fail(`data/${file.name} row ${index + 1} must contain a date plus 9 digit positions`);
    }
    parseRealDate(row[0], file.name, index);
    if (seen.has(row[0])) fail(`data/${file.name} contains duplicate date ${row[0]}`);
    if (previous && row[0] <= previous) fail(`data/${file.name} dates must be strictly ascending; issue at ${row[0]}`);
    const slots = [row.slice(1, 4), row.slice(4, 7), row.slice(7, 10)];
    let completedSlots = 0;
    slots.forEach((slot, slotIndex) => {
      if (slot.every((digit) => digit === null)) return; // Explicitly not yet published / not recorded.
      if (slot.some((digit) => !Number.isInteger(digit) || digit < 0 || digit > 9)) {
        fail(`data/${file.name} row ${row[0]} slot ${slotIndex + 1} must contain three valid digits or three nulls`);
      }
      completedSlots++;
    });
    if (completedSlots === 0) {
      fail(`data/${file.name} row ${row[0]} must include at least one complete draw slot`);
    }
    seen.add(row[0]);
    previous = row[0];
  });
  return rows;
}

const oldRows = loadAndValidate(files[0]);
const newRows = loadAndValidate(files[1]);
const oldDates = new Set(oldRows.map((row) => row[0]));
const overlap = newRows.find((row) => oldDates.has(row[0]));
if (overlap) fail(`old/current machine histories overlap on ${overlap[0]}`);
if (oldRows[oldRows.length - 1][0] >= newRows[0][0]) {
  fail("retired-machine date range must end before the current-machine date range begins");
}
if (newRows[newRows.length - 1][0] < "2026-10-27") {
  fail("current-machine snapshot is unexpectedly older than the documented 2026-10-27 refresh");
}

function missingCalendarDays(rows) {
  let missing = 0;
  for (let i = 1; i < rows.length; i++) {
    const prior = Date.parse(`${rows[i - 1][0]}T00:00:00Z`);
    const next = Date.parse(`${rows[i][0]}T00:00:00Z`);
    missing += Math.max(0, Math.round((next - prior) / 86400000) - 1);
  }
  return missing;
}

console.log("DATA VALIDATION PASSED");
console.log(`Retired machine: ${oldRows.length.toLocaleString()} rows, ${oldRows[0][0]} through ${oldRows.at(-1)[0]}, ${missingCalendarDays(oldRows)} unfilled calendar days reported (informational)`);
console.log(`Current machine: ${newRows.length.toLocaleString()} rows, ${newRows[0][0]} through ${newRows.at(-1)[0]}, ${missingCalendarDays(newRows)} unfilled calendar days reported (informational)`);
const partialDays = newRows.filter((row) =>
  [row.slice(1, 4), row.slice(4, 7), row.slice(7, 10)].some((slot) => slot.every((digit) => digit === null))
).length;
console.log(`Current-machine records with at least one unreported slot: ${partialDays.toLocaleString()}`);
console.log(`Combined: ${(oldRows.length + newRows.length).toLocaleString()} unique dated rows; each slot is three valid digits or an explicit null triplet.`);
