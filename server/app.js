require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('../config/db');
const { Settings } = require('./models/Models');
const Post = require('./models/Post');

const app = express();
connectDB();

app.use(cors());
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
    const staticPages = ['', '/category.html', '/search.html', '/about.html', '/join-team.html', '/partner.html'];

    const urls = [
      ...staticPages.map(p => `  <url><loc>${base}${p}</loc><changefreq>daily</changefreq><priority>${p === '' ? '1.0' : '0.6'}</priority></url>`),
      ...posts.map(p => `  <url><loc>${base}/post/${p.slug}</loc><lastmod>${new Date(p.updatedAt).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
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
