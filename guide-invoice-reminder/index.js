// Biweekly guide invoice reminder — pulls the "who owes what" summary from
// the main Waypoint app's admin API and emails each guide their own total
// via the Resend HTTPS API (Railway blocks outbound SMTP on non-Pro plans,
// same reason visit-digest uses Resend instead of nodemailer/SMTP).
// Runs once to completion per Railway Cron Schedule trigger, then exits.
//
// Cadence: this service's Railway cronSchedule should be "0 1 1,15 * *"
// (1am UTC = 9am Singapore, on the 1st and 15th of every month) — the
// standard semi-monthly billing cadence. Cron has no clean way to express
// a literal fixed 14-day interval across month boundaries, so this is the
// closest stateless equivalent to "every two weeks": each run's window
// covers 13-17 days depending on the month, not exactly 14.0 days. The
// window itself (see windowStart() below) is derived purely from today's
// date, so it self-corrects even if a run is late or briefly misfires.
//
// IMPORTANT — before this can actually reach a real guide's inbox: Resend's
// shared "onboarding@resend.dev" sender can only deliver to the Resend
// account's own verified email address (same restriction visit-digest's
// README already notes). Sending to an arbitrary guide's email needs a
// verified custom sending domain in the Resend dashboard, then pointing
// RESEND_FROM_EMAIL at an address on that domain. Until then, every send
// below to a real guide will fail with a 403 from Resend — this script
// logs that per guide and keeps going rather than treating it as fatal,
// since it's an account-setup gap, not a bug.
//
// Required env vars:
//   WAYPOINT_BASE_URL  e.g. https://waypoint-production-0307.up.railway.app
//   ADMIN_SECRET       same value as the main `waypoint` service's
//                      ADMIN_SECRET (set this one as a Railway "reference
//                      variable", ${{waypoint.ADMIN_SECRET}}, so there's
//                      only ever one place the real secret lives)
//   RESEND_API_KEY     API key from resend.com (can likewise reference
//                      ${{visit-digest.RESEND_API_KEY}} to reuse the same
//                      Resend account rather than creating a second key)
// Optional env vars:
//   RESEND_FROM_EMAIL  default 'Waypoint <onboarding@resend.dev>' — replace
//                      with a verified-domain address once one exists
//   ADMIN_BCC_EMAIL    if set, bcc'd on every guide email so Melvin can see
//                      what actually went out
//   REPLY_TO_EMAIL     if set, added as Reply-To so a guide's reply reaches
//                      a real inbox even while sending from resend.dev

const WAYPOINT_BASE_URL = (process.env.WAYPOINT_BASE_URL || '').replace(/\/+$/, '');
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Waypoint <onboarding@resend.dev>';
const ADMIN_BCC_EMAIL = process.env.ADMIN_BCC_EMAIL || '';
const REPLY_TO_EMAIL = process.env.REPLY_TO_EMAIL || '';

