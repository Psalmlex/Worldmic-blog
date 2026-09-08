const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const AffiliateJob = require('../models/AffiliateJob');
const AffiliateLink = require('../models/AffiliateLink');
const Post = require('../models/Post');
const ai = require('../services/aiService'); // reuses the EXISTING writing pipeline — no duplicate AI logic
const affiliate = require('../services/affiliateService');

// Only authenticated admins — matches the Auto Publisher's own routes.
router.use(auth, auth.requireAdmin);

const MODE_RULES = {
  single: { min: 1, max: 1, contentType: 'review' },
  comparison: { min: 2, max: 2, contentType: 'affiliate' }, // affiliate voice = comparison-driven, pros/cons, "best for"
  list: { min: 2, max: 20, contentType: 'buyingGuide' }, // buyingGuide voice = recommend options for different needs
};

function buildTopic(mode, products, customTitle) {
  if (customTitle) return customTitle;
  if (mode === 'single') return products[0].name;
  if (mode === 'comparison') return `${products[0].name} vs ${products[1].name}`;
  return `Top ${products.length} Picks: ${products.map(p => p.name).slice(0, 3).join(', ')}${products.length > 3 ? '...' : ''}`;
}

// Simple internal-linking block — existing published posts sharing the same
// category, no schema changes needed (queries the existing Post collection as-is).
async function buildRelatedReadingBlock(category, excludePostId) {
  const query = { status: 'published', category };
  if (excludePostId) query._id = { $ne: excludePostId };
  const related = await Post.find(query).sort({ createdAt: -1 }).limit(3).select('title slug');
  if (related.length < 2) return ''; // not worth a section for 0-1 matches
  const items = related.map(p => `<li><a href="/post/${p.slug}">${p.title}</a></li>`).join('');
  return `\n<h3>Related Reading</h3>\n<ul>${items}</ul>`;
}

// Shared by both /generate (new job) and /jobs/:id/regenerate (existing job) —
// fetches product info fresh, handles images, writes the article via the EXISTING
// generatePost pipeline, and creates/updates the Post + click-tracked links.
async function runGeneration(job, { category, wordCount, customTitle, adminConfirmedImageRights }) {
  const rule = MODE_RULES[job.mode];

  // ── 1. Fetch info for each product URL — ALL must succeed for the job to proceed. ──
  const fetched = [];
  for (const url of job.inputUrls) {
    fetched.push(await affiliate.fetchProductInfo(url)); // lets a real failure bubble up with its own clear message
  }

  // ── 2. Image handling — per-product, respecting each network's policy. ──
  const products = [];
  for (const p of fetched) {
    const imageResult = await affiliate.handleProductImage(p, { adminConfirmedRights: adminConfirmedImageRights });
    products.push({ ...p, ...imageResult });
  }

  // ── 3. Click-tracked links — reuse existing AffiliateLink docs on regenerate
  // (preserves click history for the same products) instead of resetting it. ──
  const existingLinks = job._id ? await AffiliateLink.find({ jobId: job._id }) : [];
  const links = [];
  for (const p of products) {
    let link = existingLinks.find(l => l.url === p.url);
    if (!link) link = await AffiliateLink.create({ jobId: job._id, url: p.url, label: p.name, network: p.network });
    else if (link.label !== p.name) { link.label = p.name; await link.save(); } // keep label current if the product name changed
    links.push(link);
  }

  // ── 4. Write the article — full reuse of the existing multi-stage pipeline. ──
  const topic = buildTopic(job.mode, products, customTitle);
  const genProducts = products.map((p, i) => ({
    name: p.name,
    url: `/go/${links[i]._id}`, // tracked redirect, never the raw affiliate URL — see the public route in app.js
    notes: p.price ? `${p.currency || ''} ${p.price}`.trim() : '',
  }));
  const postData = await ai.generatePost(topic, '', category || 'General', {
    length: wordCount || 'medium',
    contentType: rule.contentType,
    products: genProducts,
  });

  // ── 5. Internal linking — append related reading from the same category. ──
  const relatedBlock = await buildRelatedReadingBlock(category || 'General', job.postId);
  const finalContent = postData.content + relatedBlock;

  // ── 6. Featured image — first product with a successfully uploaded image, if any. ──
  const featuredImage = products.find(p => p.imageStatus === 'uploaded')?.imageCloudinaryUrl || '';

  // ── 7. Create or update the Post. ──
  let post;
  if (job.postId) {
    post = await Post.findById(job.postId);
    if (post) {
      post.title = postData.title;
      post.content = finalContent;
      post.excerpt = postData.excerpt;
      post.seoTitle = postData.seoTitle;
      post.seoDescription = postData.seoDescription;
      post.tags = postData.tags;
      if (featuredImage) post.featuredImage = featuredImage;
      await post.save();
    }
  }
  if (!post) {
    post = await Post.create({
      title: postData.title,
      content: finalContent,
      excerpt: postData.excerpt,
      seoTitle: postData.seoTitle,
      seoDescription: postData.seoDescription,
      tags: postData.tags,
      category: category || 'General',
      featuredImage,
      status: 'draft',
      aiGenerated: true,
    });
  }

  // Backfill postId on the links now that the Post exists.
  await AffiliateLink.updateMany({ _id: { $in: links.map(l => l._id) } }, { postId: post._id });

  job.products = products.map(p => ({
    name: p.name, url: p.url, price: p.price, currency: p.currency, network: p.network,
    imageUrl: p.imageUrl, imageStatus: p.imageStatus, imageNotice: p.imageNotice, extractionMethod: p.extractionMethod,
  }));
  job.postId = post._id;
  job.status = 'draft';
  job.error = '';
  await job.save();

  return job;
}

