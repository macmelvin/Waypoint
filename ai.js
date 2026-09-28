// Shared AI vision helper for Waypoint (Lens + receipt reading).
//
// Works with EITHER provider — set one key in Railway → Variables:
//   OPENAI_API_KEY     → ChatGPT (default model gpt-4.1-mini)
//   ANTHROPIC_API_KEY  → Claude  (default model Claude Haiku 4.5)
// If both are set, OpenAI is used unless AI_PROVIDER=anthropic.
// AI_MODEL overrides the model name for whichever provider is active.
// AI_API_URL overrides the endpoint — only for local testing.
//
// Every call forces a single "tool"/function call so the answer comes back as
// structured JSON we can trust the shape of, not free text to parse.

const DEFAULTS = {
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini' },
  anthropic: { url: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-4-5-20251001' },
};

function env(name) { return (process.env[name] || '').trim(); }

function provider() {
  const hasOpenAI = !!env('OPENAI_API_KEY');
  const hasAnthropic = !!env('ANTHROPIC_API_KEY');
  if (env('AI_PROVIDER') === 'anthropic' && hasAnthropic) return 'anthropic';
  if (hasOpenAI) return 'openai';
  if (hasAnthropic) return 'anthropic';
  return null;
}

// Returns the tool's input object, or throws.
async function visionTool({ system, text, imageBase64, tool, maxTokens = 1500, detail = 'auto', timeoutMs = 45000 }) {
  const p = provider();
  if (!p) throw new Error('ai_disabled');
  const url = env('AI_API_URL') || DEFAULTS[p].url;
  const model = env('AI_MODEL') || DEFAULTS[p].model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res, data;
    if (p === 'openai') {
      res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env('OPENAI_API_KEY')}` },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: [
              { type: 'text', text },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail } },
            ] },
          ],
          tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }],
          tool_choice: { type: 'function', function: { name: tool.name } },
        }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error('upstream'), { status: res.status, detail: data && data.error });
      const call = (((data.choices || [])[0] || {}).message || {}).tool_calls;
      const args = call && call[0] && call[0].function && call[0].function.arguments;
      if (!args) throw new Error('no_result');
      return JSON.parse(args);
    }
    res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text },
        ] }],
      }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error('upstream'), { status: res.status, detail: data && data.error });
    const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (!block || !block.input) throw new Error('no_result');
    return block.input;
  } finally {
    clearTimeout(timer);
  }
}

// Per-feature spending guard: a daily cap across everyone plus an hourly cap
// per device (IP). Returns null when allowed, or an error code.
function makeLimiter({ dailyEnv, dailyDefault, hourlyEnv, hourlyDefault }) {
  const hourly = new Map();
  let day = '';
  let dayCount = 0;
  return function check(req) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; dayCount = 0; }
    if (dayCount >= (parseInt(process.env[dailyEnv], 10) || dailyDefault)) return 'daily_limit';
    const key = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hourly.get(key) || []).filter((ts) => now - ts < 3600000);
    if (recent.length >= (parseInt(process.env[hourlyEnv], 10) || hourlyDefault)) return 'hourly_limit';
    recent.push(now);
    hourly.set(key, recent);
    if (hourly.size > 5000) for (const [k, v] of hourly) if (!v.some((ts) => now - ts < 3600000)) hourly.delete(k);
    dayCount++;
    return null;
  };
}

function validImage(image) {
  return typeof image === 'string' && image.length >= 1000 && image.length <= 4500000 && /^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200));
}

module.exports = { provider, visionTool, makeLimiter, validImage };
