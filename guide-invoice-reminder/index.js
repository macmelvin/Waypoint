// Biweekly guide invoice reminder — pulls the "who owes what" summary from
// the main Waypoint app's admin API and emails ONE summary to the admin
// (Melvin), via the Resend HTTPS API (Railway blocks outbound SMTP on
// non-Pro plans, same reason visit-digest uses Resend instead of
// nodemailer/SMTP). Runs once to completion per Railway Cron Schedule
// trigger, then exits.
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
// IMPORTANT — this does NOT email guides directly. An earlier version did,
// but Resend's shared "onboarding@resend.dev" sender can only deliver to
// the Resend account's own verified email address, so every send to a real
// guide failed with a 403 (verifying a custom sending domain would fix
// that, but Melvin doesn't want to buy/manage a domain just for this).
// Instead, this script emails ONE summary to Melvin's own already-verified
// address, and the actual guide-facing nudge happens from the admin panel's
// "Guide invoices" section, which builds a wa.me WhatsApp deep link per
// guide (same click-to-chat mechanism already used for booking
// notifications) — a human click, not something Railway can automate, but
// it needs no Resend domain and no WhatsApp Business API approval either.
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
//   ADMIN_NOTIFY_EMAIL the address this summary is sent to -- must be the
//                      Resend account's own verified address (the one
//                      Resend's dashboard shows under Account -> your
//                      email) or every run will 403.
// Optional env vars:
//   RESEND_FROM_EMAIL  default 'Waypoint <onboarding@resend.dev>'

const WAYPOINT_BASE_URL = (process.env.WAYPOINT_BASE_URL || '').replace(/\/+$/, '');
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Waypoint <onboarding@resend.dev>';
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || '';

function assertConfigured() {
  const missing = [];
  if (!WAYPOINT_BASE_URL) missing.push('WAYPOINT_BASE_URL');
  if (!ADMIN_SECRET) missing.push('ADMIN_SECRET');
  if (!RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!ADMIN_NOTIFY_EMAIL) missing.push('ADMIN_NOTIFY_EMAIL');
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

function buildAdminSummaryEmail(guidesOwed, windowLabel) {
  const total = guidesOwed.reduce((sum, g) => sum + g.shareOwed, 0);
  const subject = `Waypoint: ${guidesOwed.length} guide${guidesOwed.length === 1 ? '' : 's'} owe S$${total.toFixed(2)} revenue share — ${windowLabel}`;

  const rowsText = guidesOwed
    .map((g) => `  ${g.name.padEnd(20)} ${g.bookings} booking${g.bookings === 1 ? '' : 's'}  S$${g.paidTotal.toFixed(2)} collected  S$${g.shareOwed.toFixed(2)} owed`)
    .join('\n');
  const text = `Guide invoice summary for ${windowLabel}\n\n${rowsText}\n\n`
    + `Total revenue share owed: S$${total.toFixed(2)}\n\n`
    + `Head to the "Guide invoices" section in the admin panel to notify each guide on WhatsApp with one tap.`;

  const rowsHtml = guidesOwed
    .map((g) => `
      <tr>
        <td style="padding:4px 12px;">${g.name}</td>
        <td style="padding:4px 12px;">${g.bookings}</td>
        <td style="padding:4px 12px;">S$${g.paidTotal.toFixed(2)}</td>
        <td style="padding:4px 12px;font-weight:600;color:#b91c1c;">S$${g.shareOwed.toFixed(2)}</td>
      </tr>`)
    .join('');
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;">
      <h2 style="margin:0 0 4px;">Guide invoice summary</h2>
      <p style="margin:0 0 16px;color:#666;">${windowLabel}</p>
      <table style="border-collapse:collapse;width:100%;">
        <tr style="color:#666;font-size:13px;"><td style="padding:4px 12px;">Guide</td><td style="padding:4px 12px;">Bookings</td><td style="padding:4px 12px;">Collected</td><td style="padding:4px 12px;">Share owed</td></tr>
        ${rowsHtml}
      </table>
      <p style="margin-top:16px;font-weight:600;">Total revenue share owed: S$${total.toFixed(2)}</p>
      <p style="color:#666;">Head to the "Guide invoices" section in the admin panel to notify each guide on WhatsApp with one tap.</p>
    </div>
  `;

  return { subject, text, html };
}

async function sendAdminSummaryEmail(guidesOwed, windowLabel) {
  const { subject, text, html } = buildAdminSummaryEmail(guidesOwed, windowLabel);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: ADMIN_NOTIFY_EMAIL, subject, text, html }),
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
    console.log('No guide has an outstanding revenue share this period -- nothing to send.');
    return;
  }

  console.log(`${guidesOwed.length} guide(s) with an outstanding share this period -- emailing admin summary to ${ADMIN_NOTIFY_EMAIL}.`);
  await sendAdminSummaryEmail(guidesOwed, windowLabel);
  console.log('Admin summary sent.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('guide-invoice-reminder failed:', err);
    process.exit(1);
  });
