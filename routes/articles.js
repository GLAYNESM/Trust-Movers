// routes/articles.js
//
// Backs the Resources section on the homepage. Anyone can read published
// articles; only an admin account can create, edit, publish, or delete one.
// This is what replaces the old hard-coded pricing/resource cards — the
// admin now manages this content from /admin.html instead of editing HTML.
//
// Articles can carry an uploaded cover image and/or a video URL (YouTube,
// Vimeo, or a direct file link) — both optional.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const ALLOWED_ICONS = new Set([
  'package', 'clipboard-list', 'tag', 'key-round', 'truck', 'box',
  'calendar', 'map-pin', 'home', 'shield-check', 'wallet', 'sparkles',
]);

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `article-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, WEBP, or GIF images are allowed.'), ok);
  },
});

function deleteImageFile(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) return;
  const filePath = path.join(UPLOADS_DIR, path.basename(imageUrl));
  fs.unlink(filePath, () => {}); // best-effort, ignore errors
}

// Coerces a value that might be a real boolean (JSON) or a string (form-data)
// into an actual boolean, without the "Boolean('false') === true" trap.
function toBool(value) {
  return value === true || value === 'true';
}

function sanitizeArticleInput(body, { partial = false } = {}) {
  const out = {};
  const fields = ['title', 'tag', 'excerpt', 'content', 'icon', 'gradientFrom', 'gradientTo', 'published', 'videoUrl'];

  for (const field of fields) {
    if (!partial || field in body) {
      out[field] = body[field];
    }
  }

  if ('title' in out && (!out.title || !out.title.trim())) {
    throw new Error('Title is required.');
  }
  if ('tag' in out && !out.tag) out.tag = 'General';
  if ('icon' in out && !ALLOWED_ICONS.has(out.icon)) out.icon = 'package';
  if ('gradientFrom' in out && !out.gradientFrom) out.gradientFrom = '#1a0508';
  if ('gradientTo' in out && !out.gradientTo) out.gradientTo = '#2a0a10';
  if ('published' in out) out.published = toBool(out.published);
  if ('videoUrl' in out) out.videoUrl = (out.videoUrl || '').trim();

  return out;
}

// GET /api/articles — public. Returns only published articles, newest first.
router.get('/', (req, res) => {
  const all = db.readTable('articles');
  const published = all
    .filter((a) => a.published)
    .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
  res.json({ articles: published });
});

// POST /api/articles/resolve-video-url — admin only.
// TikTok's mobile "Share" button gives a shortened link (vm.tiktok.com/vt.tiktok.com)
// that doesn't contain the video ID — only the destination after following its
// redirect does. This follows that redirect server-side (the browser can't, due
// to CORS) so the saved article ends up with a link that actually embeds.
router.post('/resolve-video-url', requireAdmin, async (req, res) => {
  const { url: rawUrl } = req.body || {};
  if (!rawUrl) return res.status(400).json({ error: 'Missing url.' });

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  const shortLinkHosts = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
  const needsResolving = shortLinkHosts.has(parsed.hostname) || parsed.pathname.startsWith('/t/');
  if (!needsResolving) {
    return res.json({ resolvedUrl: rawUrl });
  }

  try {
    const response = await fetch(rawUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        // Some servers (TikTok included) block or misbehave for requests
        // without a browser-like User-Agent.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    if (!response.url || response.url === rawUrl) {
      console.warn(`[articles] Link resolution for ${rawUrl} didn't redirect anywhere new — TikTok may be blocking the request.`);
    }
    res.json({ resolvedUrl: response.url || rawUrl });
  } catch (err) {
    console.error(`[articles] Failed to resolve short link ${rawUrl}:`, err.message);
    // If resolution fails for any reason, hand back the original rather than
    // blocking the save — worst case the video just won't preview.
    res.json({ resolvedUrl: rawUrl });
  }
});

// GET /api/articles/all — admin only. Includes drafts, for the admin panel.
router.get('/all', requireAdmin, (req, res) => {
  const all = db
    .readTable('articles')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ articles: all });
});

// GET /api/articles/:id — public if published, admin can view drafts too.
router.get('/:id', (req, res) => {
  const article = db.findById('articles', req.params.id);
  if (!article) return res.status(404).json({ error: 'Article not found.' });
  if (!article.published) {
    return res.status(404).json({ error: 'Article not found.' });
  }
  res.json({ article });
});

// POST /api/articles — admin only. multipart/form-data with an optional "image" file.
router.post('/', requireAdmin, upload.single('image'), (req, res) => {
  try {
    const data = sanitizeArticleInput(req.body || {});
    if (!data.title) return res.status(400).json({ error: 'Title is required.' });

    const now = new Date().toISOString();
    const article = db.insert('articles', {
      title: data.title.trim(),
      tag: data.tag || 'General',
      excerpt: data.excerpt || '',
      content: data.content || '',
      icon: data.icon || 'package',
      gradientFrom: data.gradientFrom || '#1a0508',
      gradientTo: data.gradientTo || '#2a0a10',
      videoUrl: data.videoUrl || '',
      imageUrl: req.file ? `/uploads/${req.file.filename}` : '',
      published: toBool(data.published),
      author: req.user.name,
      createdAt: now,
      updatedAt: now,
      publishedAt: toBool(data.published) ? now : null,
    });
    res.status(201).json({ article });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/articles/:id — admin only. Optionally replaces the cover image.
router.put('/:id', requireAdmin, upload.single('image'), (req, res) => {
  const existing = db.findById('articles', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Article not found.' });

  try {
    const data = sanitizeArticleInput(req.body || {}, { partial: true });
    const wasPublished = existing.published;
    const patch = { ...data, updatedAt: new Date().toISOString() };

    // Stamp publishedAt the first time an article goes live.
    if (data.published && !wasPublished) {
      patch.publishedAt = new Date().toISOString();
    }

    if (req.file) {
      deleteImageFile(existing.imageUrl);
      patch.imageUrl = `/uploads/${req.file.filename}`;
    } else if (req.body.removeImage === 'true') {
      deleteImageFile(existing.imageUrl);
      patch.imageUrl = '';
    }

    const article = db.update('articles', req.params.id, patch);
    res.json({ article });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/articles/:id — admin only. Also removes any uploaded image.
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.findById('articles', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Article not found.' });
  deleteImageFile(existing.imageUrl);
  db.remove('articles', req.params.id);
  res.json({ success: true });
});

module.exports = router;