function assertConfigured() {
  const missing = [];
  if (!WAYPOINT_BASE_URL) missing.push('WAYPOINT_BASE_URL');
  if (!ADMIN_SECRET) missing.push('ADMIN_SECRET');
  if (!RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(', ')}`);
  }
}

// The most recent 1st-or-15th-of-month strictly before `now` (UTC) — see
// the cadence note at the top. Computed fresh from the clock every run, so
// there's no persisted "last run" state to get out of sync.
function windowStart(now) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const firstThisMonth = Date.UTC(y, m, 1);
  const fifteenthThisMonth = Date.UTC(y, m, 15);
  const nowMs = now.getTime();
  if (nowMs > fifteenthThisMonth) return new Date(fifteenthThisMonth);
  if (nowMs > firstThisMonth) return new Date(firstThisMonth);
  return new Date(Date.UTC(y, m - 1, 15)); // running exactly on the 1st -> previous month's 15th
}

async function fetchInvoiceSummary(since) {
  const url = `${WAYPOINT_BASE_URL}/api/admin/guide-invoice-summary?since=${encodeURIComponent(since.toISOString())}`;
  const res = await fetch(url, { headers: { 'x-admin-secret': ADMIN_SECRET } });
  if (!res.ok) {
    throw new Error(`guide-invoice-summary fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function buildGuideEmail(guide, windowLabel) {
  const subject = `Waypoint: S$${guide.shareOwed.toFixed(2)} STGS share due — ${guide.bookings} booking${guide.bookings === 1 ? '' : 's'}`;
  const text = `Hi ${guide.name},\n\n`
    + `Here's your Waypoint booking summary for ${windowLabel}:\n\n`
    + `  Completed bookings: ${guide.bookings}\n`
    + `  Amount collected:   S$${guide.paidTotal.toFixed(2)}\n`
    + `  STGS share (10%):   S$${guide.shareOwed.toFixed(2)}\n\n`
    + `Please arrange payment of the STGS share above at your earliest convenience. `
    + `Reply to this email or message us on WhatsApp if anything here looks off.\n\n`
    + `Thanks for guiding with Waypoint!`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;">
      <h2 style="margin:0 0 4px;">Your Waypoint invoice reminder</h2>
      <p style="margin:0 0 16px;color:#666;">${windowLabel}</p>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:4px 12px;">Completed bookings</td><td style="padding:4px 12px;font-weight:600;">${guide.bookings}</td></tr>
        <tr><td style="padding:4px 12px;">Amount collected</td><td style="padding:4px 12px;font-weight:600;">S$${guide.paidTotal.toFixed(2)}</td></tr>
        <tr><td style="padding:4px 12px;">STGS share (10%) due</td><td style="padding:4px 12px;font-weight:600;color:#b91c1c;">S$${guide.shareOwed.toFixed(2)}</td></tr>
      </table>
      <p style="margin-top:16px;color:#666;">Please arrange payment of the share above at your earliest convenience. Reply to this email or message us on WhatsApp if anything here looks off.</p>
      <p style="color:#666;">Thanks for guiding with Waypoint!</p>
    </div>
  `;

  return { subject, text, html };
}

async function sendGuideEmail(guide, windowLabel) {
  const { subject, text, html } = buildGuideEmail(guide, windowLabel);
  const body = {
    from: RESEND_FROM_EMAIL,
    to: guide.email,
    subject,
    text,
    html,
  };
  if (ADMIN_BCC_EMAIL) body.bcc = ADMIN_BCC_EMAIL;
  if (REPLY_TO_EMAIL) body.reply_to = REPLY_TO_EMAIL;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
}

async function main() {
  assertConfigured();

  const since = windowStart(new Date());
  const until = new Date();
  const windowLabel = `${since.toISOString().slice(0, 10)} to ${until.toISOString().slice(0, 10)}`;

  console.log(`Fetching guide invoice summary for ${windowLabel}...`);
  const summary = await fetchInvoiceSummary(since);
  const guidesOwed = (summary.guides || []).filter((g) => g.shareOwed > 0);

  if (!guidesOwed.length) {
    console.log('No guide has an outstanding STGS share this period -- nothing to send.');
    return;
  }

  console.log(`${guidesOwed.length} guide(s) with an outstanding share this period.`);

  let sent = 0;
  let skippedNoEmail = 0;
  let failed = 0;
  for (const guide of guidesOwed) {
    if (!guide.email) {
      console.log(`Skipping ${guide.name} (S$${guide.shareOwed.toFixed(2)} owed, ${guide.bookings} bookings) -- no email on file.`);
      skippedNoEmail += 1;
      continue;
    }
    try {
      await sendGuideEmail(guide, windowLabel);
      console.log(`Sent to ${guide.name} <${guide.email}> -- S$${guide.shareOwed.toFixed(2)} owed, ${guide.bookings} bookings.`);
      sent += 1;
    } catch (err) {
      console.error(`Failed to email ${guide.name} <${guide.email}>: ${err.message}`);
      failed += 1;
    }
  }

  console.log(`Done: ${sent} sent, ${skippedNoEmail} skipped (no email), ${failed} failed.`);
  if (failed > 0 && sent === 0 && skippedNoEmail < guidesOwed.length) {
    // Every attempted send failed -- most likely cause is Resend's sandbox
    // domain restriction described at the top of this file. Non-fatal (the
    // run still exits 0) since a partial config issue shouldn't be retried
    // by Railway as if the whole service crashed, but worth a loud note.
    console.warn('All attempted sends failed -- if RESEND_FROM_EMAIL is still the resend.dev sandbox address, verify a custom sending domain in Resend first.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('guide-invoice-reminder failed:', err);
    process.exit(1);
  });
