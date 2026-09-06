require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const connectDB = require('../config/db');
const { Settings, StaffUser } = require('./models/Models');
const Post = require('./models/Post');

const app = express();
connectDB();

// Render (like most PaaS) terminates TLS at its edge and forwards requests to this
// app over plain HTTP internally, setting an X-Forwarded-Proto header to say so.
// Without this, req.protocol always reports 'http' even though visitors are on
// https — every canonical tag, OG:url, sitemap.xml URL, and robots.txt sitemap
// reference built from req.protocol below was silently generating http:// URLs.
// Google then sees a page served over https with a canonical/OG url pointing at a
// DIFFERENT (http) URL, treats them as separate pages, and typically defers or skips
// indexing the mismatched one — a very common real-world cause of "crawls fine but
// won't index." No other code in this file reads req.ip, so this has no other effect.
app.set('trust proxy', 1);

app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

function formatDateServer(date, full = false) {
  const d = new Date(date);
  if (full) return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function readingTimeServer(content) {
  const words = content?.replace(/<[^>]*>/g, '').split(/\s+/).length || 0;
  return Math.max(1, Math.round(words / 200));
}

// Must come BEFORE express.static so it can intercept /post.html and inject real
// per-post meta tags AND the actual post content — search engines and social crawlers
// don't reliably wait for (or execute) the client-side JS fetch that normally loads the
// article, so without this, pages can look empty/erroring to them even though a real
// browser sees the content fine.
async function renderPostPage(req, res, post) {
  const fs = require('fs');
  const filePath = path.join(__dirname, '../public/post.html');
  let html = fs.readFileSync(filePath, 'utf8');

  let title = 'World Mic';
  let description = 'A multi-category blog covering news, culture, tech, and more.';
  let image = `${req.protocol}://${req.get('host')}/images/app-icon.svg`;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  let statusCode = 200;
  let postContentHtml = '';
  let postIdScript = '';

  if (post && post.status === 'published') {
    title = `${post.seoTitle || post.title || 'World Mic'} — World Mic`;
    description = post.seoDescription || post.excerpt || description;
    image = post.featuredImage || image;
    postIdScript = `<script>window.__POST_ID__=${JSON.stringify(String(post._id))};</script>`;

    postContentHtml = `
      ${post.featuredImage ? `<img src="${post.featuredImage}" alt="${post.title}" class="post-hero-image" />` : ''}
      <div class="post-content-area">
        <div class="card-category" style="margin-bottom:10px">${post.category || 'General'}</div>
        <h1 class="post-title">${post.title}</h1>
        <div class="post-meta-bar">
          <span>📅 ${formatDateServer(post.createdAt, true)}</span>
          <span>✍️ ${post.authorUsername ? `<a href="/author.html?u=${post.authorUsername}" style="color:inherit;text-decoration:underline">${post.author || post.authorUsername}</a>` : (post.author || 'World Mic')}</span>
          <span>⏱ ${readingTimeServer(post.content)} min read</span>
          <span>👁 ${post.views} views</span>
        </div>
        <div class="post-body">${post.content}</div>
        ${post.tags?.length ? `<div class="post-tags">${post.tags.map(t => `<span class="tag">#${t}</span>`).join('')}</div>` : ''}
        <div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm like-btn" id="likeBtn" onclick="toggleLike()">🤍 <span id="likeCount">${post.likes || 0}</span></button>
          <button class="btn btn-secondary btn-sm" onclick="sharePost('twitter')">🐦 Tweet</button>
          <button class="btn btn-secondary btn-sm" onclick="sharePost('facebook')">👍 Share</button>
          <button class="btn btn-secondary btn-sm" onclick="sharePost('copy')">🔗 Copy Link</button>
        </div>
        <div class="ad-slot" data-ad-slot="content" style="margin-top:28px"></div>
      </div>`;
  } else {
    // Post doesn't exist, was deleted, or isn't published yet — this URL is genuinely
    // not a real page, so tell crawlers that with a real 404 instead of a "soft 404"
    // (200 OK + "not found" text), which Google flags and refuses to index either way.
    statusCode = 404;
    title = 'Post Not Found — World Mic';
    description = 'The post you\u2019re looking for doesn\u2019t exist or has been removed.';
  }

  html = html
    .replace(/__META_TITLE__/g, title.replace(/"/g, '&quot;'))
    .replace(/__META_DESCRIPTION__/g, description.replace(/"/g, '&quot;'))
    .replace(/__META_IMAGE__/g, image)
    .replace(/__META_URL__/g, url)
    .replace('<div id="postContent"></div>', `<div id="postContent">${postContentHtml}</div>`)
    .replace('</head>', `${postIdScript}</head>`);

  res.status(statusCode).send(html);
}

// Shared post-card markup, mirrored from public/js/main.js's postCardHTML() so the
// server-rendered grids (home/category/author) match what the client re-renders once
// its own JS runs. Keep the two in sync if the card markup changes.
function postCardHtmlServer(post) {
  return `
      <div class="post-card">
        <div class="post-card-img">
          ${post.featuredImage ? `<img src="${post.featuredImage}" alt="${post.title}" loading="lazy" />` : `<div class="no-img"></div>`}
        </div>
        <div class="card-body">
          <div class="card-category">${post.category || 'General'}</div>
          <h3 class="card-title"><a href="/post/${post.slug}">${post.title}</a></h3>
          <p class="card-excerpt">${post.excerpt || ''}</p>
        </div>
        <div class="card-footer">
          <div class="card-meta">
            <span>${formatDateServer(post.createdAt)}</span>
            <span>${readingTimeServer(post.content)} min read</span>
          </div>
          <a href="/post/${post.slug}" class="btn btn-sm btn-secondary">Read →</a>
        </div>
      </div>`;
}

const LISTING_SELECT = 'title excerpt featuredImage category slug createdAt content likes views';

// Homepage — same rationale as renderPostPage above: without this, Googlebot's first
// (non-JS) fetch of "/" sees an empty #postsGrid, and non-JS crawlers/link-preview bots
// never see any posts at all. Must come before express.static, since express.static
// would otherwise serve the raw index.html file for "/" directly.
app.get('/', async (req, res, next) => {
  try {
    const fs = require('fs');
    const filePath = path.join(__dirname, '../public/index.html');
    let html = fs.readFileSync(filePath, 'utf8');

    const posts = await Post.find({ status: 'published' })
      .sort({ createdAt: -1 })
      .limit(9)
      .select(LISTING_SELECT)
      .catch(() => []);

    if (posts.length) {
      const [featured, ...rest] = posts;
      const heroHtml = `
        <div class="hero-inner">
          <div class="hero-badge">Featured</div>
          <h1 class="hero-title"><a href="/post/${featured.slug}" style="color:inherit">${featured.title}</a></h1>
          <p class="hero-excerpt">${featured.excerpt || ''}</p>
          <div class="hero-meta">
            <span>${formatDateServer(featured.createdAt, true)}</span>
            <span>·</span>
            <span>${featured.category || 'General'}</span>
            <span>·</span>
            <span>${readingTimeServer(featured.content)} min read</span>
          </div>
          <a href="/post/${featured.slug}" class="btn btn-primary" style="margin-top:20px">Read Article →</a>
        </div>`;
      const gridHtml = rest.map(postCardHtmlServer).join('');

      html = html
        .replace(
          '<section class="hero-section" id="heroSection" style="display:none"></section>',
          `<section class="hero-section" id="heroSection">${heroHtml}</section>`
        )
        .replace(
          '<div class="posts-grid" id="postsGrid"></div>',
          `<div class="posts-grid" id="postsGrid">${gridHtml}</div>`
        );
    }

    res.send(html);
  } catch (err) {
    next(); // fall back to the normal static file on any unexpected error
  }
});

// Category listing — same technique as "/", parameterised by ?name=. Keeps the existing
// query-string URL scheme (already linked everywhere) rather than introducing a new one.
app.get('/category.html', async (req, res, next) => {
  try {
    const fs = require('fs');
    const filePath = path.join(__dirname, '../public/category.html');
    let html = fs.readFileSync(filePath, 'utf8');

    const catName = (req.query.name || '').toString().trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 9;
    const query = { status: 'published' };
    if (catName) query.category = new RegExp(`^${catName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

    const [posts, categories] = await Promise.all([
      Post.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select(LISTING_SELECT),
      Post.distinct('category', { status: 'published' }),
    ]);

    const heading = catName ? `${catName} Posts` : 'All Posts';
    const title = `${catName ? `${catName} — ` : ''}Categories — World Mic`;
    const description = catName
      ? `Browse all World Mic articles in the ${catName} category.`
      : 'Browse World Mic articles by category — news, culture, tech, and more.';
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const gridHtml = posts.length
      ? posts.map(postCardHtmlServer).join('')
      : `<div class="empty-state"><h3>No posts in this category</h3><p>Check back soon.</p></div>`;
    const catListHtml = categories.map(c =>
      `<li class="trending-item"><div class="trending-title"><a href="/category.html?name=${encodeURIComponent(c)}" class="${c === catName ? 'active' : ''}">${c}</a></div></li>`
    ).join('');

    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(
        '</head>',
        `<meta name="description" content="${description.replace(/"/g, '&quot;')}" />\n` +
        `<link rel="canonical" href="${url}" />\n` +
        `<meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />\n` +
        `<meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />\n</head>`
      )
      .replace('<span id="pageTitle">Categories</span>', `<span id="pageTitle">${catName || 'Categories'}</span>`)
      .replace('<h2 class="section-title" id="heading">All Posts</h2>', `<h2 class="section-title" id="heading">${heading}</h2>`)
      .replace('<div class="posts-grid" id="postsGrid"></div>', `<div class="posts-grid" id="postsGrid">${gridHtml}</div>`)
      .replace('<ul class="trending-list" id="catList"></ul>', `<ul class="trending-list" id="catList">${catListHtml}</ul>`);

    res.send(html);
  } catch (err) {
    next();
  }
});

// Author profile — same technique, parameterised by ?u=. Returns a real 404 for an
// unknown username, same "genuine 404 over soft 404" reasoning as renderPostPage.
app.get('/author.html', async (req, res, next) => {
  try {
    const fs = require('fs');
    const filePath = path.join(__dirname, '../public/author.html');
    let html = fs.readFileSync(filePath, 'utf8');

    const username = (req.query.u || '').toString().toLowerCase().trim();
    const author = username
      ? await StaffUser.findOne({ username }).select('username name bio avatarUrl followerCount createdAt').catch(() => null)
      : null;

    let title = 'Writer Profile — World Mic';
    let description = 'Read articles from World Mic contributors.';
    let bodyHtml = `<div class="empty-state"><h3>Writer not found</h3></div>`;
    let statusCode = author ? 200 : 404;

    if (author) {
      const posts = await Post.find({ authorUsername: author.username, status: 'published' })
        .sort({ createdAt: -1 })
        .select(LISTING_SELECT);
      title = `${author.name || author.username} — World Mic`;
      description = author.bio || `Articles by ${author.name || author.username} on World Mic.`;
      const postsHtml = posts.length
        ? posts.map(postCardHtmlServer).join('')
        : `<p style="opacity:.6">No published posts yet.</p>`;
      bodyHtml = `
        <div class="author-header" style="text-align:center;margin-bottom:24px">
          ${author.avatarUrl ? `<img src="${author.avatarUrl}" alt="${author.name || author.username}" style="width:96px;height:96px;border-radius:50%;object-fit:cover" />` : ''}
          <h1>${author.name || author.username}</h1>
          ${author.bio ? `<p>${author.bio}</p>` : ''}
          <p style="opacity:.6">${posts.length} posts · ${author.followerCount || 0} followers</p>
        </div>
        <div class="posts-grid" id="profilePostsGrid">${postsHtml}</div>`;
    }

    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(
        '</head>',
        `<meta name="description" content="${description.replace(/"/g, '&quot;')}" />\n` +
        `<link rel="canonical" href="${url}" />\n</head>`
      )
      .replace(
        /<main style="width:100%" id="profileRoot">[\s\S]*?<\/main>/,
        `<main style="width:100%" id="profileRoot">${bodyHtml}</main>`
      );

    res.status(statusCode).send(html);
  } catch (err) {
    next();
  }
});

const POST_SELECT = 'title excerpt seoTitle seoDescription featuredImage status content category author authorUsername tags createdAt views likes slug';

// Canonical post URL — clean, readable, and what every internal link now points to.
app.get('/post/:slug', async (req, res, next) => {
  try {
    const post = await Post.findOne({ slug: req.params.slug }).select(POST_SELECT).catch(() => null);
    await renderPostPage(req, res, post);
  } catch (err) {
    next();
  }
});

// Legacy URL (?id=...) — some of these are already indexed by Google and shared around,
// so instead of breaking them, redirect permanently to the new slug URL. This tells
// Google the content moved and consolidates ranking onto the new canonical address.
app.get('/post.html', async (req, res, next) => {
  try {
    const postId = req.query.id;
    if (postId) {
      const post = await Post.findById(postId).select('slug').catch(() => null);
      if (post?.slug) return res.redirect(301, `/post/${post.slug}`);
    }
    await renderPostPage(req, res, null); // no id given / not found — render the generic 404 shell
  } catch (err) {
    next(); // fall back to the normal static file on any unexpected error
  }
});

app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/posts',   require('./routes/posts'));
app.use('/api/authors', require('./routes/authors'));
app.use('/api',         require('./routes/data'));
app.use('/api/ai',      require('./routes/ai'));
app.use('/api/upload',  require('./routes/upload'));
app.use('/api/auto-publisher', require('./routes/autoPublisher'));

// Auto Publisher scheduler — isolated background system, off by default (AutoPublisherConfig
// defaults to enabled:false). Starting it here just begins polling every 60s for a due,
// admin-enabled run; it never touches existing routes, models, or behavior.
require('./services/schedulerService').start().catch(err => console.error('[autoPublisher] failed to start scheduler:', err.message));

// Keep-alive self-ping — see keepAliveService.js for why. Independent of the Auto
// Publisher scheduler above; runs regardless of whether Auto Publisher is enabled.
require('./services/keepAliveService').start();

// Seed default settings
async function seedSettings() {
  const defaults = [
    { key: 'siteName', value: 'World Mic' },
    { key: 'tagline', value: 'Voices from Every Corner of the World' },
    { key: 'footerContact', value: '+1 (555) 000-0000' },
    { key: 'footerAddress', value: '123 Media Street, Lagos, Nigeria' },
    { key: 'footerAbout', value: 'World Mic is a multi-category blog platform covering news, culture, tech, and more.' },
    { key: 'adminTone', value: 'Professional, engaging, and informative. Write with clarity and authority.' },
    { key: 'primaryColor', value: '#1a73e8' },
    { key: 'socialTwitter', value: 'https://twitter.com/worldmic' },
    { key: 'socialInstagram', value: 'https://instagram.com/worldmic' },
  ];
  for (const s of defaults) {
    // $setOnInsert only applies the default the very first time a key doesn't exist yet —
    // it will never overwrite a value the admin has already saved.
    await Settings.findOneAndUpdate({ key: s.key }, { $setOnInsert: s }, { upsert: true });
  }
}
seedSettings().catch(console.error);

// ads.txt — required by Google AdSense for site verification, generated from the configured publisher ID
app.get('/ads.txt', async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'adsenseClientId' });
    const clientId = setting?.value?.replace('ca-pub-', '').trim();
    res.type('text/plain');
    if (!clientId) return res.send('# AdSense not configured yet');
    res.send(`google.com, pub-${clientId}, DIRECT, f08c47fec0942fa0`);
  } catch (err) {
    res.status(500).send('# error');
  }
});

