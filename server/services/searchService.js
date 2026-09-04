// ─── Modular research layer for the Auto Publisher ─────────────────────────────
// Design: keep providers swappable. Each provider implements the same shape:
//   async (query, options) => [{ title, link, snippet, date? }, ...]
// New providers (Bing, SerpAPI, etc.) can be added to PROVIDERS without touching
// the rest of the pipeline.

const ai = require('./aiService'); // reused, not duplicated — see googleSearch()/webSearch() there

// ── Provider: Serper.dev (reuses the EXISTING WorldMic search integration) ──
async function serperProvider(query, { freshness = '' } = {}) {
  // ai.webSearch already reads the configured Serper key from Settings and throws a
  // clear error if none is set — we deliberately don't duplicate that lookup here.
  return ai.webSearch(query, { freshness });
}

// ── Provider: headless-browser Google search fallback ──────────────────────
// Only used when no search API is configured. Requires the optional `puppeteer`
// dependency; if it isn't installed (e.g. a constrained host), this fails fast with
// a clear error rather than crashing the process, and the caller treats that as a
// research failure like any other (job fails safely, nothing gets published).
let _browserPromise = null;
async function getBrowser() {
  if (_browserPromise) return _browserPromise;
  _browserPromise = (async () => {
    let puppeteer;
    try {
      puppeteer = require('puppeteer');
    } catch {
      throw new Error(
        'No search API key is configured and the optional "puppeteer" package is not installed, ' +
        'so the browser-based search fallback is unavailable. Either add a Serper.dev key in ' +
        'Admin → Settings → AI Configuration, or run `npm install puppeteer` on this server.'
      );
    }
    return puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  })();
  return _browserPromise;
}

async function browserProvider(query, { freshness = '' } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (compatible; WorldMicAutoPublisher/1.0)');
    const tbsParam = freshness ? `&tbs=${encodeURIComponent(freshness)}` : '';
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&num=10${tbsParam}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    const results = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('div.g, div[data-sokoban-container]').forEach(el => {
        const linkEl = el.querySelector('a');
        const titleEl = el.querySelector('h3');
        const snippetEl = el.querySelector('div[data-sncf], div.VwiC3b, span.aCOpRe');
        const link = linkEl?.href;
        const title = titleEl?.textContent;
        if (link && title) out.push({ title, link, snippet: snippetEl?.textContent || '' });
      });
      return out;
    });
    if (!results.length) throw new Error('Browser-based Google search returned no results for that query');
    return results.slice(0, 8);
  } finally {
    await page.close().catch(() => {});
  }
}

// ── Provider: Google Custom Search (reuses aiService.googleSearch/isGoogleSearchConfigured) ──
async function googleProvider(query, { freshness = '' } = {}) {
  return ai.googleSearch(query, { freshness });
}

// ── Which provider(s) to use, in order ──────────────────────────────────────
// Returns an ORDERED CHAIN, not a single pick — 'auto' mode needs real runtime
// fallback (a Google quota error mid-run should still recover via Serper within the
// same research pass), not just a one-time config check. An explicit choice
// ('google' | 'serper' | 'browser') returns a chain of length 1, so it behaves
// exactly as before: that provider's failure propagates with no silent fallback.
// 'auto': Google (if configured) → Serper → the browser fallback, each only reached
// if everything before it is unconfigured or actually fails at runtime.
function buildProviderChain(preference = 'auto') {
  if (preference === 'google') return [{ name: 'google', fn: googleProvider }];
  if (preference === 'serper') return [{ name: 'serper', fn: serperProvider }];
  if (preference === 'browser') return [{ name: 'browser', fn: browserProvider }];
  const chain = [];
  if (ai.isGoogleSearchConfigured()) chain.push({ name: 'google', fn: googleProvider });
  chain.push({ name: 'serper', fn: serperProvider }); // serperProvider itself throws a clear error if no key is set
  chain.push({ name: 'browser', fn: browserProvider });
  return chain;
}

// ── Best-effort recency scoring so genuinely fresh results are preferred when
// deciding which pages to open, without unfairly burying undated organic results
// (which are common and often high-quality) at the bottom. Unknown/undated dates
// score neutral (0) rather than worst, and only break ties via snippet length below.
function recencyScore(dateStr) {
  if (!dateStr) return 0;
  let ts = Date.parse(dateStr);
  if (Number.isNaN(ts)) {
    const rel = dateStr.match(/(\d+)\s*(hour|day|week|month|year)s?\s*ago/i);
    if (!rel) return 0;
    const n = parseInt(rel[1], 10);
    const msPer = { hour: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.628e9, year: 3.154e10 };
    ts = Date.now() - n * (msPer[rel[2].toLowerCase()] || msPer.day);
  }
  const daysAgo = (Date.now() - ts) / 8.64e7;
  if (daysAgo < 0) return 0; // future-dated/garbage, treat neutral rather than trust blindly
  return Math.max(0, 1 - daysAgo / 180); // decays to ~0 over 6 months; recent items score near 1
}

