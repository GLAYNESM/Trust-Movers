// server.js — entry point.
//
// Serves the static site (public/) AND the JSON API (/api/...) from one
// process, so there's nothing else to run or configure to see the whole
// thing working: `npm install && npm start`, then open http://localhost:3000

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const db = require('./db');
const { logError, errorHandler } = require('./errorLog');
const { generalLimiter } = require('./middleware/rateLimit');
const { runScheduledBackup } = require('./backup');

const authRoutes = require('./routes/auth');
const articleRoutes = require('./routes/articles');
const quoteRoutes = require('./routes/quotes');
const teamRoutes = require('./routes/team');
const settingsRoutes = require('./routes/settings');
const locationRoutes = require('./routes/location');
const whatsappRoutes = require('./routes/whatsapp');
const analyticsRoutes = require('./routes/analytics');
const backupRoutes = require('./routes/backups');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ── Production safety checks ─────────────────────────────────────────────
// Catches the two most common "forgot to configure this before going live"
// mistakes. In production, a default JWT secret means anyone who reads this
// public repo's source could forge login tokens — so we refuse to start
// rather than run insecurely by accident.
const DEFAULT_JWT_SECRET = 'change-this-to-a-long-random-string';
if (IS_PRODUCTION && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET)) {
  console.error('──────────────────────────────────────────────────────────');
  console.error(' Refusing to start in production with a default JWT_SECRET.');
  console.error(' Set a real random value in your .env file:');
  console.error('   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  console.error('──────────────────────────────────────────────────────────');
  process.exit(1);
}
if (IS_PRODUCTION && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'ChangeMe123!')) {
  console.warn('──────────────────────────────────────────────────────────');
  console.warn(' WARNING: ADMIN_PASSWORD is still the example default.');
  console.warn(' If this is a fresh install, set a real one in .env before');
  console.warn(' anyone else can reach this server, then restart.');
  console.warn('──────────────────────────────────────────────────────────');
}
if (IS_PRODUCTION && !process.env.SMTP_HOST) {
  console.warn('[startup] No SMTP configured — emails will log to console/file instead of sending. See README.');
}

// Catch anything that slips past a route's own try/catch instead of taking
// the whole process down silently.
process.on('unhandledRejection', (err) => logError('unhandledRejection', err));
process.on('uncaughtException', (err) => logError('uncaughtException', err));

// ── Middleware ──────────────────────────────────────────────────────────
// Tells Express how many reverse-proxy hops in front of it to trust when
// reading the X-Forwarded-For header — needed any time this runs behind
// something like Caddy/Nginx, a Cloudflare Tunnel, ngrok, Render, etc.
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// the moment a request arrives through any proxy/tunnel, because it can't
// safely tell which IP in the header to trust.
//   0 (or unset)  — no proxy/tunnel at all, connecting directly.
//   1             — exactly one hop in front (the normal case: Caddy/Nginx,
//                   Cloudflare Tunnel, ngrok, most PaaS hosts).
//   2+            — stacked proxies (rare) — see the README for how to check.
const trustProxySetting = Number(process.env.TRUST_PROXY ?? 1);
app.set('trust proxy', trustProxySetting);

const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
app.use(express.json());

