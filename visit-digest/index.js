// Daily visitor digest — queries self-hosted Umami for the last 24h of stats
// across all registered sites, and emails a single summary via Gmail SMTP.
// Runs once to completion per Railway Cron Schedule trigger, then exits.
//
// Required env vars:
//   UMAMI_BASE_URL   e.g. https://umami-production-99b0.up.railway.app
//   UMAMI_USERNAME   Umami dashboard login username (usually "admin")
//   UMAMI_PASSWORD   Umami dashboard login password
//   SITES_JSON       JSON array of { "name": "...", "id": "<umami website id>" }
//   SMTP_USER        e.g. macmelvin.tan@gmail.com
//   SMTP_PASSWORD    Gmail App Password
//   RECIPIENT_EMAIL  e.g. macmelvin.tan@gmail.com

const nodemailer = require('nodemailer');

const UMAMI_BASE_URL = (process.env.UMAMI_BASE_URL || '').replace(/\/+$/, '');
const UMAMI_USERNAME = process.env.UMAMI_USERNAME;
const UMAMI_PASSWORD = process.env.UMAMI_PASSWORD;
const SITES = JSON.parse(process.env.SITES_JSON || '[]');
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || SMTP_USER;

function assertConfigured() {
  const missing = [];
  if (!UMAMI_BASE_URL) missing.push('UMAMI_BASE_URL');
  if (!UMAMI_USERNAME) missing.push('UMAMI_USERNAME');
  if (!UMAMI_PASSWORD) missing.push('UMAMI_PASSWORD');
  if (!SITES.length) missing.push('SITES_JSON (empty or missing)');
  if (!SMTP_USER) missing.push('SMTP_USER');
  if (!SMTP_PASSWORD) missing.push('SMTP_PASSWORD');
  if (missing.length) {
    throw new Error(`Missing required config: ${missing.join(', ')}`);
  }
}

async function umamiLogin() {
  const res = await fetch(`${UMAMI_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: UMAMI_USERNAME, password: UMAMI_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Umami login failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.token) throw new Error('Umami login succeeded but no token in response');
  return data.token;
}

async function fetchSiteStats(token, site, startAt, endAt) {
  const url = `${UMAMI_BASE_URL}/api/websites/${site.id}/stats?startAt=${startAt}&endAt=${endAt}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    return { name: site.name, error: `${res.status} ${await res.text()}` };
  }
  const stats = await res.json();
  return {
    name: site.name,
    pageviews: stats.pageviews?.value ?? stats.pageviews ?? 0,
    visitors: stats.visitors?.value ?? stats.visitors ?? 0,
    visits: stats.visits?.value ?? stats.visits ?? 0,
  };
}

function buildEmail(results, windowLabel) {
  const rows = results
    .map((r) => {
      if (r.error) return `  ${r.name}: (error fetching stats — ${r.error})`;
      if (!r.visitors && !r.pageviews) return `  ${r.name}: no visits`;
      return `  ${r.name}: ${r.visitors} visitor${r.visitors === 1 ? '' : 's'}, ${r.pageviews} pageview${r.pageviews === 1 ? '' : 's'}`;
    })
    .join('\n');

  const totalVisitors = results.reduce((sum, r) => sum + (r.visitors || 0), 0);
  const text = `Visitor digest — ${windowLabel}\n\n${rows}\n\nTotal unique visitors across all sites: ${totalVisitors}\n`;

  const htmlRows = results
    .map((r) => {
      if (r.error) {
        return `<tr><td style="padding:4px 12px;color:#b91c1c;">${r.name}</td><td style="padding:4px 12px;color:#b91c1c;">error: ${r.error}</td></tr>`;
      }
      const empty = !r.visitors && !r.pageviews;
      return `<tr><td style="padding:4px 12px;font-weight:600;">${r.name}</td><td style="padding:4px 12px;${empty ? 'color:#888;' : ''}">${empty ? 'no visits' : `${r.visitors} visitor${r.visitors === 1 ? '' : 's'} · ${r.pageviews} pageview${r.pageviews === 1 ? '' : 's'}`}</td></tr>`;
    })
    .join('');

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;">
      <h2 style="margin:0 0 4px;">Visitor digest</h2>
      <p style="margin:0 0 16px;color:#666;">${windowLabel}</p>
      <table style="border-collapse:collapse;width:100%;">${htmlRows}</table>
      <p style="margin-top:16px;color:#666;">Total unique visitors across all sites: <strong>${totalVisitors}</strong></p>
    </div>
  `;

  return { text, html };
}

async function main() {
  assertConfigured();

  const endAt = Date.now();
  const startAt = endAt - 24 * 60 * 60 * 1000;
  const windowLabel = `${new Date(startAt).toISOString().slice(0, 16).replace('T', ' ')} → ${new Date(endAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  console.log(`Logging into Umami at ${UMAMI_BASE_URL}...`);
  const token = await umamiLogin();

  console.log(`Fetching stats for ${SITES.length} site(s)...`);
  const results = [];
  for (const site of SITES) {
    try {
      results.push(await fetchSiteStats(token, site, startAt, endAt));
    } catch (err) {
      results.push({ name: site.name, error: err.message });
    }
  }

  const { text, html } = buildEmail(results, windowLabel);
  console.log(text);

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });

  await transporter.sendMail({
    from: SMTP_USER,
    to: RECIPIENT_EMAIL,
    subject: `Visitor digest — ${new Date(endAt).toISOString().slice(0, 10)}`,
    text,
    html,
  });

  console.log('Digest email sent successfully.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('visit-digest failed:', err);
    process.exit(1);
  });
