// middleware/auth.js
//
// requireAuth   -> the request must have a valid login token (any role)
// requireAdmin  -> the request must have a valid login token AND role === 'admin'
//
// The token is read from the "Authorization: Bearer <token>" header, which
// is what the frontend sends (see public/index.html and public/admin.html).

const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

function getTokenFromHeader(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) return token;
  return null;
}

function requireAuth(req, res, next) {
  const token = getTokenFromHeader(req);
  if (!token) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // If the password has changed since this token was issued, treat it as
    // expired — this is what makes "change my password" actually revoke any
    // other logged-in session/device instead of leaving old tokens valid for
    // up to 30 days. Uses an exact integer version number rather than
    // comparing timestamps, since JWT "iat" only has second-level precision
    // and a login + password change within the same second would otherwise
    // be ambiguous. Tokens signed before this feature existed carry no
    // tokenVersion claim at all — treated as version 0, same as a user who's
    // never changed their password, so nobody gets forced to re-log-in by
    // this update alone.
    const user = db.findById('users', payload.id);
    if (!user) {
      return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
    }
    if ((payload.tokenVersion || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Your password was changed. Please log in again.' });
    }

    req.user = payload; // { id, email, name, role, iat, exp }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin, JWT_SECRET };
