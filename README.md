# Trust — Website + Backend

This folder has everything for the site to run for real: a static frontend
(`public/`) and an Express API + admin panel (everything else) that it talks
to. The backend files sit at the top level next to `public/` — rather than
in their own `server/` subfolder — specifically so this deploys cleanly on
hosts that don't offer a "root directory" setting (Bonto, and several
others): they expect `package.json` at the true root of whatever repo they
clone, not nested a folder down.

```
trust-movers/
├── server.js          ← entry point: API, static site, safety checks, backups
├── db.js              ← tiny JSON-file data layer
├── mailer.js          ← sends the booking confirmation + password-reset emails
├── backup.js          ← zips data + uploads on a schedule
├── errorLog.js        ← file-based error logging
├── package.json
├── .env.example
├── middleware/
│   ├── auth.js          ← JWT auth
│   ├── rateLimit.js     ← abuse protection tiers
│   └── honeypot.js      ← spam-bot trap for public forms
├── routes/
│   ├── auth.js          ← register / login / forgot-password / reset-password / Google
│   ├── articles.js      ← Resources CRUD (image + video support)
│   ├── quotes.js        ← quote/lead capture + booking confirmation email
│   ├── team.js          ← Meet the Team CRUD + photo upload
│   ├── settings.js      ← WhatsApp number + Google Client ID + API credentials
│   ├── location.js      ← live tracking shown on the dashboard
│   ├── whatsapp.js      ← chat-widget capture + Meta webhook
│   ├── analytics.js     ← built-in pageview counter
│   └── backups.js       ← trigger/list/download backups
├── uploads/    ← team + article photos land here
├── backups/    ← automatic zip backups (last 14 kept)
├── logs/       ← errors.log
├── data/       ← auto-created JSON "tables"
└── public/
    ├── index.html          ← the homepage
    ├── admin.html          ← admin panel
    ├── reset-password.html ← password reset landing page
    ├── residential.html, commercial.html, packing.html, long-distance.html
    ├── privacy-policy.html, cookie-consent.html, brand-guidelines.html,
    │   your-rights.html, sitemap.html, copyrights.html, brand.html, careers.html
    ├── robots.txt, sitemap.xml   ← for search engines
    └── assets/                   ← logo, hero image, shared page CSS
```

## Running it locally

```bash
cd trust-movers
npm install
cp .env.example .env      # then edit .env — see below
npm start
```

Open **http://localhost:3000** for the site, and **http://localhost:3000/admin.html**
for the admin panel (not linked from the site anywhere — bookmark it).

The first time the server starts, it automatically:

1. Creates an **admin account** from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`
   (defaults to `admin@trustmovers.com` / `ChangeMe123!`). Printed to the
   terminal — log in, then change the password (use "Forgot password?" on
   the admin login screen, which now works end-to-end).
2. Seeds **3 starter articles** and **5 starter team members**.
3. Kicks off the **first automatic backup** 10 seconds after startup, then
   once every 24 hours after that.

## What's wired up

- **Login / Sign Up**, including **"Forgot password?"** — a real reset
  email with a one-hour, single-use link (`/reset-password.html`) — and a
  **circular "Sign in with Google" button** (hidden until you configure a
  Google Client ID — see "Google Sign-In" below).
- **My Account** (admin panel, Settings tab) — change your own admin email
  and/or password without editing any files. Changing the password
  immediately signs out any other device using the old one.
- **Resources** → live from `/api/articles`, admin-managed, each article can
  have an **uploaded cover image and/or an embedded video** (YouTube,
  TikTok, Vimeo, or a direct file link).
- **Meet the Team** → live from `/api/team`, photo upload included.
- **Get My Free Estimate** → sends a booking-confirmation email (no price —
  just a welcome, their submitted details, and "a consultant will follow up
  soon"). See "Sending real emails" below for making this actually deliver.
- **Chat widget** → sends visitor messages toward your WhatsApp number
  (see "Chat → WhatsApp" below).
- **My Move Dashboard** → progress/ETA/status poll `/api/location` every
  second; shows an actual embedded map with a real pin the moment real GPS
  coordinates exist (see "Live tracking" below), not just an illustration.
- **Admin panel tabs**: Articles, Team, Quote Leads, Chat Messages,
  **Analytics** (built-in pageview counter, no third-party account needed),
  and Settings (My Account, WhatsApp, Google Sign-In, Live Tracking,
  **Backups**). Quote Leads and Chat Messages **auto-refresh every 20
  seconds** so a new lead or message shows up without reloading the page.
- **Security**: rate limiting on login/register/quotes/chat, a honeypot
  field on every public form, HTTP security headers + a Content-Security-
  Policy (via `helmet`), and session invalidation on password change.
- **Automatic backups** of `data/` and `uploads/` — daily, last 14 kept,
  downloadable from the admin panel's Settings tab.
- **SEO basics**: meta description, Open Graph/Twitter card tags,
  `robots.txt`, `sitemap.xml`, and `LocalBusiness` structured data.

## Google Sign-In

The circular Google button sits below the login/create-account forms and
stays hidden until you add a Client ID — it needs zero backend code
changes, just configuration:

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials),
   create a project if you don't have one, then **Create Credentials →
   OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add your site's URL exactly
   (e.g. `http://localhost:3000` for local testing, `https://yourdomain.com`
   once deployed — both if you want it to work in both places). This has to
   match exactly, including the port — a mismatch here is the most common
   reason the button fails silently.
