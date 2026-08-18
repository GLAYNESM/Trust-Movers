// routes/auth.js
//
// Powers the single combined "Login / Sign Up" button in the nav, plus
// "Forgot password?", the in-app account settings (change email/password),
// and "Sign in with Google".

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const mailer = require('../mailer');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { honeypot } = require('../middleware/honeypot');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, tokenVersion: user.tokenVersion || 0 },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(user) {
  const { passwordHash, resetTokenHash, resetTokenExpiresAt, ...safe } = user;
  return safe;
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// POST /api/auth/register
router.post('/register', authLimiter, honeypot(), async (req, res) => {
  if (req.isSpam) {
    return res.status(400).json({ error: 'Something went wrong. Please try again.' });
  }

  const { name, email, password } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const users = db.readTable('users');
  const exists = users.some((u) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'An account with that email already exists. Try logging in instead.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = db.insert('users', {
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    authProvider: 'password',
    role: 'customer',
    createdAt: new Date().toISOString(),
  });

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: 'Please enter your email and password.' });
  }

  const users = db.readTable('users');
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (!user.passwordHash) {
    return res.status(401).json({ error: 'This account signs in with Google. Use the "Sign in with Google" button instead.' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

// POST /api/auth/google — verifies a Google ID token, then finds or creates
// a matching account. Only ever creates 'customer' role accounts, never
// 'admin' — admin access can't be self-granted through this path.
router.post('/google', authLimiter, async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });

  const settings = db.readSingleton('settings', {});
  if (!settings.googleClientId) {
    return res.status(400).json({ error: 'Google sign-in is not set up for this site yet.' });
  }

  try {
    const client = new OAuth2Client(settings.googleClientId);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: settings.googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.email) throw new Error('No email in Google response.');

    const email = payload.email.toLowerCase();
    const name = payload.name || email.split('@')[0];

    const users = db.readTable('users');
    let user = users.find((u) => u.email.toLowerCase() === email);
    if (!user) {
      user = db.insert('users', {
        name,
        email,
        passwordHash: null,
        authProvider: 'google',
        role: 'customer',
        createdAt: new Date().toISOString(),
      });
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('[auth] Google sign-in failed:', err.message);
    res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

// GET /api/auth/me — used on page load to check if a saved token is still valid
router.get('/me', requireAuth, (req, res) => {
  const user = db.findById('users', req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  res.json({ user: publicUser(user) });
});

// POST /api/auth/forgot-password — always responds the same way whether or
// not the email exists, so a stranger can't use this to find out which
// emails have accounts here.
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body || {};
  const genericMessage = "If an account exists for that email, we've sent a password reset link.";

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const users = db.readTable('users');
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());

  if (user && user.passwordHash) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    db.update('users', user.id, {
      resetTokenHash: hashToken(rawToken),
      resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString(),
    });

    const origin = `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${origin}/reset-password.html?token=${rawToken}`;
    const firstName = (user.name || '').trim().split(/\s+/)[0] || 'there';

    try {
      await mailer.sendMail({
        to: user.email,
        subject: 'Reset your Trust password',
        html: `<p>Hi ${firstName},</p><p>Click below to reset your password. This link expires in 1 hour and can only be used once.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
        text: `Hi ${firstName},\n\nReset your password here (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
      });
    } catch (err) {
      console.error('[auth] Failed to send password reset email:', err.message);
      // Still respond with the generic message — don't leak whether it worked.
    }
  }

  res.json({ message: genericMessage });
});

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body || {};

  if (!token) {
    return res.status(400).json({ error: 'Missing or invalid reset link.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const tokenHash = hashToken(token);
  const users = db.readTable('users');
  const user = users.find((u) => u.resetTokenHash === tokenHash);

  if (!user || !user.resetTokenExpiresAt || new Date(user.resetTokenExpiresAt) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  db.update('users', user.id, {
    passwordHash,
    passwordChangedAt: new Date().toISOString(),
    tokenVersion: (user.tokenVersion || 0) + 1,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  });

  res.json({ message: 'Your password has been reset. You can now log in.' });
});

// PUT /api/auth/account — change your own email and/or password. Requires
// the current password so a hijacked-but-unlocked browser tab can't be used
// to silently take over the account.
router.put('/account', authLimiter, requireAuth, async (req, res) => {
  const { currentPassword, newEmail, newPassword } = req.body || {};

  if (!newEmail && !newPassword) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  const user = db.findById('users', req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  if (!user.passwordHash) {
    return res.status(400).json({ error: 'This account signs in with Google and has no password to confirm with.' });
  }
  if (!currentPassword) {
    return res.status(400).json({ error: 'Please enter your current password to confirm this change.' });
  }
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const patch = {};

  if (newEmail && newEmail.toLowerCase().trim() !== user.email.toLowerCase()) {
    if (!isValidEmail(newEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    const users = db.readTable('users');
    const taken = users.some((u) => u.id !== user.id && u.email.toLowerCase() === newEmail.toLowerCase());
    if (taken) {
      return res.status(409).json({ error: 'Another account already uses that email.' });
    }
    patch.email = newEmail.toLowerCase().trim();
  }

  if (newPassword) {
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    patch.passwordHash = await bcrypt.hash(newPassword, 10);
    patch.passwordChangedAt = new Date().toISOString();
    patch.tokenVersion = (user.tokenVersion || 0) + 1;
  }

  const updated = db.update('users', user.id, patch);

  // Issue a fresh token — if the password changed, the old token is now
  // invalid (see middleware/auth.js), so the person making the change would
  // otherwise get logged out immediately after their own password change.
  const token = signToken(updated);
  res.json({ token, user: publicUser(updated), message: 'Account updated.' });
});

module.exports = router;
