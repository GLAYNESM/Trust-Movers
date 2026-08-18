// db.js
//
// A tiny file-based data layer. It stores each "table" as a JSON array in
// server/data/<table>.json. This keeps the project dependency-free (no
// database server to install) which is ideal for a small business site
// running on a single server.
//
// Swapping to a real database later only means rewriting the functions in
// this file (readTable/writeTable/insert/update/remove) — every route file
// only ever talks to this module, never to the filesystem directly.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(table) {
  return path.join(DATA_DIR, `${table}.json`);
}

function readTable(table) {
  const file = filePath(table);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '[]', 'utf8');
    return [];
  }
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[db] Failed to parse ${table}.json — starting from an empty table.`, err);
    return [];
  }
}

function writeTable(table, rows) {
  const file = filePath(table);
  // Write to a temp file first, then rename — avoids a half-written file
  // if the process is killed mid-write.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function nextId() {
  return crypto.randomUUID();
}

function insert(table, row) {
  const rows = readTable(table);
  const withId = { id: nextId(), ...row };
  rows.push(withId);
  writeTable(table, rows);
  return withId;
}

function update(table, id, patch) {
  const rows = readTable(table);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch, id };
  writeTable(table, rows);
  return rows[idx];
}

function remove(table, id) {
  const rows = readTable(table);
  const next = rows.filter((r) => r.id !== id);
  const changed = next.length !== rows.length;
  if (changed) writeTable(table, next);
  return changed;
}

function findById(table, id) {
  return readTable(table).find((r) => r.id === id) || null;
}

// ── Singleton storage ────────────────────────────────────────────────────
// For single-object "tables" like settings or live-location — stored as one
// JSON object per file instead of an array of rows.

function readSingleton(name, defaults = {}) {
  const file = filePath(name);
  if (!fs.existsSync(file)) {
    writeSingleton(name, defaults);
    return { ...defaults };
  }
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return { ...defaults };
  try {
    return { ...defaults, ...JSON.parse(raw) };
  } catch (err) {
    console.error(`[db] Failed to parse ${name}.json — using defaults.`, err);
    return { ...defaults };
  }
}

function writeSingleton(name, data) {
  const file = filePath(name);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return data;
}

module.exports = { readTable, writeTable, insert, update, remove, findById, nextId, readSingleton, writeSingleton };
