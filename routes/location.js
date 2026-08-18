// routes/location.js
//
// Backs the "My Move Dashboard" live tracking panel. The homepage polls
// GET /api/location every second, so any change here — whether typed in by
// the admin or pushed automatically from the WhatsApp webhook (see
// routes/whatsapp.js) — shows up on the site within a second.

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const DEFAULTS = {
  progressPercent: 30,
  statusText: 'In Transit',
  etaText: '2h 15m',
  lat: null,
  lng: null,
  accuracy: null, // meters — how precise the browser says the GPS fix was
  source: 'manual', // 'manual' | 'gps' | 'whatsapp'
  updatedAt: new Date().toISOString(),
};

// GET /api/location — public, polled every second by the dashboard.
router.get('/', (req, res) => {
  res.json({ location: db.readSingleton('location', DEFAULTS) });
});

const ALLOWED_SOURCES = new Set(['manual', 'gps', 'whatsapp']);

// PUT /api/location — admin only. Used both by the manual "Update" form and
// by the live GPS-sharing button (which sends source: 'gps').
router.put('/', requireAdmin, (req, res) => {
  const current = db.readSingleton('location', DEFAULTS);
  const { progressPercent, statusText, etaText, lat, lng, accuracy, source } = req.body || {};
  const next = { ...current, updatedAt: new Date().toISOString() };

  next.source = ALLOWED_SOURCES.has(source) ? source : 'manual';

  if (progressPercent !== undefined) {
    const n = Number(progressPercent);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: 'Progress must be a number between 0 and 100.' });
    }
    next.progressPercent = n;
  }
  if (statusText !== undefined) next.statusText = String(statusText).slice(0, 120);
  if (etaText !== undefined) next.etaText = String(etaText).slice(0, 40);
  if (lat !== undefined) {
    const n = lat === '' || lat === null ? null : Number(lat);
    if (n !== null && (Number.isNaN(n) || n < -90 || n > 90)) {
      return res.status(400).json({ error: 'Latitude must be between -90 and 90.' });
    }
    next.lat = n;
  }
  if (lng !== undefined) {
    const n = lng === '' || lng === null ? null : Number(lng);
    if (n !== null && (Number.isNaN(n) || n < -180 || n > 180)) {
      return res.status(400).json({ error: 'Longitude must be between -180 and 180.' });
    }
    next.lng = n;
  }
  if (accuracy !== undefined) {
    const n = accuracy === '' || accuracy === null ? null : Number(accuracy);
    next.accuracy = n !== null && !Number.isNaN(n) ? n : null;
  }

  db.writeSingleton('location', next);
  res.json({ location: next });
});

module.exports = router;