// Standard HTTP security headers (X-Content-Type-Options, X-Frame-Options,
// Referrer-Policy, HSTS when on HTTPS, and more) plus a Content-Security-Policy
// tuned to exactly what this site loads — no more, no less. The site's JS and
// CSS live inline in the HTML rather than separate files, and every button/
// form uses inline onclick/onsubmit/onchange attributes rather than
// addEventListener — so both script-src AND script-src-attr need
// 'unsafe-inline' (helmet defaults script-src-attr to 'none' if it's not set
// explicitly, which silently breaks every onclick/onsubmit on the page —
// that's not a hypothetical, it happened and is why this comment exists).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://accounts.google.com/gsi/client'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com', 'https://*.basemaps.cartocdn.com'],
        frameSrc: [
          'https://www.youtube.com',
          'https://player.vimeo.com',
          'https://www.tiktok.com',
          'https://accounts.google.com',
        ],
        connectSrc: ["'self'", 'https://accounts.google.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // The uploaded team/article photos and the OpenStreetMap iframe are
    // loaded cross-origin-ish (different resource policies) — this keeps
    // helmet's stricter default from blocking those.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);

// ── API routes ──────────────────────────────────────────────────────────
// A general rate limit covers every /api endpoint as a baseline; routes
// that need a stricter limit (login, quotes, chat) add their own on top.
app.use('/api', generalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/location', locationRoutes);
app.use('/api', whatsappRoutes); // exposes /api/chat-messages and /api/whatsapp/webhook
app.use('/api/analytics', analyticsRoutes);
app.use('/api/backups', backupRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Uploaded team photos ─────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Static frontend ─────────────────────────────────────────────────────
// public/ sits directly next to this file — but stay resilient to the older
// layout too (server.js one level down from public/), in case anything still
// expects that shape. Whichever one actually has an index.html wins.
const PUBLIC_DIR_CANDIDATES = [path.join(__dirname, 'public'), path.join(__dirname, '..', 'public')];
const PUBLIC_DIR = PUBLIC_DIR_CANDIDATES.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) || PUBLIC_DIR_CANDIDATES[0];
app.use(express.static(PUBLIC_DIR));

// Fallback 404 for unknown API routes (keep this AFTER the static handler)
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Catches any error a route passed to next(err), or that Express itself
// raised — always registered last. Logs it and returns a safe generic
// message instead of leaking a stack trace to the visitor.
app.use(errorHandler);

// ── Startup: seed an admin account and a couple of sample articles ──────
async function seed() {
  const users = db.readTable('users');
  const hasAdmin = users.some((u) => u.role === 'admin');

  if (!hasAdmin) {
    const email = process.env.ADMIN_EMAIL || 'admin@trustmovers.com';
    const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
    const passwordHash = await bcrypt.hash(password, 10);
    db.insert('users', {
      name: 'Site Admin',
      email: email.toLowerCase(),
      passwordHash,
      role: 'admin',
      createdAt: new Date().toISOString(),
    });
    console.log('──────────────────────────────────────────────────────────');
    console.log(' Created your first admin account:');
    console.log(`   email:    ${email}`);
    console.log(`   password: ${password}`);
    console.log(' Log in at /admin.html, then change this password.');
    console.log('──────────────────────────────────────────────────────────');
  }

  const articles = db.readTable('articles');
  if (articles.length === 0) {
    const now = new Date().toISOString();
    const starter = [
      {
        title: '10 Decluttering Hacks for a Smooth Move',
        tag: 'Packing Tips',
        excerpt: 'Start four weeks out. Donate first, then decide what actually needs to move.',
        content: 'Full article content goes here — edit this from the admin panel.',
        icon: 'package',
        gradientFrom: '#1a0508',
        gradientTo: '#2a0a10',
      },
      {
        title: 'Moving Checklist: A Month-by-Month Guide',
        tag: 'Checklist',
        excerpt: 'Never miss a step, from booking your movers to forwarding your mail.',
        content: 'Full article content goes here — edit this from the admin panel.',
        icon: 'clipboard-list',
        gradientFrom: '#100a1a',
        gradientTo: '#1a0a2a',
      },
      {
        title: 'How to Label Boxes Effectively',
        tag: 'Supplies',
        excerpt: 'Color-coded rooms, fragile flags, and inventory lists — the system that works.',
        content: 'Full article content goes here — edit this from the admin panel.',
        icon: 'tag',
        gradientFrom: '#0a1a10',
        gradientTo: '#0a2a15',
      },
    ];
    starter.forEach((a) =>
      db.insert('articles', {
        ...a,
        published: true,
        author: 'Site Admin',
        createdAt: now,
        updatedAt: now,
        publishedAt: now,
      })
    );
    console.log(`[seed] Added ${starter.length} starter articles to Resources.`);
  }

  const team = db.readTable('team');
  if (team.length === 0) {
    const now = new Date().toISOString();
    const starterTeam = [
      { name: 'Sandra N.', role: 'Lead Mover & Senior Manager' },
      { name: 'Mike S. Geker', role: 'Packing Specialist' },
      { name: 'Luke A. Bri Zer', role: 'Commercial Team Lead' },
      { name: 'Len A. Pouler', role: 'Route & Logistics Manager' },
      { name: 'Sarah C.', role: 'Long-Distance Move Coordinator' },
    ];
    starterTeam.forEach((m, i) =>
      db.insert('team', {
        name: m.name,
        role: m.role,
        bio: '',
        photoUrl: null,
        initials: m.name.trim().split(/\s+/).slice(0, 2).map((p) => p[0].toUpperCase()).join(''),
        active: true,
        order: i + 1,
        createdAt: now,
        updatedAt: now,
      })
    );
    console.log(`[seed] Added ${starterTeam.length} starter team members.`);
  }
}

seed()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Trust Movers server running: http://localhost:${PORT}`);
      console.log(`Admin panel:                 http://localhost:${PORT}/admin.html`);

      // First backup shortly after startup (not blocking the listen call),
      // then once every 24 hours from there.
      setTimeout(() => runScheduledBackup().catch(() => {}), 10_000);
      setInterval(() => runScheduledBackup().catch(() => {}), 24 * 60 * 60 * 1000);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
