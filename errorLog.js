// errorLog.js
//
// A minimal error log so you're not flying blind in production without
// paying for a service like Sentry. Every server error gets a timestamped
// line in server/logs/errors.log, in addition to the console. If you later
// want a real error-tracking service, this is the file to wire it into —
// just add the SDK's capture call alongside the existing logging below.

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'errors.log');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function logError(context, err) {
  const line = `[${new Date().toISOString()}] ${context}: ${err?.stack || err?.message || err}\n`;
  console.error(line.trim());
  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // If we can't even write the log, there's nothing more useful to do here.
  }
}

// Express error-handling middleware — must be registered last, after all routes.
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // A client sending broken JSON is a bad request, not a server failure —
  // don't count/log these as if something on our end is actually wrong.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Malformed request body.' });
  }

  logError(`${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
}

module.exports = { logError, errorHandler, LOG_FILE };
