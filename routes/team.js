// routes/team.js
//
// Powers the "Meet the Team" section. Admin can add/edit/delete members and
// upload a photo for each — everything shows up on the site immediately
// since the homepage fetches this list live (see loadTeam() in index.html).

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `team-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, WEBP, or GIF images are allowed.'), ok);
  },
});

function deletePhotoFile(photoUrl) {
  if (!photoUrl || !photoUrl.startsWith('/uploads/')) return;
  const filePath = path.join(UPLOADS_DIR, path.basename(photoUrl));
  fs.unlink(filePath, () => {}); // best-effort, ignore errors
}

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('');
}

// GET /api/team — public. Only active members, in display order.
router.get('/', (req, res) => {
  const all = db.readTable('team');
  const active = all
    .filter((m) => m.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  res.json({ team: active });
});

// GET /api/team/all — admin only. Includes inactive members.
router.get('/all', requireAdmin, (req, res) => {
  const all = db.readTable('team').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  res.json({ team: all });
});

// POST /api/team — admin only. multipart/form-data with an optional "photo" file.
router.post('/', requireAdmin, upload.single('photo'), (req, res) => {
  const { name, role, bio } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  const all = db.readTable('team');
  const maxOrder = all.reduce((max, m) => Math.max(max, m.order ?? 0), 0);

  const member = db.insert('team', {
    name: name.trim(),
    role: (role || '').trim() || 'Team Member',
    bio: (bio || '').trim(),
    photoUrl: req.file ? `/uploads/${req.file.filename}` : null,
    initials: initials(name),
    active: true,
    order: maxOrder + 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  res.status(201).json({ member });
});

// PUT /api/team/:id — admin only. Optionally replaces the photo.
router.put('/:id', requireAdmin, upload.single('photo'), (req, res) => {
  const existing = db.findById('team', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Team member not found.' });

  const { name, role, bio, active, order } = req.body || {};
  const patch = { updatedAt: new Date().toISOString() };

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'Name is required.' });
    patch.name = name.trim();
    patch.initials = initials(name);
  }
  if (role !== undefined) patch.role = role.trim() || 'Team Member';
  if (bio !== undefined) patch.bio = bio.trim();
  if (active !== undefined) patch.active = active === 'true' || active === true;
  if (order !== undefined && !Number.isNaN(Number(order))) patch.order = Number(order);

  if (req.file) {
    deletePhotoFile(existing.photoUrl);
    patch.photoUrl = `/uploads/${req.file.filename}`;
  }

  const member = db.update('team', req.params.id, patch);
  res.json({ member });
});

// DELETE /api/team/:id — admin only. Also removes the uploaded photo file.
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.findById('team', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Team member not found.' });
  deletePhotoFile(existing.photoUrl);
  db.remove('team', req.params.id);
  res.json({ success: true });
});

module.exports = router;
