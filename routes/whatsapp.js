// routes/whatsapp.js
//
// Two separate things live here:
//
// 1. Chat widget capture (POST /api/chat-messages) — every message a
//    visitor sends from the on-site chat widget is logged here so the admin
//    always has a record, even if the visitor never finishes sending it on
//    WhatsApp itself. If a real Meta WhatsApp Business Cloud API token is
//    configured in Settings, it ALSO tries to silently deliver the message
//    straight to your WhatsApp — no extra tap needed. Without that token,
//    the frontend falls back to opening a wa.me link so the visitor's own
//    WhatsApp sends it to your number.
//
// 2. The Meta webhook (GET+POST /api/whatsapp/webhook) — this is what a
//    real WhatsApp Business Cloud API account would call when someone
//    (e.g. your driver) sends a message TO your business number. We look
//    for "location" messages specifically and use them to update the live
//    tracking shown on the dashboard. This half requires your own Meta
//    Business setup — see README.md — it does nothing until that's in place.

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { honeypot } = require('../middleware/honeypot');
const { publicFormLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const SETTINGS_DEFAULTS = {
  whatsappNumber: '',
  whatsappApiToken: '',
  whatsappPhoneNumberId: '',
  whatsappWebhookVerifyToken: '',
};

const LOCATION_DEFAULTS = {
  progressPercent: 30,
  statusText: 'In Transit',
  etaText: '2h 15m',
  lat: null,
  lng: null,
  source: 'manual',
  updatedAt: new Date().toISOString(),
};

// Tries a real, silent send via the Meta Cloud API. Returns true if it
// actually went out, false if not configured or the call failed.
async function trySilentSend(toNumber, text) {
  const settings = db.readSingleton('settings', SETTINGS_DEFAULTS);
  if (!settings.whatsappApiToken || !settings.whatsappPhoneNumberId || !toNumber) {
    return false;
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${settings.whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.whatsappApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toNumber,
          type: 'text',
          text: { body: text },
        }),
      }
    );
    if (!res.ok) {
      const errBody = await res.text();
      console.error('[whatsapp] Cloud API send failed:', res.status, errBody);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[whatsapp] Cloud API send error:', err.message);
    return false;
  }
}

// POST /api/chat-messages — public, the on-site chat widget calls this.
router.post('/chat-messages', publicFormLimiter, honeypot(), async (req, res) => {
  if (req.isSpam) {
    return res.status(201).json({ sentViaApi: false, whatsappNumber: null });
  }

  const { name, message } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Please enter a message.' });
  }

  const settings = db.readSingleton('settings', SETTINGS_DEFAULTS);

  const record = db.insert('chatMessages', {
    name: (name || '').trim() || 'Website visitor',
    message: message.trim(),
    sentViaApi: false,
    createdAt: new Date().toISOString(),
  });

  const sentViaApi = await trySilentSend(
    settings.whatsappNumber,
    `New website chat from ${record.name}:\n${record.message}`
  );

  if (sentViaApi) {
    db.update('chatMessages', record.id, { sentViaApi: true });
  }

  res.status(201).json({
    sentViaApi,
    whatsappNumber: settings.whatsappNumber || null,
  });
});

// GET /api/chat-messages — admin only, view captured chat inquiries.
router.get('/chat-messages', requireAdmin, (req, res) => {
  const messages = db
    .readTable('chatMessages')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ messages });
});

// ── Meta WhatsApp Business Cloud API webhook ─────────────────────────────
// Does nothing useful until you've set up a real Meta app — see README.

// GET — verification handshake Meta performs once when you save the webhook URL.
router.get('/whatsapp/webhook', (req, res) => {
  const settings = db.readSingleton('settings', SETTINGS_DEFAULTS);
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && settings.whatsappWebhookVerifyToken && token === settings.whatsappWebhookVerifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// POST — actual incoming message events.
router.post('/whatsapp/webhook', (req, res) => {
  // Always ACK fast — Meta retries (and can disable the webhook) if you're slow or non-200.
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const messages = change?.value?.messages;
    if (!messages || !messages.length) return;

    for (const msg of messages) {
      if (msg.type === 'location' && msg.location) {
        const current = db.readSingleton('location', LOCATION_DEFAULTS);
        db.writeSingleton('location', {
          ...current,
          lat: msg.location.latitude,
          lng: msg.location.longitude,
          statusText: msg.location.name || msg.location.address || 'Location shared via WhatsApp',
          source: 'whatsapp',
          updatedAt: new Date().toISOString(),
        });
        console.log('[whatsapp] Live location updated from WhatsApp message:', msg.location);
      }
    }
  } catch (err) {
    console.error('[whatsapp] Failed to process webhook payload:', err.message);
  }
});

module.exports = router;