// Lightweight health check — deliberately does no DB query, just confirms the process
// is alive and responding. Used by the self-ping keep-alive below, and safe for any
// external uptime monitor (UptimeRobot, etc.) to hit as well.
app.get('/api/health', (req, res) => res.status(200).send('ok'));

// EU/EEA/UK country codes — where cookie consent must be asked BEFORE loading
// analytics/ads, not just offered as an option. Elsewhere, ads/analytics load by
// default and a visitor can still opt out via the "Cookie Settings" footer link,
// which most jurisdictions don't legally require but is good practice regardless.
const CONSENT_REQUIRED_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', // EU
  'IS', 'LI', 'NO', // EEA
  'GB', // UK
]);

// Public, unauthenticated — called by every visitor's browser before deciding
// whether to show the cookie banner or just load ads/analytics by default. Uses
// geoip-lite (a local, offline database) so visitor IPs are never sent to any
// third-party geolocation service. When the IP can't be resolved to a country at
// all (some ranges genuinely aren't in the database), this defaults to REQUIRING
// consent — a false positive just costs a click, but a false negative for an actual
// EU/UK visitor risks real AdSense compliance consequences, so uncertainty should
// always fail toward asking, not toward skipping the ask.
app.get('/api/consent-required', (req, res) => {
  try {
    const geoip = require('geoip-lite');
    const geo = geoip.lookup(req.ip);
    const required = !geo?.country || CONSENT_REQUIRED_COUNTRIES.has(geo.country);
    res.json({ required });
  } catch (err) {
    res.json({ required: true }); // same fail-safe reasoning as the unresolved-IP case above
  }
});

