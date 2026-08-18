// routes/backups.js
//
// Admin-only endpoints for the "Backups" section of the admin panel:
// trigger one on demand, list what's available, download one.

const express = require('express');
const path = require('path');
const { requireAdmin } = require('../middleware/auth');
const { runScheduledBackup, listBackups, BACKUPS_DIR } = require('../backup');

const router = express.Router();

// GET /api/backups — list available backups, newest first.
router.get('/', requireAdmin, (req, res) => {
  res.json({ backups: listBackups() });
});

// POST /api/backups — create a new backup right now.
router.post('/', requireAdmin, async (req, res) => {
  try {
    const filename = await runScheduledBackup();
    res.status(201).json({ filename });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create backup.' });
  }
});

// GET /api/backups/:filename — download a specific backup zip.
router.get('/:filename', requireAdmin, (req, res) => {
  // Guard against path traversal — only allow the exact expected filename shape.
  if (!/^backup-[\w-]+\.zip$/.test(req.params.filename)) {
    return res.status(400).json({ error: 'Invalid backup filename.' });
  }
  const filePath = path.join(BACKUPS_DIR, req.params.filename);
  res.download(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'Backup not found.' });
    }
  });
});

module.exports = router;
