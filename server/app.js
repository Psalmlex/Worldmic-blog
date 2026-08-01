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

// Must come BEFORE express.static so it can intercept /post.html and inject real
// per-post meta tags — social media crawlers (Facebook, Twitter, WhatsApp, LinkedIn)
// don't execute JavaScript, so without this every shared post link shows generic
// "World Mic" info instead of that post's actual title/image/description.
app.get('/post.html', async (req, res, next) => {
  try {
    const fs = require('fs');
    const postId = req.query.id;
    const filePath = path.join(__dirname, '../public/post.html');
    let html = fs.readFileSync(filePath, 'utf8');

    let title = 'World Mic';
    let description = 'A multi-category blog covering news, culture, tech, and more.';
    let image = `${req.protocol}://${req.get('host')}/images/app-icon.svg`;
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    let statusCode = 200;

    if (postId) {
      const post = await Post.findById(postId).select('title excerpt seoTitle seoDescription featuredImage status').catch(() => null);
      if (post && post.status === 'published') {
        title = `${post.seoTitle || post.title || 'World Mic'} — World Mic`;
        description = post.seoDescription || post.excerpt || description;
        image = post.featuredImage || image;
      } else {
        // Post doesn't exist, was deleted, or isn't published yet — this URL is genuinely
        // not a real page, so tell crawlers that with a real 404 instead of a "soft 404"
        // (200 OK + "not found" text), which Google flags and refuses to index either way.
        statusCode = 404;
        title = 'Post Not Found — World Mic';
        description = 'The post you\u2019re looking for doesn\u2019t exist or has been removed.';
      }
    }

    html = html
      .replace(/__META_TITLE__/g, title.replace(/"/g, '&quot;'))
      .replace(/__META_DESCRIPTION__/g, description.replace(/"/g, '&quot;'))
      .replace(/__META_IMAGE__/g, image)
      .replace(/__META_URL__/g, url);

    res.status(statusCode).send(html);
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
Disallow: /api/

Sitemap: ${base}/sitemap.xml`);
});

// sitemap.xml — auto-generated from every published post + static pages, so Google discovers new content automatically
app.get('/sitemap.xml', async (req, res) => {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const posts = await Post.find({ status: 'published' }).select('slug _id updatedAt').sort({ updatedAt: -1 });
    const staticPages = ['', '/category.html', '/search.html', '/about.html', '/join-team.html', '/partner.html'];

    const urls = [
      ...staticPages.map(p => `  <url><loc>${base}${p}</loc><changefreq>daily</changefreq><priority>${p === '' ? '1.0' : '0.6'}</priority></url>`),
      ...posts.map(p => `  <url><loc>${base}/post.html?id=${p._id}</loc><lastmod>${new Date(p.updatedAt).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
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
