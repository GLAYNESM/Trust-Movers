// routes/quotes.js
//
// Captures submissions from the quote bar (hero) and the full quote form
// section, so the "Get a Quote" flow on the homepage actually goes
// somewhere instead of doing nothing. Admin can review leads at
// GET /api/quotes from the admin panel.

const express = require('express');
const db = require('../db');
const mailer = require('../mailer');
const { requireAdmin } = require('../middleware/auth');
const { honeypot } = require('../middleware/honeypot');
const { publicFormLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// POST /api/quotes — public, anyone can submit a quote request.
router.post('/', publicFormLimiter, honeypot(), async (req, res) => {
  if (req.isSpam) {
    // Pretend it worked — don't tip off the bot, don't save anything.
    return res.status(201).json({ message: "Thanks! A move consultant will reach out with your quote shortly." });
  }

  const { name, email, phone, fromZip, toZip, route, date, homeSize, specialItems, serviceType, source } = req.body || {};

  if (!fromZip && !toZip && !route) {
    return res.status(400).json({ error: 'Please share at least a pickup or destination location.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const quote = db.insert('quotes', {
    name: name || null,
    email: email || null,
    phone: phone || null,
    fromZip: fromZip || null,
    toZip: toZip || null,
    route: route || null,
    date: date || null,
    homeSize: homeSize || null,
    specialItems: specialItems || null,
    serviceType: serviceType || null,
    source: source || 'quote-form',
    status: 'new',
    emailedAt: null,
    createdAt: new Date().toISOString(),
  });

  let message = "Thanks! A move consultant will reach out with your quote shortly.";

  // If the client gave us an email, confirm the booking right away — the
  // actual price comes later from a consultant, not this automated email.
  if (email) {
    try {
      const { subject, html, text } = mailer.buildBookingConfirmationEmail(quote);
      await mailer.sendMail({ to: email, subject, html, text });
      db.update('quotes', quote.id, { emailedAt: new Date().toISOString() });
      message = `Thanks! We've sent a booking confirmation to ${email} — a consultant will follow up soon with your quote.`;
    } catch (err) {
      console.error('[quotes] Failed to send booking confirmation email:', err.message);
      // Don't fail the request — the lead is still captured either way.
    }
  }

  res.status(201).json({ quote, message });
});

// GET /api/quotes — admin only, for reviewing leads in the admin panel.
router.get('/', requireAdmin, (req, res) => {
  const quotes = db
    .readTable('quotes')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ quotes });
});

// PATCH /api/quotes/:id — admin only, to mark a lead as contacted/closed.
router.patch('/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const allowed = ['new', 'contacted', 'booked', 'closed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
  }
  const quote = db.update('quotes', req.params.id, { status });
  if (!quote) return res.status(404).json({ error: 'Quote not found.' });
  res.json({ quote });
});

module.exports = router;
