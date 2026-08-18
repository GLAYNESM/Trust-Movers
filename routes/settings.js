// routes/settings.js
//
// One small settings object the admin can edit from /admin.html — right now
// that's mainly the WhatsApp number the site's chat widget sends messages to.
//
// A couple of "advanced" fields (whatsappApiToken / whatsappPhoneNumberId)
// are here too for people who set up a real Meta WhatsApp Business Cloud
// API account later — see README for what that unlocks and what it needs.

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const DEFAULTS = {
  whatsappNumber: '',           // e.g. "15551234567" — digits only, country code, no + or spaces
  whatsappApiToken: '',         // optional: Meta Cloud API permanent access token
  whatsappPhoneNumberId: '',    // optional: Meta Cloud API phone_number_id
  whatsappWebhookVerifyToken: '', // optional: string you also set in Meta's webhook config
  googleClientId: '',           // OAuth Client ID from Google Cloud Console — public by design, safe to expose
};

// Fields safe to expose to any visitor (needed so the on-site chat widget
// knows which WhatsApp number to message, and so "Sign in with Google" can
// initialize — OAuth Client IDs are meant to be public, unlike API secrets).
const PUBLIC_FIELDS = ['whatsappNumber', 'googleClientId'];

// GET /api/settings — public, limited fields only.
router.get('/', (req, res) => {
  const all = db.readSingleton('settings', DEFAULTS);
  const publicSettings = {};
  PUBLIC_FIELDS.forEach((f) => { publicSettings[f] = all[f]; });
  res.json({ settings: publicSettings });
});

// GET /api/settings/all — admin only, everything including API credentials.
router.get('/all', requireAdmin, (req, res) => {
  const all = db.readSingleton('settings', DEFAULTS);
  res.json({ settings: all });
});

// PUT /api/settings — admin only.
router.put('/', requireAdmin, (req, res) => {
  const current = db.readSingleton('settings', DEFAULTS);
  const body = req.body || {};
  const next = { ...current };

  if ('whatsappNumber' in body) {
    // Strip everything except digits so wa.me links always work regardless
    // of how the admin typed it in (spaces, dashes, +, etc.).
    next.whatsappNumber = String(body.whatsappNumber || '').replace(/[^\d]/g, '');
  }
  if ('whatsappApiToken' in body) next.whatsappApiToken = String(body.whatsappApiToken || '').trim();
  if ('whatsappPhoneNumberId' in body) next.whatsappPhoneNumberId = String(body.whatsappPhoneNumberId || '').trim();
  if ('whatsappWebhookVerifyToken' in body) next.whatsappWebhookVerifyToken = String(body.whatsappWebhookVerifyToken || '').trim();
  if ('googleClientId' in body) next.googleClientId = String(body.googleClientId || '').trim();

  db.writeSingleton('settings', next);
  res.json({ settings: next });
});

module.exports = router;
