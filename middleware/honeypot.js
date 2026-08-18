// middleware/honeypot.js
//
// A honeypot is a form field that's invisible to real people (hidden with
// CSS) but visible to most spam bots, which tend to fill in every field
// they find. If it comes back non-empty, the submission is almost
// certainly automated — so we quietly pretend it worked without actually
// saving anything, rather than telling the bot "blocked" (which just
// teaches it to adapt).
//
// This needs zero external accounts/API keys, unlike reCAPTCHA/hCaptcha.
// If real captcha is ever wanted later, this is the file to extend.

function honeypot(fieldName = 'website') {
  return (req, res, next) => {
    const value = req.body?.[fieldName];
    if (value) {
      // Looks like a bot. Respond as if it succeeded so it doesn't learn
      // anything useful, but skip all real processing.
      req.isSpam = true;
    }
    next();
  };
}

module.exports = { honeypot };