// ── Research a topic across multiple queries, dedupe, and open top pages for
// deeper extraction (reusing aiService.fetchUrlContent so there's only one
// "fetch + strip HTML" implementation in the codebase). ──────────────────────
async function researchTopic(topic, { minSources = 3, providerPreference = 'auto' } = {}) {
  const chain = buildProviderChain(providerPreference);
  let activeIndex = 0; // once a provider works for a query, keep using it for the rest
  let providerUsed = chain[0].name;

  // Recency-biased by default — this is what actually fixes "the research is about
  // past years": without a time filter, a search engine returns whatever ranks best
  // by general relevance, which is very often an old, well-established page rather
  // than something current. 'freshness' maps to Google/Serper's tbs recency filter;
  // the browser-fallback provider ignores unknown options harmlessly.
  const queries = [
    { q: `${topic} news`, freshness: 'qdr:w' },   // past week — the freshest angle
    { q: `${topic} latest`, freshness: 'qdr:m' },  // past month — still very current
    { q: topic, freshness: 'qdr:m' },
    { q: `${topic} explained`, freshness: '' },    // unrestricted background/context
  ];
  const seen = new Map(); // link -> result, de-duplicated across queries
  for (const { q, freshness } of queries) {
    // Try the currently-active provider first; on failure, walk forward through the
    // rest of the chain for THIS query. For an explicit single-provider preference,
    // the chain has only one link, so this is identical to the old try-once behavior.
    for (let i = activeIndex; i < chain.length; i++) {
      try {
        const results = await chain[i].fn(q, { freshness });
        for (const r of results) if (r.link && !seen.has(r.link)) seen.set(r.link, r);
        activeIndex = i;
        providerUsed = chain[i].name;
        break;
      } catch (err) {
        console.warn(`[autoPublisher] ${chain[i].name} search failed ("${q}"):`, err.message);
        // Only actually advance activeIndex once we confirm the NEXT provider exists
        // and works — handled implicitly by the inner loop continuing to i+1.
      }
    }
    if (seen.size >= minSources * 2) break; // enough raw material already
  }

  // A tight recency window can legitimately return too little for a thin/niche topic.
  // Rather than fail research outright, widen to an unrestricted query as a fallback —
  // this keeps evergreen and low-coverage topics working while still preferring fresh
  // results whenever they exist.
  if (seen.size < minSources) {
    try {
      const fallback = await chain[activeIndex].fn(topic, { freshness: '' });
      for (const r of fallback) if (r.link && !seen.has(r.link)) seen.set(r.link, r);
    } catch (err) {
      console.warn(`[autoPublisher] unrestricted fallback search failed for "${topic}":`, err.message);
    }
  }

  const results = [...seen.values()];
  if (results.length < minSources) {
    throw new Error(
      `Research failed: only found ${results.length} usable source(s) for "${topic}" ` +
      `(need at least ${minSources}). Failing safely — nothing will be published.`
    );
  }

  // Prefer genuinely recent, real-article results over aggregators/social, and cap
  // how many pages we open to keep runtime and outbound requests bounded. Recency
  // dominates the ranking; snippet length only breaks ties among similarly-dated
  // (or undated) results, same as before.
  const prioritized = results.sort((a, b) => {
    const recencyDiff = recencyScore(b.date) - recencyScore(a.date);
    if (Math.abs(recencyDiff) > 0.02) return recencyDiff;
    return (b.snippet?.length || 0) - (a.snippet?.length || 0);
  });
  const toOpen = prioritized.slice(0, Math.min(5, prioritized.length));

  const opened = [];
  for (const r of toOpen) {
    try {
      const page = await ai.fetchUrlContent(r.link);
      opened.push({ ...r, extractedText: page.text });
    } catch {
      // A page refusing to be fetched is normal (paywalls, bot-blocking) — keep the
      // snippet-level result rather than failing the whole research step for it.
      opened.push(r);
    }
  }

  return { providerUsed, sources: opened };
}

module.exports = { researchTopic, buildProviderChain };
