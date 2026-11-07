// Minimal Gemini REST client with JSON output, retries/backoff and model fallback.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(t);
}

async function callOnce(model, { system, prompt, temperature, maxTokens }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('GEMINI_API_KEY is not set in server/.env'), { fatal: true });
  let res;
  try {
    res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json', maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(150_000),
    });
  } catch (e) {
    throw Object.assign(new Error(`Network error calling Gemini: ${e.message}`), { retryable: true });
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    const err = new Error(`Gemini ${model} returned ${res.status}: ${body}`);
    err.status = res.status;
    err.retryable = [429, 500, 502, 503, 504].includes(res.status);
    err.skipModel = res.status === 404 || res.status === 429;
    err.fatal = res.status === 400 || res.status === 401 || res.status === 403;
    throw err;
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) {
    throw Object.assign(new Error(`Gemini returned no content (finishReason=${cand?.finishReason ?? data.promptFeedback?.blockReason ?? 'unknown'})`), { retryable: true });
  }
  try {
    return parseJson(text);
  } catch {
    throw Object.assign(new Error(`Gemini returned invalid JSON${cand?.finishReason === 'MAX_TOKENS' ? ' (output truncated)' : ''}`), { retryable: true });
  }
}

export async function generateJSON({ system, prompt, temperature = 0.4, maxTokens = 24000 }) {
  const models = (process.env.GEMINI_MODELS || 'gemini-3.5-flash').split(',').map((s) => s.trim()).filter(Boolean);
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callOnce(model, { system, prompt, temperature, maxTokens });
      } catch (e) {
        lastErr = e;
        if (e.fatal) throw e;
        if (e.status === 429 && attempt < 1) { await sleep(8000); continue; }
        if (e.skipModel) break; // try next model in the chain
        if (e.retryable) { await sleep(2000 * 2 ** attempt); continue; }
        throw e;
      }
    }
  }
  throw lastErr || new Error('Gemini request failed');
}
