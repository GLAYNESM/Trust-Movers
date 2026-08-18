// mailer.js
//
// Sends the booking-confirmation email to a client after they submit the
// quote form, and the password-reset email. Reads SMTP settings from .env.
//
// If no SMTP_HOST is configured, it runs in "mock mode": instead of failing,
// it logs the email to the console and appends it to data/sent-emails.log so
// you can see exactly what would have been sent — handy for testing locally
// before you have real email credentials.

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const MOCK_LOG = path.join(__dirname, 'data', 'sent-emails.log');

function isConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587/25
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

function fromField() {
  const name = process.env.MAIL_FROM_NAME || 'Trust';
  const email = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER || 'no-reply@trustmovers.com';
  return `"${name}" <${email}>`;
}

async function sendMail({ to, subject, html, text }) {
  if (!isConfigured()) {
    const entry = `\n[${new Date().toISOString()}] MOCK EMAIL (no SMTP_HOST set in .env — not actually sent)\nTo: ${to}\nSubject: ${subject}\n${text}\n${'─'.repeat(60)}\n`;
    console.log(entry);
    try {
      fs.mkdirSync(path.dirname(MOCK_LOG), { recursive: true });
      fs.appendFileSync(MOCK_LOG, entry, 'utf8');
    } catch { /* non-fatal — logging only */ }
    return { mocked: true };
  }

  const info = await getTransporter().sendMail({
    from: fromField(),
    to,
    subject,
    html,
    text,
  });
  return { mocked: false, messageId: info.messageId };
}

const EMAIL_HEADER = `
  <div style="background:#0A0A0A;padding:28px 32px">
    <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:0.5px;font-family:Helvetica,Arial,sans-serif">TRUST</span>
    <div style="color:#C1121F;font-size:10px;font-weight:700;letter-spacing:3px;font-family:Helvetica,Arial,sans-serif;margin-top:2px">MOVERS</div>
  </div>`;

// Sent right after someone submits the quote form. Deliberately doesn't
// include a price — that's a human's job. This just confirms the booking
// request came through and sets expectations for what happens next.
function buildBookingConfirmationEmail(quote) {
  const firstName = (quote.name || '').trim().split(/\s+/)[0] || 'there';
  const route = quote.fromZip && quote.toZip
    ? `${quote.fromZip} → ${quote.toZip}`
    : (quote.route || 'your route');

  const subject = "You're Booked — We'll Be In Touch Soon";

  const rows = [
    ['Route', route],
    ['Move date', quote.date || 'Flexible'],
    ['Home size', quote.homeSize || '—'],
    ['Service type', quote.serviceType || 'Full Service'],
    ['Special items', quote.specialItems || 'None'],
  ];

  const rowsHtml = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 0;color:#888;font-size:13px;width:140px">${label}</td>
      <td style="padding:8px 0;color:#111;font-size:13px;font-weight:600">${value}</td>
    </tr>`).join('');

  const html = `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff">
    ${EMAIL_HEADER}
    <div style="padding:32px">
      <p style="font-size:15px;color:#111;margin:0 0 4px">Hi ${firstName},</p>
      <p style="font-size:15px;color:#111;line-height:1.6;margin:0 0 24px">
        Thanks for booking with Trust! We've received your move details below, and
        a move consultant will reach out shortly with your quote and next steps.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${rowsHtml}</table>
      <p style="font-size:13px;color:#888;line-height:1.6;margin:0 0 24px">
        No action needed from you right now — we'll be in touch soon to confirm pricing
        and finalize the details of your move.
      </p>
      <p style="font-size:13px;color:#888;margin:0">— The Trust Team</p>
    </div>
  </div>`;

  const text = `Hi ${firstName},

Thanks for booking with Trust! We've received your move details below, and a move consultant will reach out shortly with your quote and next steps.

Route: ${route}
Move date: ${quote.date || 'Flexible'}
Home size: ${quote.homeSize || '—'}
Service type: ${quote.serviceType || 'Full Service'}
Special items: ${quote.specialItems || 'None'}

No action needed from you right now — we'll be in touch soon to confirm pricing and finalize the details of your move.

— The Trust Team`;

  return { subject, html, text };
}

module.exports = { sendMail, isConfigured, buildBookingConfirmationEmail };
