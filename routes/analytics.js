// routes/analytics.js
//
// A minimal, privacy-respecting, zero-external-account pageview counter.
// Not a replacement for Google Analytics/Plausible if you want deep
// insight later — but it works immediately with nothing to sign up for,
// and doesn't store anything that identifies a specific visitor.

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// We deliberately do NOT store the visitor's IP or any cookie/fingerprint —
// just which page, roughly when, and where they came from. Good enough to
// answer "is anyone visiting, and which pages" without being a tracker.
router.post('/pageview', (req, res) => {
  const { path: pagePath, referrer } = req.body || {};
  if (!pagePath || typeof pagePath !== 'string' || pagePath.length > 200) {
    return res.status(400).json({ error: 'Invalid page path.' });
  }

  db.insert('pageviews', {
    path: pagePath,
    referrer: (referrer || '').slice(0, 200),
    day: new Date().toISOString().slice(0, 10), // YYYY-MM-DD, for daily rollups
    createdAt: new Date().toISOString(),
  });

  res.status(204).end();
});

// GET /api/analytics/summary — admin only.
router.get('/summary', requireAdmin, (req, res) => {
  const views = db.readTable('pageviews');

  const totalViews = views.length;

  const byPage = {};
  views.forEach((v) => { byPage[v.path] = (byPage[v.path] || 0) + 1; });
  const topPages = Object.entries(byPage)
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const byDay = {};
  views.forEach((v) => { byDay[v.day] = (byDay[v.day] || 0) + 1; });
  const last30Days = Object.entries(byDay)
    .map(([day, count]) => ({ day, count }))
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);

  const byReferrer = {};
  views.forEach((v) => {
    const ref = v.referrer ? new URL(v.referrer, 'http://x').hostname || v.referrer : 'Direct';
    byReferrer[ref] = (byReferrer[ref] || 0) + 1;
  });
  const topReferrers = Object.entries(byReferrer)
    .map(([referrer, count]) => ({ referrer, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  res.json({ totalViews, topPages, last30Days, topReferrers });
});

module.exports = router;