3. Copy the **Client ID** (looks like `123...apps.googleusercontent.com`)
   into the admin panel's Settings tab, under "Google Sign-In", and save.

That's it — the button appears automatically once a Client ID is saved.
Accounts created this way are always regular customer accounts, never
admin — admin access can't be granted through Google Sign-In.

The button itself is rendered by Google's own script, not hand-built —
an earlier version used a custom button wired to `prompt()` ("One Tap"),
which Google's own docs describe as a best-effort secondary flow, not a
reliable click target (it can silently not appear at all depending on
cookie settings, browser, or prior dismissals). Using Google's actual
`renderButton()` is the officially reliable mechanism, and still comes out
as a small circular icon button that fits the site's look.

## Before anyone else can reach this server

Three things, in order of how much they matter:

### 1. Set a real JWT_SECRET

The server **refuses to start** in production (`NODE_ENV=production`) if
`JWT_SECRET` is still the example placeholder — this is intentional, not a
bug. Generate a real one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Paste the result into `.env` as `JWT_SECRET=...`.

### 2. Change the admin password

Log in with the seeded credentials, then use "Forgot password?" (or just
edit the password directly) — don't leave `ChangeMe123!` live. The server
prints a loud warning on every startup if it detects you haven't.

### 3. Set up real email (optional but recommended)

Without SMTP configured, estimate and password-reset emails are logged to
`data/sent-emails.log` instead of actually sending — fine for
testing, not for real customers. See "Sending real emails" below.

## Deploying it somewhere real

This is a normal Node.js app — any host that runs Node works. A simple,
inexpensive path:

1. **Get a small VPS** (DigitalOcean, Hetzner, Linode — a few dollars/month
   is plenty for a small business site) and a **domain name** pointed at it.
2. **Copy this project to the server** (git, scp, whatever you're
   comfortable with), then `cd trust-movers && npm install --production`.
3. **Fill in `.env` for real** — `NODE_ENV=production`, a real `JWT_SECRET`,
   a changed admin password, real SMTP credentials, and `CORS_ORIGIN` set to
   your real domain (e.g. `https://yourdomain.com`).
4. **Keep it running** with a process manager so it survives crashes and
   reboots:
   ```bash
   npm install -g pm2
   pm2 start server.js --name trust-movers
   pm2 save
   pm2 startup   # follow the printed instructions to survive reboots
   ```
