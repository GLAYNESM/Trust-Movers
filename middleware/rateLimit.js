// middleware/rateLimit.js
//
// Basic abuse protection. Without this, the login/register/quote/chat
// endpoints could be hit as fast as a script can send requests — this
// caps how often the same IP can call them.
//
// Limits are intentionally generous for real visitors and strict for
// scripted abuse. Tune the numbers below if they ever feel wrong in
// practice — there's nothing magic about them.

const rateLimit = require('express-rate-limit');

// The homepage dashboard polls GET /api/location once per second by design
// (that's what makes live tracking "live") — over a 15-minute window that's
// up to 900 requests from a single visitor's browser tab alone, which used
// to blow straight through the general limit below and then take team/
// articles/even admin login down with it, since they shared the same
// per-IP budget. This is a safe, cheap, read-only, public endpoint with no
// real abuse value, so it's exempted from the shared budget entirely
// rather than raising the shared limit to accommodate it.
function isExemptFromGeneralLimit(req) {
  return req.method === 'GET' && req.path === '/location';
}

// A gentle safety net across the whole API. Sized with real background
// polling in mind (the location endpoint above is exempt, but the admin
// panel's own 20-second auto-refresh for quotes/chat, plus normal usage,
// still draws from this budget) — generous for a real browsing session,
// still meaningfully caps a script hammering the API.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isExemptFromGeneralLimit,
  message: { error: 'Too many requests. Please try again shortly.' },
});

// Login/register — the classic brute-force target. Counts failed AND
// successful attempts the same way (simplest, safest default).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Public forms that send an email/WhatsApp message or write a lead —
// generous enough for a real visitor to retry a typo, strict enough to
// stop a script from flooding your inbox or WhatsApp.
const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this device. Please try again later.' },
});

module.exports = { generalLimiter, authLimiter, publicFormLimiter };
