// ─── Affiliate product info extraction ──────────────────────────────────────
// "Prefer official APIs, otherwise responsibly extract public details" — official
// affiliate APIs (Amazon PA-API, etc.) require signed requests and per-program
// approved credentials that can't be wired up or tested without a real approved
// account and live network access. What's implemented here — and fully working —
// is the extraction path: reading a product page's OWN publicly-embedded structured
// data (JSON-LD Product schema, Open Graph tags) — the exact same data search
// engines read to build rich results. This is not scraping hidden/private data; it's
// reading what the page's owner deliberately marked up for machines to read.
//
// OFFICIAL API EXTENSION POINT: to add a real API for a specific network once you
// have approved credentials for it, add a case in fetchProductInfo() that checks for
// that network's env vars and, if present, calls the real API instead of falling
// through to extraction below. Nothing else needs to change — generatePost's
// `products` option only cares about the final {name, url, price, ...} shape.

const axios = require('axios');
const { cloudinary } = require('../../config/cloudinary');

function detectNetwork(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (/amazon\./.test(host)) return 'amazon';
    if (/jumia\./.test(host)) return 'jumia';
    if (/konga\./.test(host)) return 'konga';
    if (/ebay\./.test(host)) return 'ebay';
    if (/aliexpress\./.test(host)) return 'aliexpress';
    if (/walmart\./.test(host)) return 'walmart';
    return 'generic';
  } catch {
    return 'generic';
  }
}

// Conservative by design: only a network with EXPLICITLY KNOWN terms is marked
// anything other than 'notify'. Amazon's Associates Operating Agreement explicitly
// prohibits caching/storing/rehosting their product images outside their own
// provided API/widgets — that's a real, specific restriction, not a guess. For every
// other network, terms vary and change, so the safe default is to notify the admin
// rather than assume it's fine to auto-download and rehost.
const NETWORK_IMAGE_POLICY = {
  amazon: 'restricted',
};

function getImagePolicy(network) {
  return NETWORK_IMAGE_POLICY[network] || 'notify';
}

// ── Fetch raw HTML (NOT stripped — aiService.fetchUrlContent strips tags/scripts,
// which is exactly what we need to still have, since JSON-LD lives in <script>). ──
async function fetchRawHtml(url) {
  const response = await axios.get(url, {
    timeout: 12000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorldMicBot/1.0; +https://worldmic-blog.onrender.com)' },
    responseType: 'text',
  });
  return response.data;
}

function extractMeta(html, property) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i');
  const match = html.match(re);
  return match ? match[1].trim() : '';
}

// JSON-LD Product schema — the most reliable source when present, since it's
// structured data the page owner deliberately provides for exactly this purpose.
function extractJsonLdProduct(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    try {
      let data = JSON.parse(block[1].trim());
      const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
      const product = items.find(item => {
        const type = item?.['@type'];
        return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
      });
      if (product) {
        const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        return {
          name: product.name || '',
          image: Array.isArray(product.image) ? product.image[0] : (product.image || ''),
          price: offer?.price ? String(offer.price) : '',
          currency: offer?.priceCurrency || '',
          description: product.description || '',
        };
      }
    } catch {
      // Malformed JSON-LD on the page isn't our bug to fix — just skip this block
      // and let the caller fall through to Open Graph / title extraction.
    }
  }
  return null;
}

// ── Extracts product info using JSON-LD first, then Open Graph, then <title>. ──
// Never throws for "couldn't find much" — a thin result (title-only) is still
// usable; generatePost just gets less to work with, same as any other input.
async function fetchProductInfo(url) {
  const network = detectNetwork(url);
  let html;
  try {
    html = await fetchRawHtml(url);
  } catch (err) {
    throw new Error(`Could not fetch product page (${err.message}). Check the link is public and reachable.`);
  }

  const jsonLd = extractJsonLdProduct(html);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].trim() : '';

  const name = jsonLd?.name || extractMeta(html, 'og:title') || pageTitle || 'Unnamed product';
  const price = jsonLd?.price || extractMeta(html, 'product:price:amount') || extractMeta(html, 'og:price:amount') || '';
  const currency = jsonLd?.currency || extractMeta(html, 'product:price:currency') || extractMeta(html, 'og:price:currency') || '';
  const description = jsonLd?.description || extractMeta(html, 'og:description') || '';
  const imageUrl = jsonLd?.image || extractMeta(html, 'og:image') || '';
  const extractionMethod = jsonLd ? 'structured-data' : (extractMeta(html, 'og:title') ? 'meta-tags' : 'title-only');

  return { url, network, name, price, currency, description, imageUrl, extractionMethod };
}

// ── Image handling — only actually downloads/rehosts when the network's policy
// allows it OR the admin has explicitly confirmed they have rights to (per-job
// override). Otherwise returns a clear notice instead of silently skipping. ──
async function handleProductImage(product, { adminConfirmedRights = false } = {}) {
  if (!product.imageUrl) {
    return { imageStatus: 'skipped', imageNotice: 'No product image found on the page.' };
  }
  const policy = getImagePolicy(product.network);
  if (policy === 'restricted' && !adminConfirmedRights) {
    return {
      imageStatus: 'notified',
      imageNotice: `${product.network} restricts rehosting product images outside their own API/widgets — image was not downloaded. Add one manually if you have rights to, or confirm rights to override this.`,
    };
  }
  if (policy === 'notify' && !adminConfirmedRights) {
    return {
      imageStatus: 'notified',
      imageNotice: `Image terms for ${product.network} aren't confirmed safe to rehost — image was not downloaded. Confirm you have rights to use it to override this, or add one manually.`,
    };
  }
  try {
    const upload = await cloudinary.uploader.upload(product.imageUrl, { folder: 'worldmic/affiliate-products' });
    return { imageStatus: 'uploaded', imageCloudinaryUrl: upload.secure_url, imageNotice: '' };
  } catch (err) {
    return { imageStatus: 'failed', imageNotice: `Image upload failed: ${err.message}` };
  }
}

module.exports = { detectNetwork, getImagePolicy, fetchProductInfo, handleProductImage };
