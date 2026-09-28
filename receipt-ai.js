// AI receipt reading for Split Bill.
//
// When an AI key is set (see ai.js), the phone sends the receipt photo here
// and gets back every line item with its price, plus service charge / GST /
// total — far more reliable than on-phone OCR on crumpled or faded thermal
// paper. With no key, or if this fails, the app quietly falls back to the
// free on-phone OCR in public/receipt-scan.js.
//
// Optional limits (Railway → Variables): RECEIPT_DAILY_LIMIT (default 300 per
// day for everyone), RECEIPT_HOURLY_LIMIT (default 20 per hour per device).
const express = require('express');
const { provider, visionTool, makeLimiter, validImage } = require('./ai');

const TOOL = {
  name: 'read_receipt',
  description: 'Report the contents of a restaurant / shop receipt.',
  input_schema: {
    type: 'object',
    properties: {
      is_receipt: { type: 'boolean', description: 'false if the photo is not a receipt or bill' },
      merchant: { type: 'string', description: 'Shop or restaurant name as printed, or empty string' },
      items: {
        type: 'array',
        description: 'Every purchased line in order. Use the LINE TOTAL (qty × unit price) as amount. Discounts / vouchers as negative amounts. Exclude subtotal, service charge, GST/tax, rounding, total, payments and change.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Item name as printed (tidy capitalisation, keep sizes like 1.2kg)' },
            qty: { type: 'number', description: 'Quantity, 1 if not shown' },
            amount: { type: 'number', description: 'Line total in dollars, e.g. 36.00' },
          },
          required: ['name', 'qty', 'amount'],
        },
      },
      subtotal: { type: ['number', 'null'] },
      service_charge: { type: ['number', 'null'], description: 'Service charge amount if the receipt adds one, else null' },
      gst: { type: ['number', 'null'], description: 'GST amount if ADDED on top, else null' },
      gst_inclusive: { type: 'boolean', description: 'true if prices are stated to already include GST' },
      total: { type: ['number', 'null'], description: 'Final amount payable' },
    },
    required: ['is_receipt', 'merchant', 'items', 'subtotal', 'service_charge', 'gst', 'gst_inclusive', 'total'],
  },
};

const SYSTEM = [
  'You read restaurant and shop receipts (mostly from Singapore) for a bill-splitting app.',
  'Transcribe exactly what is printed — never guess or invent items or prices. If a price is unreadable, leave that item out.',
  'Always answer by calling the read_receipt tool.',
].join('\n');

const cents = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) : null);

function register(app) {
  const limit = makeLimiter({ dailyEnv: 'RECEIPT_DAILY_LIMIT', dailyDefault: 300, hourlyEnv: 'RECEIPT_HOURLY_LIMIT', hourlyDefault: 20 });

  app.get('/api/receipt/status', (req, res) => res.json({ enabled: !!provider() }));

  app.post('/api/receipt/read', express.json({ limit: '5mb' }), async (req, res) => {
    if (!provider()) return res.status(503).json({ error: 'disabled' });
    const { image } = req.body || {};
    if (!validImage(image)) return res.status(400).json({ error: 'bad_image' });
    const blocked = limit(req);
    if (blocked) return res.status(429).json({ error: blocked });
    try {
      const r = await visionTool({ system: SYSTEM, text: 'Read this receipt.', imageBase64: image, tool: TOOL, maxTokens: 2000, detail: 'high' });
      if (r.is_receipt === false) return res.json({ items: [], notReceipt: true });
      const items = (Array.isArray(r.items) ? r.items : [])
        .map((it) => {
          const qty = Number(it.qty) || 1;
          const name = String(it.name || '').trim();
          return { name: qty > 1 && !/^\d+\s*[x×]/i.test(name) ? `${qty}× ${name}` : name, cents: cents(Number(it.amount)) };
        })
        .filter((it) => it.name && it.cents);
      const svcCents = cents(r.service_charge);
      const gstCents = cents(r.gst);
      res.json({
        source: 'ai',
        title: String(r.merchant || '').slice(0, 40),
        items,
        subtotal: cents(r.subtotal),
        total: cents(r.total),
        svc: !!svcCents,
        svcCents,
        gst: !!gstCents && !r.gst_inclusive,
        gstCents,
        gstInclusive: !!r.gst_inclusive,
      });
    } catch (err) {
      console.error('Receipt AI failed:', err.message, err.status || '', err.detail ? JSON.stringify(err.detail).slice(0, 300) : '');
      res.status(502).json({ error: 'upstream' });
    }
  });
}

module.exports = { register };
