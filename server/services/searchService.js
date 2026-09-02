// ─── Modular research layer for the Auto Publisher ─────────────────────────────
// Design: keep providers swappable. Each provider implements the same shape:
//   async (query) => [{ title, link, snippet, date? }, ...]
// New providers (Bing, SerpAPI, etc.) can be added to PROVIDERS without touching
// the rest of the pipeline.

const ai = require('./aiService'); // reused, not duplicated — see webSearch() below
const { Settings } = require('../models/Models');

async function getSetting(key) {
  const doc = await Settings.findOne({ key });
  return doc?.value;
}

// ── Provider: Serper.dev (reuses the EXISTING WorldMic search integration) ──
async function serperProvider(query) {
  // ai.webSearch already reads the configured Serper key from Settings and throws a
  // clear error if none is set — we deliberately don't duplicate that lookup here.
  return ai.webSearch(query);
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

async function browserProvider(query) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (compatible; WorldMicAutoPublisher/1.0)');
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`, {
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

// ── Which provider to use ──────────────────────────────────────────────────
// 'auto' (default): use Serper if a key is configured, otherwise fall back to the
// browser. Admin can force one or the other via AutoPublisherConfig.searchProvider.
async function resolveProvider(preference = 'auto') {
  if (preference === 'serper') return { name: 'serper', fn: serperProvider };
  if (preference === 'browser') return { name: 'browser', fn: browserProvider };
  const hasSerperKey = !!(await getSetting('serperApiKey'));
  return hasSerperKey ? { name: 'serper', fn: serperProvider } : { name: 'browser', fn: browserProvider };
}

// ── Research a topic across multiple queries, dedupe, and open top pages for
// deeper extraction (reusing aiService.fetchUrlContent so there's only one
// "fetch + strip HTML" implementation in the codebase). ──────────────────────
async function researchTopic(topic, { minSources = 3, providerPreference = 'auto' } = {}) {
  const { name, fn } = await resolveProvider(providerPreference);

  // Multiple angles on the same topic, not just one query, per the spec.
  const queries = [topic, `${topic} latest`, `${topic} explained`];
  const seen = new Map(); // link -> result, de-duplicated across queries
  for (const q of queries) {
    try {
      const results = await fn(q);
      for (const r of results) {
        if (r.link && !seen.has(r.link)) seen.set(r.link, r);
      }
    } catch (err) {
      // One query failing isn't fatal — try the others before giving up.
      console.warn(`[autoPublisher] search query failed ("${q}" via ${name}):`, err.message);
    }
    if (seen.size >= minSources * 2) break; // enough raw material already
  }

  const results = [...seen.values()];
  if (results.length < minSources) {
    throw new Error(
      `Research failed: only found ${results.length} usable source(s) for "${topic}" ` +
      `(need at least ${minSources}). Failing safely — nothing will be published.`
    );
  }

  // Prefer results that look like real articles over aggregators/social, and cap how
  // many pages we open to keep runtime and outbound requests bounded.
  const prioritized = results.sort((a, b) => (b.snippet?.length || 0) - (a.snippet?.length || 0));
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

  return { providerUsed: name, sources: opened };
}

module.exports = { researchTopic, resolveProvider };
