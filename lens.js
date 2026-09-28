// Waypoint Lens — "point your camera at it and learn what it is".
//
// A tourist photographs a landmark, sculpture, shophouse, temple detail, sign,
// menu or dish; we ask an AI vision model (ChatGPT or Claude) to identify it, translate any visible
// text, and explain its history/story in the tourist's language.
//
// Setup (Railway → Variables): OPENAI_API_KEY or ANTHROPIC_API_KEY — see
// ai.js. Until one is set the feature stays hidden in the app
// (/api/lens/status reports enabled:false). Roughly half a US cent per scan.
//   LENS_DAILY_LIMIT    optional — max scans per day across ALL users
//                       (default 300) so a bug or abuse can't run up the bill.
//   LENS_HOURLY_LIMIT   optional — max scans per hour per device/IP (default 15).
//
// Photos are resized on the phone (≤1024px JPEG) and sent straight through to
// the API; nothing is stored on this server.
const express = require('express');
const { provider, visionTool, makeLimiter, validImage } = require('./ai');

// code → language name used in the prompt. Keep in sync with LENS_LANGS in
// public/lens.js (the dropdown).
const LANGS = {
  en: 'English', zh: 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', ms: 'Malay', ta: 'Tamil',
  ja: 'Japanese', ko: 'Korean', th: 'Thai', id: 'Indonesian', vi: 'Vietnamese', tl: 'Filipino',
  hi: 'Hindi', ar: 'Arabic', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian',
  pt: 'Portuguese', ru: 'Russian', nl: 'Dutch',
};

const TOOL = {
  name: 'explain_photo',
  description: 'Report what is in the photo for a tourist in Singapore.',
  input_schema: {
    type: 'object',
    properties: {
      identified: { type: 'boolean', description: 'true if you recognise the specific thing (or at least clearly what kind of thing it is)' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      name: { type: 'string', description: 'What it is, in the target language. Specific name if known, else a short description.' },
      name_local: { type: 'string', description: 'Original/local name if different (e.g. Chinese characters, Malay or Tamil name). Empty string if none.' },
      kind: { type: 'string', enum: ['landmark', 'building', 'artwork', 'religious', 'food', 'sign', 'menu', 'plant_or_animal', 'object', 'other'] },
      summary: { type: 'string', description: '1–2 sentences: what the tourist is looking at.' },
      history: { type: 'string', description: 'The history / story / cultural meaning, max ~180 words, short paragraphs separated by a blank line. Empty string if nothing reliable to say.' },
      text_found: {
        type: 'array', maxItems: 8,
        description: 'Readable text in the photo (signs, plaques, menus), each with its translation. Empty if none or already in the target language.',
        items: { type: 'object', properties: { original: { type: 'string' }, translation: { type: 'string' } }, required: ['original', 'translation'] },
      },
      tip: { type: 'string', description: 'One practical visitor tip (opening hours to check, etiquette, what to try). Empty string if none.' },
      map_query: { type: 'string', description: 'If this is a specific findable place in Singapore, its name for a map search (in English). Otherwise empty string.' },
    },
    required: ['identified', 'confidence', 'name', 'name_local', 'kind', 'summary', 'history', 'text_found', 'tip', 'map_query'],
  },
};

function systemPrompt(langName) {
  return [
    "You are Waypoint's friendly pocket tour guide for visitors to Singapore.",
    'A tourist has pointed their phone camera at something and wants to know what it is, what any writing on it says, and the story behind it.',
    `Write every field in ${langName} (except text_found.original, which stays exactly as written in the photo, and map_query, which is English).`,
    'Be accurate above all: only state names, dates and facts you are genuinely confident about. If you are not sure what the specific thing is, say what it appears to be, set confidence to "low", and keep the history general (e.g. what such temples or shophouses are typically like) rather than inventing specifics.',
    'Do not identify real people from their faces or bodies. If the photo is mainly of a person, say you cannot identify people and describe the place or objects around them instead.',
    'Keep it warm, clear and short enough to read standing up: summary 1–2 sentences, history at most about 180 words.',
    'Always answer by calling the explain_photo tool.',
  ].join('\n');
}

function register(app) {
  const limit = makeLimiter({ dailyEnv: 'LENS_DAILY_LIMIT', dailyDefault: 300, hourlyEnv: 'LENS_HOURLY_LIMIT', hourlyDefault: 15 });

  app.get('/api/lens/status', (req, res) => {
    res.json({ enabled: !!provider(), languages: Object.keys(LANGS) });
  });

  app.post('/api/lens/explain', express.json({ limit: '5mb' }), async (req, res) => {
    if (!provider()) return res.status(503).json({ error: 'disabled' });
    const { image, lang } = req.body || {};
    if (!validImage(image)) return res.status(400).json({ error: 'bad_image' });
    const langCode = LANGS[lang] ? lang : 'en';
    const blocked = limit(req);
    if (blocked) return res.status(429).json({ error: blocked });
    try {
      const result = await visionTool({
        system: systemPrompt(LANGS[langCode]),
        text: `The photo was taken in Singapore. Explain it for a tourist, in ${LANGS[langCode]}.`,
        imageBase64: image,
        tool: TOOL,
      });
      res.json({ lang: langCode, result });
    } catch (err) {
      console.error('Lens failed:', err.message, err.status || '', err.detail ? JSON.stringify(err.detail).slice(0, 300) : '');
      res.status(502).json({ error: 'upstream' });
    }
  });
}

module.exports = { register, LANGS };