// ── Generate — creates a new job. ──
router.post('/generate', async (req, res) => {
  const { mode, urls, category, wordCount, customTitle, adminConfirmedImageRights } = req.body;
  const rule = MODE_RULES[mode];
  if (!rule) return res.status(400).json({ error: 'mode must be single, comparison, or list' });
  const cleanUrls = (urls || []).map(u => u?.trim()).filter(Boolean);
  if (cleanUrls.length < rule.min || cleanUrls.length > rule.max) {
    return res.status(400).json({ error: `${mode} mode needs ${rule.min === rule.max ? rule.min : `${rule.min}-${rule.max}`} link(s), got ${cleanUrls.length}` });
  }

  const job = await AffiliateJob.create({ mode, inputUrls: cleanUrls, status: 'running' });
  try {
    await runGeneration(job, { category, wordCount, customTitle, adminConfirmedImageRights });
    res.json(job);
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    await job.save();
    res.status(500).json({ error: err.message, job });
  }
});

// ── Regenerate — re-fetches and re-writes for an EXISTING job's same URLs. ──
// Per the spec, a completed job never regenerates on its own; this is the only path
// that produces new content for it, and only when the admin explicitly calls it.
router.post('/jobs/:id/regenerate', async (req, res) => {
  try {
    const job = await AffiliateJob.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const { category, wordCount, customTitle, adminConfirmedImageRights } = req.body;
    await runGeneration(job, { category, wordCount, customTitle, adminConfirmedImageRights });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mark completed — locks the job; per the spec, it should not regenerate again
// unless the admin explicitly clicks Regenerate. This is purely a status flag; the
// underlying Post is untouched (its own status/editing is managed like any post). ──
router.post('/jobs/:id/complete', async (req, res) => {
  try {
    const job = await AffiliateJob.findByIdAndUpdate(req.params.id, { status: 'completed', completedAt: new Date() }, { new: true });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/jobs', async (req, res) => {
  try {
    const jobs = await AffiliateJob.find().sort({ createdAt: -1 }).limit(100).populate('postId', 'title slug status');
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletes the job record and its click-tracking links — does NOT delete the
// underlying Post, since that's a normal post an admin may still want to keep.
router.delete('/jobs/:id', async (req, res) => {
  try {
    await AffiliateLink.deleteMany({ jobId: req.params.id });
    await AffiliateJob.findByIdAndDelete(req.params.id);
    res.json({ message: 'Job deleted (the post itself was not deleted).' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analytics dashboard — derived entirely from AffiliateJob -> Post relationships
// and AffiliateLink click counts. No changes to the Post schema were needed: post
// status (draft/published) is read live from the linked Post, and "impressions" reuse
// the Post's own existing `views` counter rather than adding a duplicate one. ──
router.get('/analytics', async (req, res) => {
  try {
    const jobs = await AffiliateJob.find().populate('postId', 'status views');
    const drafts = jobs.filter(j => j.postId?.status === 'draft').length;
    const published = jobs.filter(j => j.postId?.status === 'published').length;
    const totalImpressions = jobs.reduce((sum, j) => sum + (j.postId?.views || 0), 0);

    const links = await AffiliateLink.find();
    const totalClicks = links.reduce((sum, l) => sum + l.clicks, 0);
    const topProducts = [...links].sort((a, b) => b.clicks - a.clicks).slice(0, 10)
      .map(l => ({ label: l.label, network: l.network, clicks: l.clicks }));

    res.json({
      drafts, published, totalImpressions, totalClicks,
      ctr: totalImpressions ? +(totalClicks / totalImpressions * 100).toFixed(2) : 0,
      topProducts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Product Pool — real affiliate links the Auto Publisher draws from when
// Affiliate Mode is enabled (see autoPublisherEngine.js). Reuses the exact same
// fetch/image logic as the manual generation modes above — no duplicate logic. ──
const AffiliateProduct = require('../models/AffiliateProduct');

router.post('/pool', async (req, res) => {
  try {
    const { url, category, adminConfirmedImageRights } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const info = await affiliate.fetchProductInfo(url);
    const imageResult = await affiliate.handleProductImage(info, { adminConfirmedRights: adminConfirmedImageRights });
    const product = await AffiliateProduct.create({
      url, name: info.name, price: info.price, currency: info.currency, network: info.network,
      imageUrl: info.imageUrl, category: category || 'General', ...imageResult,
    });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pool', async (req, res) => {
  try {
    const products = await AffiliateProduct.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/pool/:id', async (req, res) => {
  try {
    const { active, category } = req.body;
    const update = {};
    if (active !== undefined) update.active = active;
    if (category !== undefined) update.category = category;
    const product = await AffiliateProduct.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!product) return res.status(404).json({ error: 'Not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/pool/:id', async (req, res) => {
  try {
    await AffiliateProduct.findByIdAndDelete(req.params.id);
    res.json({ message: 'Removed from pool.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