5. **Get HTTPS** — the easiest way is a reverse proxy that handles SSL for
   you. [Caddy](https://caddyserver.com) does this in about 3 lines with a
   free auto-renewing certificate:
   ```
   yourdomain.com {
     reverse_proxy localhost:3000
   }
   ```
   (Nginx + Certbot works too if you're more familiar with that stack.)
6. **Update the placeholder URLs** — `index.html`'s `<head>`, `sitemap.xml`,
   and every generated page currently say `https://your-domain-here.com` —
   find-and-replace that with your real domain before it goes live, so link
   previews and search engines get the right URL.
7. **Point your domain's DNS** at the server's IP address (an "A" record).

That's the whole path from "runs on my laptop" to "live on the internet."

### ⚠️ Don't deploy this to Vercel (or Netlify) as-is

If you've tried Vercel and things broke in specific ways — **new accounts
failing to register, or the Team/Resources sections randomly not showing
what you just added** — this is why, and it's not a bug to fix, it's a
mismatch between what this app needs and what that platform provides:

This app is a normal, always-running Node.js server with its data stored in
plain files on disk (`data/*.json`, `uploads/`). Vercel
doesn't run apps that way — it runs your code fresh, in an isolated
"serverless function," for each individual request, then throws that
instance away. There's no persistent disk between requests. So when someone
registers an account, it gets written to a file that exists for a few
seconds in one instance, and then the *next* request — maybe the one that
checks if they're logged in — lands on a completely different, fresh
instance that never saw that write. That's exactly "account creation
fails" and "data doesn't show up," and no amount of debugging the
application code fixes it, because the code is working correctly for the
model it was built for.

Two real ways forward:

1. **Use a host built for a persistent server** — this needs *zero* code
   changes, since it's exactly what this app already is. **Render** and
   **Railway** both work this way and have simple free/cheap tiers; a VPS
   with the PM2 + Caddy setup above works too. Any of these will make the
   exact symptoms above disappear immediately.
2. **Migrate to Vercel properly** — genuinely possible, but a real
   rewrite: swap `db.js` for a hosted database (e.g. a free Postgres from
   [Neon](https://neon.tech) or [Supabase](https://supabase.com)), move
   uploaded photos to object storage (e.g. Vercel Blob or S3), and
   restructure the Express routes into Vercel's serverless function
   format. Worth doing if you specifically need Vercel for other reasons
   — just know it's a different, larger project, not a config tweak. Ask
   if you want to go this route and I'll scope it properly rather than
   patch around the mismatch.

### Reaching the admin panel once it's deployed

There's no separate URL or subdomain needed — `/admin.html` is served from
the exact same app as the homepage, so once deployed it's just
`https://yourdomain.com/admin.html`. It was never linked from the public
site on purpose (see "What's wired up" above) — bookmark it. If you want a
*genuinely* separate admin subdomain (`admin.yourdomain.com`) later for
extra separation, that's a DNS + reverse-proxy config choice on top of this
same app, not a code change — ask if you want that set up.

## Chat → WhatsApp

**Out of the box (zero setup):** a visitor's message is saved under the
admin panel's "Chat Messages" tab, and their browser opens `wa.me` with the
message pre-filled — they hit send in WhatsApp and it lands in your chats
normally. Set your number in **Settings → WhatsApp**.

**Fully automatic (needs a Meta WhatsApp Business Cloud API account):** fill
in the Advanced API Access Token + Phone Number ID fields in Settings and
messages deliver with no tap needed from the visitor. Meta's quickstart:
https://developers.facebook.com/docs/whatsapp/cloud-api/get-started.

## Live tracking

The dashboard shows a stylized illustrated route by default, driven by the
Progress % you set in the admin panel. But the moment a **real GPS
position** is available — either from the "Share My Location" button in
the admin panel's Live Tracking section, or from the WhatsApp webhook below
— the dashboard automatically swaps that illustration for a **real
interactive dark-mode map** (Leaflet + CARTO's free Dark Matter tiles, no
API key needed) with a pulsing marker at the real coordinates that moves
smoothly as updates come in, rather than reloading. This is what makes
"Share My Location" actually visible to
customers, not just stored in the database.

**Share My Location** works right now with zero setup: open `/admin.html`
on the phone that's with the truck, go to Settings → Live Tracking, and tap
the button. It needs HTTPS to work (localhost is exempted for local
testing) — see the deployment guide above for getting HTTPS in production.

**If the shared location looks wrong or way off**, check the "Accuracy"
readout that appears under the button — it's the browser's own estimate of
how precise the fix was, in meters. Anything over a few hundred meters
(shown in yellow/red) almost always means the browser fell back to
estimating your position from WiFi networks or your IP address rather than
a real GPS fix — this happens automatically on laptops/desktops without GPS
hardware, or indoors. A phone outdoors with location services turned on
will report a real GPS fix, usually accurate to under 20-50 meters. This
isn't something the app can fix — it's an honest limitation of whatever
hardware is answering the location request.

**From WhatsApp** — the webhook code (`routes/whatsapp.js`,
`/api/whatsapp/webhook`) already parses an incoming WhatsApp location
message and updates the same real-map view automatically — but it needs
your own Meta Business Cloud API app, this server deployed with a public
HTTPS address (Meta won't call `localhost`), and the webhook URL + your
chosen Verify Token (set in Settings) configured on Meta's side.

Until either of those is set up, or between updates, Progress %/ETA/Status
text in the admin panel still work exactly as before — the dashboard polls
every second regardless of which view (illustration or real map) is active.

## Sending real emails

Fill in the SMTP section of `.env`:

```
SMTP_HOST=smtp.gmail.com       # or your provider's SMTP host
SMTP_PORT=587
SMTP_USER=you@yourdomain.com
SMTP_PASS=your-app-password    # Gmail needs an "App Password", not your login password
MAIL_FROM_NAME=Trust
MAIL_FROM_EMAIL=quotes@trustmovers.com
```

Any SMTP provider works — Gmail, SendGrid, Mailgun, Postmark, your host's
own mail server. Used for the booking confirmation email and password
resets. **Without this filled in, no real email is sent at all** —
everything logs to `data/sent-emails.log` in "mock mode" instead,
which is why a password reset or booking confirmation might not have
actually arrived anywhere yet.

## Backups

A zip of `data/` and `uploads/` is created automatically once
a day (the last 14 are kept, older ones deleted). Grab one anytime from the
admin panel's Settings tab, or trigger one on demand with the same button.

This protects against the server or disk being wiped — it does **not**
protect you if you never look at it. Consider occasionally downloading a
backup somewhere off the server (your own computer, cloud storage) for
real disaster recovery. If you deploy to a host with an ephemeral
filesystem (e.g. free tiers of Render/Heroku), backups made *on* that host
vanish on redeploy too — download them elsewhere.

## Built-in analytics

The admin panel's Analytics tab shows total pageviews, top pages, top
referrers, and a 30-day chart — tracked with no cookies, no IP storage, and
no third-party account. It's intentionally simple; if you want deeper
insight later (session recordings, funnels, etc.), a tool like Plausible or
Google Analytics can run alongside this with no conflict.

## Rate limiting & spam protection

Login/register/forgot-password are limited to 10 attempts per 15 minutes
per IP; quote and chat submissions to 20 per hour per IP; everything else
on the API shares a general budget of 600 requests per 15 minutes per IP
(see `middleware/rateLimit.js` to adjust any of these). Every public form
also carries an invisible honeypot field — real people never fill it, so a
submission that does gets silently dropped instead of saved. None of this
requires any external account or API key.

`GET /api/location` (the once-a-second poll that makes live tracking live)
is deliberately exempt from the general budget — a browser tab left open
sends up to 900 of these in 15 minutes on its own, which used to exhaust
the shared budget and take team/articles/even admin login down as
collateral damage from a single open tab. If that ever comes back (a "Too
many requests" error alongside "couldn't load team/articles" at the same
time is the signature of this specific problem), it means something new is
polling frequently enough to need the same treatment — add it to the
`isExemptFromGeneralLimit` check in `middleware/rateLimit.js`.

**If you ever see an error mentioning `X-Forwarded-For` or
`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`:** this happens whenever a request
reaches the server through any proxy or tunnel (Caddy/Nginx, a Cloudflare
Tunnel, ngrok, most hosting platforms) — Express needs to be told to trust
it, via the `TRUST_PROXY` value in `.env`. It's set to `1` by default,
which covers the normal case of one proxy/tunnel in front of the server.
If requests are still failing, or everyone visiting seems to share one rate
limit (a sign the wrong IP is being read), follow the "magic number" steps
in [express-rate-limit's proxy troubleshooting guide](https://express-rate-limit.github.io/ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/)
to find the exact right number for your setup — it's almost always `1`.

## Swapping the hero background image

The homepage hero uses a full-bleed background image (`.hero-bg` in
`index.html`, pointing at `/assets/hero-bg.jpg`) with layered dark
gradients so the headline stays readable. To swap it, replace
`public/assets/hero-bg.jpg` with your own image (any reasonably
wide photo or illustration works — the gradients handle blending it in).

## Moving to a real database later

Everything currently lives in flat JSON files under `data/` — no
database server to install, easy to inspect, good enough for a small
business site. If you outgrow it, the only file that needs to change is
`db.js` (swap its functions for calls to Postgres/MongoDB/etc.) — none of
the route files touch the filesystem directly.

## Still worth doing (not code — just needs your judgment)

- **Have the legal pages reviewed.** Privacy Policy, Cookie Consent, Your
  Rights, etc. are genuine, sensible starting templates — not a substitute
  for an actual legal review, especially for data-protection rules specific
  to where you operate.
- **Set up error/uptime alerting** if you want to know about problems before
  a customer tells you — `logs/errors.log` has everything, a service
  like Sentry (free tier) or a simple uptime pinger is the next step up.
- **Add real pricing logic** once you know your actual costs — the current
  estimate is a clearly-labeled simple formula (see `BASE_RANGE` in
  `mailer.js`).
