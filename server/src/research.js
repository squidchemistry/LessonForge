// Research stage: web (Tavily), YouTube (Data API + transcripts) and books (Open Library).
// Produces a "source pack": the ONLY material the generator may cite, so links are never invented.
import { YoutubeTranscript } from 'youtube-transcript';

const clip = (s, n) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const decode = (s) => s.replace(/&amp;#39;|&#39;/g, "'").replace(/&amp;quot;|&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export async function tavily(query, opts = {}) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY is not set');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: query.slice(0, 390), search_depth: 'advanced', max_results: 6, include_answer: false, ...opts }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${clip(await res.text(), 200)}`);
  return (await res.json()).results || [];
}

// Low-signal social/UGC sites are excluded; well-known authoritative hosts are ranked first.
const EXCLUDE = ['reddit.com', 'linkedin.com', 'quora.com', 'facebook.com', 'x.com', 'twitter.com', 'pinterest.com', 'instagram.com', 'tiktok.com', 'github.com', 'stackoverflow.com'];
const TRUSTED = /(^|\.)(developer\.mozilla\.org|mozilla\.org|rfc-editor\.org|ietf\.org|w3\.org|whatwg\.org|wikipedia\.org|python\.org|nodejs\.org|oracle\.com|microsoft\.com|cloudflare\.com|ibm\.com|aws\.amazon\.com|google\.com|redhat\.com|khanacademy\.org|nih\.gov|nist\.gov)$|\.(edu|gov|ac\.uk)$|^docs\.|^developer\./;
export const trustRank = (host) => (TRUSTED.test(host) ? 0 : 1);

async function searchWeb(title, objective) {
  const queries = [`${title}: ${objective}`, `${title} explained official documentation specification`];
  const settled = await Promise.allSettled(queries.map((q) => tavily(q, { exclude_domains: EXCLUDE, max_results: 8 })));
  const results = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  if (settled.every((s) => s.status === 'rejected')) throw settled[0].reason;
  // Drop weak matches (Tavily relevance score) when enough good ones remain, then rank trusted hosts first.
  // Raw file downloads/attachments on non-trusted hosts are unstable, unattributable mirrors - not citable pages.
  // Download/attachment URLs are dropped on any host; plain file links (pdf, docx...) only on non-trusted hosts.
  const isFileDump = (u) => /download|attachment|artifactid/i.test(u) || (/\.(pdf|docx?|pptx?|xlsx?)(\?|$)/i.test(u) && trustRank(hostOf(u)) !== 0);
  const clean = results.filter((r) => !isFileDump(r.url));
  if (clean.length >= 4) results.splice(0, results.length, ...clean);
  const strong = results.filter((r) => (r.score ?? 1) >= 0.3);
  const pool = strong.length >= 4 ? strong : results;
  pool.sort((a, b) => trustRank(hostOf(a.url)) - trustRank(hostOf(b.url))); // stable: keeps relevance order within a tier
  results.splice(0, results.length, ...pool);
  const seen = new Set();
  const out = [];
  for (const r of results) {
    const key = r.url.split('#')[0].replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: 'web', title: r.title, url: r.url, domain: hostOf(r.url), excerpt: clip(r.content, 2600) });
    if (out.length >= 8) break;
  }
  return out;
}

const isoToMin = (iso) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '') || [];
  return (+m[1] || 0) * 60 + (+m[2] || 0) + (+m[3] || 0) / 60;
};

async function searchYouTube(title, objective) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set');
  const q = `${title} ${objective}`.slice(0, 120);
  const s = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=10&relevanceLanguage=en&q=${encodeURIComponent(q)}&key=${key}`, { signal: AbortSignal.timeout(20_000) });
  if (!s.ok) throw new Error(`YouTube search ${s.status}: ${clip(await s.text(), 200)}`);
  const items = (await s.json()).items || [];
  if (!items.length) return [];
  const ids = items.map((i) => i.id.videoId).join(',');
  const d = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${ids}&key=${key}`, { signal: AbortSignal.timeout(20_000) });
  if (!d.ok) throw new Error(`YouTube details ${d.status}`);
  const details = Object.fromEntries(((await d.json()).items || []).map((v) => [v.id, v]));
  const cands = items
    .map((i) => {
      const det = details[i.id.videoId];
      return { id: i.id.videoId, snippet: i.snippet, minutes: det ? isoToMin(det.contentDetails.duration) : 0, views: +(det?.statistics?.viewCount || 0) };
    })
    .filter((c) => c.minutes >= 2 && c.minutes <= 25)
    .slice(0, 5);
  return Promise.all(cands.map(async (c) => {
    let transcript = null;
    try {
      const t = await withTimeout(YoutubeTranscript.fetchTranscript(c.id, { lang: 'en' }), 15_000);
      transcript = decode(t.map((x) => x.text).join(' '));
    } catch { /* captions unavailable */ }
    const desc = clip(c.snippet.description, 400);
    return {
      type: 'video',
      title: decode(c.snippet.title),
      url: `https://www.youtube.com/watch?v=${c.id}`,
      domain: 'youtube.com',
      videoId: c.id,
      channel: decode(c.snippet.channelTitle),
      minutes: Math.round(c.minutes * 10) / 10,
      views: c.views,
      hasTranscript: !!transcript,
      excerpt: clip(`Channel: ${c.snippet.channelTitle}. Length: ${Math.round(c.minutes)} min. Description: ${desc} ${transcript ? 'Transcript excerpt: ' + transcript : '(No transcript available - relevance judged from title/description only.)'}`, 3000),
    };
  }));
}

async function searchBooks(title) {
  const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(title)}&limit=6&fields=key,title,author_name,first_publish_year,subject`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Open Library ${res.status}`);
  const docs = (await res.json()).docs || [];
  return docs.slice(0, 3).map((d) => ({
    type: 'book',
    title: d.title,
    url: `https://openlibrary.org${d.key}`,
    domain: 'openlibrary.org',
    excerpt: clip(`Book metadata only (content not read). Authors: ${(d.author_name || []).slice(0, 3).join(', ') || 'unknown'}. First published: ${d.first_publish_year || 'unknown'}. Subjects: ${(d.subject || []).slice(0, 6).join(', ')}.`, 400),
  }));
}

export async function runResearch({ title, objective }) {
  const warnings = [];
  const [web, vid, book] = await Promise.allSettled([searchWeb(title, objective), searchYouTube(title, objective), searchBooks(title)]);
  const pick = (r, name) => {
    if (r.status === 'fulfilled') {
      if (!r.value.length) warnings.push(`${name}: no results found.`);
      return r.value;
    }
    warnings.push(`${name} search failed: ${r.reason?.message || r.reason}`);
    return [];
  };
  const webSrc = pick(web, 'Web');
  const vidSrc = pick(vid, 'YouTube');
  const bookSrc = pick(book, 'Books');
  if (!webSrc.length) {
    throw new Error(`Web research returned nothing, so there is no material to ground the lesson. ${warnings.join(' ')}`);
  }
  const sources = [...webSrc, ...vidSrc, ...bookSrc].map((s, i) => ({ id: `S${i + 1}`, ...s }));
  return { sources, warnings, at: new Date().toISOString() };
}

export function sourcePackText(sources, { maxExcerpt = 2600 } = {}) {
  return sources.map((s) => `[${s.id}] (${s.type}) ${s.title}\nURL: ${s.url}\n${clip(s.excerpt, maxExcerpt)}`).join('\n\n---\n\n');
}
