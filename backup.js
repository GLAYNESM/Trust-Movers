// backup.js
//
// Zips up server/data/*.json and server/uploads/* into a timestamped file
// under server/backups/. Runs automatically once a day (see server.js) and
// can also be triggered on demand from the admin panel.
//
// Keeps the last KEEP_COUNT backups and deletes older ones automatically,
// so this doesn't quietly fill up the disk over months of running.

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const BACKUPS_DIR = path.join(__dirname, 'backups');
const KEEP_COUNT = 14;

if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Creates a new backup zip and returns its filename. Resolves once the
// file is fully written to disk.
function createBackup() {
  return new Promise((resolve, reject) => {
    const filename = `backup-${timestampForFilename()}.zip`;
    const filePath = path.join(BACKUPS_DIR, filename);
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(filename));
    archive.on('error', reject);
    archive.on('warning', (err) => console.warn('[backup] warning:', err.message));

    archive.pipe(output);
    if (fs.existsSync(DATA_DIR)) archive.directory(DATA_DIR, 'data');
    if (fs.existsSync(UPLOADS_DIR)) archive.directory(UPLOADS_DIR, 'uploads');
    archive.finalize();
  });
}

// Deletes everything past the newest KEEP_COUNT backup files.
function pruneOldBackups() {
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
    .map((f) => ({ name: f, time: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  files.slice(KEEP_COUNT).forEach((f) => {
    fs.unlink(path.join(BACKUPS_DIR, f.name), () => {});
  });
}

async function runScheduledBackup() {
  try {
    const filename = await createBackup();
    pruneOldBackups();
    console.log(`[backup] Created ${filename}`);
    return filename;
  } catch (err) {
    console.error('[backup] Failed to create backup:', err.message);
    throw err;
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, f));
      return { filename: f, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { createBackup, pruneOldBackups, runScheduledBackup, listBackups, BACKUPS_DIR };