// robots.txt — tells crawlers what to index and where the sitemap is
app.get('/robots.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /admin-

Sitemap: ${base}/sitemap.xml`);
});

// llms.txt — a plain-language summary of the site for AI agents/crawlers to read,
// analogous to robots.txt but descriptive rather than a set of rules.
app.get('/llms.txt', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const setting = await Settings.findOne({ key: 'siteName' });
    const siteName = setting?.value || 'World Mic';
    const posts = await Post.find({ status: 'published' })
      .select('title slug excerpt category')
      .sort({ createdAt: -1 })
      .limit(30);

    res.type('text/plain');
    res.send(`# ${siteName}

> A multi-category blog covering news, culture, tech, and more.

This site publishes articles across categories including News, Technology, Culture, Opinion, and Reviews. Content is written for a general audience and updated regularly.

## Key Pages
- [Homepage](${base}/): latest posts across all categories
- [Sitemap](${base}/sitemap.xml): full list of published URLs
- [About](${base}/about.html): about this site

## Recent Posts
${posts.map(p => `- [${p.title}](${base}/post/${p.slug})${p.category ? ` — ${p.category}` : ''}${p.excerpt ? `: ${p.excerpt}` : ''}`).join('\n')}
`);
  } catch (err) {
    res.status(500).type('text/plain').send('# error generating llms.txt');
  }
});

// sitemap.xml — auto-generated from every published post + static pages, so Google discovers new content automatically
app.get('/sitemap.xml', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const posts = await Post.find({ status: 'published' }).select('slug _id updatedAt').sort({ updatedAt: -1 });
    const categories = await Post.distinct('category', { status: 'published' });
    const authorUsernames = await Post.distinct('authorUsername', { status: 'published', authorUsername: { $ne: '' } });
    const staticPages = ['', '/category.html', '/search.html', '/about.html', '/join-team.html', '/partner.html'];

    const urls = [
      ...staticPages.map(p => `  <url><loc>${base}${p}</loc><changefreq>daily</changefreq><priority>${p === '' ? '1.0' : '0.6'}</priority></url>`),
      ...posts.map(p => `  <url><loc>${base}/post/${p.slug}</loc><lastmod>${new Date(p.updatedAt).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
      ...categories.map(c => `  <url><loc>${base}/category.html?name=${encodeURIComponent(c)}</loc><changefreq>daily</changefreq><priority>0.6</priority></url>`),
      ...authorUsernames.map(u => `  <url><loc>${base}/author.html?u=${encodeURIComponent(u)}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`),
    ];

    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`);
  } catch (err) {
    res.status(500).type('text/plain').send('Error generating sitemap');
  }
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌍 World Mic is running at http://localhost:${PORT}`);
  console.log(`📝 Admin panel: http://localhost:${PORT}/admin-login.html`);
  console.log(`🔑 Username: ${process.env.ADMIN_USERNAME || 'admin'}`);
  console.log(`🔑 Password: ${process.env.ADMIN_PASSWORD || 'WorldMic2025!'}\n`);
});
