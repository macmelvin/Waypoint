// Waypoint — receipt scanning for Split Bill.
//
// Reads a photo of a receipt and turns it into line items. If the server has
// an AI key it reads the photo there (see /receipt-ai.js); otherwise — or if
// that fails — it reads it ON THE PHONE with Tesseract OCR compiled to
// WebAssembly, and the photo never leaves the device. The OCR library (~3 MB incl. English data) is only downloaded
// the first time someone taps "Scan receipt", from jsDelivr, and the browser
// caches it after that.
//
// parseReceipt() is plain string logic with no DOM use, so it can be unit
// tested in Node (module.exports at the bottom).
(function (root) {
  'use strict';

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

  // ---------- Parsing ----------

  // Money at the END of a line: "12.50", "-2.14", "$8.80", "S$294.80",
  // plus common OCR slips — "5$" for "S$", ":" or "," for the decimal point,
  // and a trailing tax-code letter some POS systems print ("12.50 A").
  const PRICE_AT_END = /(-|−)?\s*(?:S\s?\$|5\$|\$)?\s*(-)?(\d{1,3}(?:[ ,]\d{3})*|\d+)[.,:](\d{2})\s*[A-Z*]?\s*$/;

  const RE = {
    subtotal: /sub[\s-]*tota?l/i,
    total: /\b(grand\s*)?tota?l\b|amount\s*due|nett?\s*amount|bill\s*amount/i,
    svc: /serv(ice)?|\bsvc\b|\bs\s*\/\s*c\b|\bsc\b|srv\s*chg/i,
    gst: /\bgst\b|\bvat\b|\btax\b/i,
    inclusive: /incl|inclusive|included/i,
    discount: /disc(ount)?|voucher|promo|member|less\b|off\b/i,
    // Payment / housekeeping lines that carry an amount but aren't food.
    // Header lines: order/receipt numbers, dates and times ("12:41" would
    // otherwise look like a $12.41 price).
    header: /\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\b(order|rcpt|receipt|invoice|inv|bill\s*no|table|tbl|pax|cashier|server|staff|pos|terminal|trans)\b|#\s*\w*\d/i,
    skip: /round(ing)?|\bcash\b|change|visa|master|amex|\bnets\b|paynow|paylah|grabpay|card|tender|balance|payment|paid|credit|debit|tips?\b|deposit|\bqty\b|\bitems?\b\s*:|\btel\b|\bfax\b|\bdate\b|\btime\b|\buen\b|reg\s*no/i,
  };

  function cleanLine(raw) {
    return String(raw)
      .replace(/[|]/g, ' ')
      // OCR often reads a 0 as O/o next to digits inside a price
      .replace(/(\d[.,:]\d?)[oO]/g, '$10')
      .replace(/(\d[.,:])[oO](\d)/g, '$10$2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tidyName(name) {
    let n = name
      .replace(/@\s*\$?\s*\d+[.,]\d{2}/g, '')   // "@4.50" unit price
      .replace(/[\s.:_\-–—=~*]+$/g, '')          // trailing dot leaders etc.
      .replace(/^[\s.:_\-–—=~*]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // A mangled quantity digit often comes out as 1–2 junk letters
    // ("IE Tiger Beer", "Ll Lime Juice") — drop it if a real name follows.
    n = n.replace(/^[IlL|!ibBEeSsOo]{1,2}\s+(?=[A-Za-z]{2,}\s*\S)/, '');
    // "1 x Mee Siam" / "1 Mee Siam" → "Mee Siam"; "2 x Kaya Toast" → "2× Kaya Toast"
    const q = n.match(/^(\d{1,2})\s*[xX×]?\s+(.*[A-Za-z].*)$/);
    if (q) n = q[1] === '1' ? q[2] : `${q[1]}× ${q[2]}`;
    return n;
  }

  function letters(s) { return (s.match(/[A-Za-z]/g) || []).length; }

  function toCents(m) {
    const whole = parseInt(m[3].replace(/[ ,]/g, ''), 10);
    const cents = whole * 100 + parseInt(m[4], 10);
    return (m[1] || m[2]) ? -cents : cents;
  }

  // Returns { items:[{name,cents}], title, subtotal, total, svc, gst,
  //           gstInclusive, svcCents, gstCents }
  function parseReceipt(text) {
    const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(Boolean);
    const out = { items: [], title: '', subtotal: null, total: null, svc: false, gst: false, gstInclusive: false, svcCents: null, gstCents: null };
    let pastTotal = false;

    for (const line of lines) {
      const m = line.match(PRICE_AT_END);
      if (!m) {
        // First line with real words and no price is usually the shop name.
        if (!out.title && !out.items.length && letters(line) >= 4 && !RE.skip.test(line)) out.title = line.slice(0, 40);
        // "Prices are GST inclusive" style footers
        if (RE.gst.test(line) && RE.inclusive.test(line) && !/\bno\b/i.test(line)) out.gstInclusive = true;
        // A charge line whose amount OCR mangled ("GST 9%   5Eb5") still
        // tells us the charge was applied.
        else if (!RE.skip.test(line) && /\d/.test(line)) {
          if (RE.svc.test(line) && !RE.gst.test(line) && !/\bno\b/i.test(line)) out.svc = true;
          else if (RE.gst.test(line) && !RE.subtotal.test(line)) out.gst = true;
        }
        continue;
      }
      const name = line.slice(0, m.index).trim();
      const cents = toCents(m);

      if (RE.subtotal.test(name)) { out.subtotal = cents; continue; }
      if (RE.svc.test(name) && !RE.gst.test(name)) { out.svc = true; out.svcCents = cents; continue; }
      if (RE.gst.test(name)) {
        if (RE.inclusive.test(name)) out.gstInclusive = true; else { out.gst = true; out.gstCents = cents; }
        continue;
      }
      if (RE.total.test(name)) { if (out.total === null) out.total = cents; pastTotal = true; continue; }
      if (pastTotal) continue;             // payments / change after the total
      if (RE.skip.test(name) || RE.header.test(line)) continue;
      if (letters(name) < 2) continue;     // "12 12.50", stray numbers
      if (cents === 0) continue;
      if (Math.abs(cents) > 500000) continue; // > $5,000 on one line is almost surely misread

      const item = { name: tidyName(name), cents };
      if (cents < 0 || RE.discount.test(name)) item.cents = -Math.abs(cents);
      if (item.name) out.items.push(item);
    }
    if (out.gstInclusive) out.gst = false;
    return out;
  }

  // ---------- OCR ----------

  let libPromise = null;
  function loadLib() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = TESSERACT_URL;
        s.async = true;
        s.onload = () => (root.Tesseract ? resolve(root.Tesseract) : reject(new Error('OCR failed to load')));
        s.onerror = () => { libPromise = null; reject(new Error('OCR failed to load')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  // Phone photos are 3000–4000px wide; OCR is faster and no less accurate
  // around 1600px. Greyscale + a contrast stretch helps faded thermal paper.
  function prepareImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 1800;
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        try {
          const d = ctx.getImageData(0, 0, w, h), px = d.data;
          let lo = 255, hi = 0;
          const grey = new Uint8ClampedArray(w * h);
          for (let i = 0, j = 0; i < px.length; i += 4, j++) {
            const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
            grey[j] = g;
            if (g < lo) lo = g;
            if (g > hi) hi = g;
          }
          const range = Math.max(1, hi - lo);
          for (let i = 0, j = 0; i < px.length; i += 4, j++) {
            const v = ((grey[j] - lo) * 255) / range;
            px[i] = px[i + 1] = px[i + 2] = v;
          }
          ctx.putImageData(d, 0, 0);
        } catch (err) { /* tainted/unsupported — OCR the plain resize */ }
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that image')); };
      img.src = url;
    });
  }

  // ---------- AI reading (server) ----------
  // When the server has an AI key (see /receipt-ai.js), the photo goes there
  // instead — much better on crumpled or faded receipts. Any failure falls
  // back to on-phone OCR below, so scanning always works.
  let aiStatus = null;
  function aiEnabled() {
    if (!aiStatus) {
      aiStatus = fetch('/api/receipt/status').then((r) => (r.ok ? r.json() : { enabled: false }))
        .then((s) => !!s.enabled).catch(() => { aiStatus = null; return false; });
    }
    return aiStatus;
  }
  if (typeof fetch === 'function' && typeof document !== 'undefined') aiEnabled(); // warm up

  function photoForAI(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 2048; // long receipts need the height to stay legible
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that image')); };
      img.src = url;
    });
  }

  async function readWithAI(file, progress) {
    const image = await photoForAI(file);
    // The server gives no progress, so ease the bar towards 90% while we wait.
    let frac = 0.1;
    progress(frac, 'read');
    const tick = setInterval(() => { frac += (0.9 - frac) * 0.12; progress(frac, 'read'); }, 400);
    try {
      const res = await fetch('/api/receipt/read', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image }),
      });
      if (!res.ok) throw new Error('ai ' + res.status);
      const r = await res.json();
      progress(1, 'read');
      return r;
    } finally {
      clearInterval(tick);
    }
  }

  // onProgress(fraction 0..1, stage) — stage is 'load' | 'read'
  async function scanReceipt(file, onProgress) {
    const progress = onProgress || function () {};
    if (await aiEnabled()) {
      try { return await readWithAI(file, progress); }
      catch (err) { console.warn('AI receipt reading failed, using on-phone OCR', err); }
    }
    progress(0.02, 'load');
    const [T, canvas] = await Promise.all([loadLib(), prepareImage(file)]);
    const worker = await T.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') progress(0.3 + 0.7 * (m.progress || 0), 'read');
        else progress(Math.min(0.3, 0.05 + 0.25 * (m.progress || 0)), 'load');
      },
    });
    try {
      // PSM 6 = "one uniform block of text" — what a receipt is, and it keeps
      // each item's name and price on the same line.
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      const { data } = await worker.recognize(canvas);
      progress(1, 'read');
      const parsed = parseReceipt(data.text);
      parsed.rawText = data.text;
      return parsed;
    } finally {
      worker.terminate();
    }
  }

  const api = { parseReceipt, scanReceipt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaypointReceipt = api;
})(typeof window !== 'undefined' ? window : globalThis);
