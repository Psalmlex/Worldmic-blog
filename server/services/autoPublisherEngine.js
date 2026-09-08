const AutoPublisherJob = require('../models/AutoPublisherJob');
const AutoPublisherConfig = require('../models/AutoPublisherConfig');
const Post = require('../models/Post');
const AffiliateProduct = require('../models/AffiliateProduct');
const AffiliateLink = require('../models/AffiliateLink');
const ai = require('./aiService'); // existing article/image generation — reused, not duplicated
const { discoverTopic } = require('./topicDiscoveryService');
const { checkDuplicate } = require('./duplicateCheckService');
const { researchTopic } = require('./searchService');
const strategy = require('./contentStrategyEngine');
const { buildRelatedReadingBlock } = require('./internalLinkingService');

const SENSITIVE_MIN_EXTRA_SOURCES = 2; // stricter research bar for health/finance/politics/breaking news

function formatResearchForPrompt(sources) {
  return sources.map((s, i) =>
    `[${i + 1}] ${s.title}\n${s.extractedText ? s.extractedText.slice(0, 1200) : s.snippet}\nSource: ${s.link}`
  ).join('\n\n');
}

// Basic content-integrity validation — never publish incomplete/empty content.
// For sensitive subjects, require more research depth before allowing publish.
// (Fact-checking now happens BEFORE writing, as part of research verification —
// see aiService.verifyResearch — so there's no post-write claim-checking gate here
// anymore; a fact-check "error" surfacing after publish is exactly what that change
// was meant to eliminate.)
function validateArticle(postData, { sensitive, sourcesUsed, minResearchSources }) {
  const problems = [];
  if (!postData?.title || postData.title.trim().length < 5) problems.push('Missing or too-short title');
  const plainText = (postData?.content || '').replace(/<[^>]+>/g, '').trim();
  if (plainText.length < 300) problems.push('Article body is too short to be a real post');
  if (!postData?.excerpt) problems.push('Missing excerpt');

  let requiresManualReview = false;
  let reviewReasons = [];
  if (sensitive && sourcesUsed < minResearchSources + SENSITIVE_MIN_EXTRA_SOURCES) {
    // Not a hard failure — sensitive topics still get published-as-draft for human
    // review rather than being discarded, per "apply stricter validation."
    requiresManualReview = true;
    reviewReasons.push('sensitive topic did not meet the stricter research bar for auto-publish');
  }

  return { ok: problems.length === 0, problems, requiresManualReview, reviewReasons };
}

async function isAnotherJobRunning() {
  const running = await AutoPublisherJob.findOne({ status: 'running' });
  return !!running;
}

// Recovers job records left in "running" after a crash/restart so they don't sit
// stuck forever and block the "no concurrent jobs" guard above.
async function recoverInterruptedJobs() {
  const staleCutoff = new Date(Date.now() - 20 * 60 * 1000); // 20 min = generous ceiling for one job
  const stale = await AutoPublisherJob.find({ status: 'running', startedAt: { $lte: staleCutoff } });
  for (const job of stale) {
    job.status = job.retryCount < job.maxRetries ? 'pending' : 'failed';
    job.error = 'Interrupted by a server restart mid-run.';
    if (job.status === 'pending') job.retryCount += 1;
    await job.save();
  }
  return stale.length;
}

async function runJob(trigger = 'scheduled') {
  if (await isAnotherJobRunning()) {
    console.log('[autoPublisher] Skipping run — a job is already in progress.');
    return null;
  }

  const config = await AutoPublisherConfig.findOne({ singleton: true });
  if (!config || !config.enabled || config.paused) return null;

  const job = await AutoPublisherJob.create({ trigger, status: 'running', startedAt: new Date() });

  try {
    // ── 1. Topic discovery — now includes format-archetype selection via the
    // Content Strategy Engine (see topicDiscoveryService + contentStrategyEngine). ──
    const recentJobs = await AutoPublisherJob.find({}).sort({ createdAt: -1 }).limit(10).select('topic format');
    const recentTopics = recentJobs.map(j => j.topic).filter(Boolean);
    const recentFormats = recentJobs.map(j => j.format).filter(Boolean).slice(0, 5);
    const discovered = await discoverTopic({
      categories: config.categories,
      recentTopics,
      recentFormats,
      useRealSearchQuestions: config.useRealSearchQuestions,
      affiliateModeEnabled: config.affiliateModeEnabled,
    });
    job.topic = discovered.topic;
    job.category = discovered.category;
    job.contentType = discovered.contentType;
    job.format = discovered.format;
    job.formatLabel = discovered.formatLabel;
    await job.save();

    // ── 2. Duplicate check (before spending any research/writing effort) ──
    const dup = await checkDuplicate(discovered.topic, { periodDays: config.duplicateCheckPeriodDays, excludeJobId: job._id });
    if (dup.isDuplicate) {
      job.status = 'skipped_duplicate';
      job.error = dup.reason;
      job.completedAt = new Date();
      await job.save();
      return job;
    }

    // ── 3. Research + verification — sources are cross-checked against EACH OTHER
    // here, before any writing happens, so the writer works from an already-vetted
    // briefing instead of raw, uncorroborated search snippets. This is what makes the
    // article fact-complete from the start rather than needing to be checked after
    // it's written — there's no post-write fact-check stage anymore. ──
    job.researchStatus = 'running';
    await job.save();
    let researchContext = '';
    let sourcesUsed = 0;
    try {
      const research = await researchTopic(discovered.topic, {
        minSources: config.minResearchSources,
        providerPreference: config.searchProvider,
      });
      job.researchSources = research.sources.map(s => ({ title: s.title, link: s.link, snippet: s.snippet }));
      job.searchProviderUsed = research.providerUsed;
      sourcesUsed = research.sources.length;

      // Cross-check the gathered sources against each other and build a verified
      // briefing (corroborated facts stated plainly, single-source claims attributed
      // cautiously, conflicts called out) — this is the fact-checking step, moved
      // here so it improves what the writer works from instead of gatekeeping what
      // it already wrote. Runs silently; a failure here falls back to raw research
      // rather than blocking the job, same fail-safe posture as before.
      const verified = await ai.verifyResearch(research.sources, discovered.topic);
      researchContext = verified.briefing || formatResearchForPrompt(research.sources);
      job.researchStatus = 'done';
    } catch (err) {
      job.researchStatus = 'failed';
      job.error = err.message;
      // Research is CRITICAL for anything time-sensitive or sensitive-subject —
      // never publish those without it. Evergreen, non-sensitive topics may still
      // proceed on general knowledge, matching "fail safely" rather than "fail always."
      if (discovered.needsCurrentInfo || discovered.sensitive) {
        job.status = 'failed';
        job.completedAt = new Date();
        await job.save();
        return job;
      }
      console.warn(`[autoPublisher] Research failed for evergreen topic "${discovered.topic}", proceeding without it:`, err.message);
    }
    await job.save();

    // ── 3b. Affiliate Mode — ONLY runs when explicitly enabled AND the chosen
    // format is affiliate-suitable AND the admin's own Product Pool actually has a
    // matching-category product. Deliberately separate from the normal blog path:
    // when any of those conditions isn't met, this does nothing and the post is
    // written exactly as any normal post would be. Never searches for or invents
    // product URLs — only draws from links the admin themselves added to the pool
    // (see AffiliateProduct + routes/affiliate.js), since those are the only URLs
    // that actually carry the admin's real affiliate tracking. ──
    let affiliateGenProducts = [];
    let affiliateProductDocs = [];
    let affiliateLinkDocs = [];
    if (config.affiliateModeEnabled && strategy.isAffiliateSuitable(discovered.format)) {
      affiliateProductDocs = await AffiliateProduct.find({ category: discovered.category, active: true })
        .sort({ lastUsedAt: 1 }) // least-recently-used first — spreads usage across the pool instead of always picking the same product
        .limit(config.maxAffiliateProductsPerPost);
      if (affiliateProductDocs.length) {
        for (const product of affiliateProductDocs) {
          const link = await AffiliateLink.create({ url: product.url, label: product.name, network: product.network, jobId: job._id });
          affiliateLinkDocs.push(link);
        }
        affiliateGenProducts = affiliateProductDocs.map((p, i) => ({
          name: p.name,
          url: `/go/${affiliateLinkDocs[i]._id}`, // tracked redirect — see the public /go/:id route in app.js
          notes: p.price ? `${p.currency || ''} ${p.price}`.trim() : '',
        }));
      }
      // No matching pool products for this category is NOT an error — the post is
      // simply written as a normal, non-affiliate post of the same chosen format.
    }

    // ── 4. Write (reuses the existing multi-stage AI writing pipeline). contentType
    // comes from topic discovery, chosen per-topic (not a fixed per-category label),
    // so different categories — and different topics within the same category —
    // genuinely read in distinct voices instead of every post sounding the same.
    // styleInstruction (from the Content Strategy Engine) rides in through the
    // EXISTING `tone` parameter generatePost already supports — no changes were
    // needed to aiService.js's writing pipeline itself for the format engine. ──
    job.articleStatus = 'running';
    await job.save();
    let postData;
    try {
      postData = await ai.generatePost(discovered.topic, discovered.styleInstruction, discovered.category, {
        length: config.wordCount,
        contentType: discovered.contentType,
        researchContext,
        products: affiliateGenProducts,
      });
      job.articleStatus = 'done';
    } catch (err) {
      job.articleStatus = 'failed';
      job.status = 'failed';
      job.error = `Article generation failed: ${err.message}`;
      job.completedAt = new Date();
      await job.save();
      return job;
    }
    await job.save();

    // ── 5. Validate (SEO fields already produced by generatePost) ──
    const validation = validateArticle(postData, {
      sensitive: discovered.sensitive,
      sourcesUsed,
      minResearchSources: config.minResearchSources,
    });
    if (!validation.ok) {
      job.status = 'failed';
      job.error = `Validation failed: ${validation.problems.join('; ')}`;
      job.completedAt = new Date();
      await job.save();
      return job;
    }

    // ── 6. Image (optional; reuses existing image-gen + Cloudinary pipeline) ──
    let featuredImage = '';
    let imageAlt = postData.title;
    if (config.imageGenerationEnabled) {
      job.imageStatus = 'running';
      await job.save();
      try {
        const plainText = postData.content.replace(/<[^>]+>/g, '').slice(0, 600);
        const imgResult = await ai.generateFeaturedImage(discovered.topic, plainText);
        if (imgResult.url) {
          featuredImage = imgResult.url;
          job.imageStatus = 'done';
        } else {
          job.imageStatus = 'failed';
          job.error = job.error || `Image generation: ${imgResult.error || 'unknown error'}`;
        }
      } catch (err) {
        job.imageStatus = 'failed';
        job.error = job.error || `Image generation error: ${err.message}`;
      }
      // Image failure is NOT critical — the post still publishes without one.
    } else {
      job.imageStatus = 'skipped';
    }
    await job.save();

    // ── 6b. Inline (in-body) images — separate toggle, separate stage. Only adds
    // images where a section is genuinely visual; most articles get none. Failure
    // here is never critical — the article publishes with its text unchanged. ──
    if (config.inlineImagesEnabled) {
      job.inlineImageStatus = 'running';
      await job.save();
      try {
        const inlineResult = await ai.generateInlineImages(postData.content, discovered.topic);
        postData.content = inlineResult.content;
        job.inlineImagesInserted = inlineResult.insertedImages;
        job.inlineImageStatus = 'done'; // 'done' even when 0 were inserted — that's a valid "not necessary" outcome
      } catch (err) {
        job.inlineImageStatus = 'failed';
        job.error = job.error ? `${job.error} | Inline images: ${err.message}` : `Inline images: ${err.message}`;
      }
    } else {
      job.inlineImageStatus = 'skipped';
    }
    await job.save();

    // ── 7. Internal linking — every auto-published post now gets a related-reading
    // block (previously only the Affiliate Publisher had this; regular auto-published
    // posts had none, which was a real gap). Reuses the SAME helper as the Affiliate
    // Publisher rather than a second implementation. ──
    const relatedBlock = await buildRelatedReadingBlock(discovered.category);
    postData.content += relatedBlock;

    // ── 8. Create post (existing Post model — slug/excerpt fallback logic untouched) ──
    const wantsPublish = config.mode === 'autopublish' && !validation.requiresManualReview;
    const post = new Post({
      title: postData.title,
      content: postData.content,
      excerpt: postData.excerpt,
      seoTitle: postData.seoTitle,
      seoDescription: postData.seoDescription,
      tags: postData.tags,
      category: discovered.category,
      featuredImage,
      author: 'World Mic',
      authorUsername: '',
      status: wantsPublish ? 'published' : 'draft',
      aiGenerated: true,
    });
    await post.save();

    // Backfill postId on any affiliate links created in step 3b, and mark the pool
    // products as just-used so rotation spreads across the pool over time.
    if (affiliateLinkDocs.length) {
      await AffiliateLink.updateMany({ _id: { $in: affiliateLinkDocs.map(l => l._id) } }, { postId: post._id });
      await AffiliateProduct.updateMany({ _id: { $in: affiliateProductDocs.map(p => p._id) } }, { lastUsedAt: new Date() });
      job.affiliateProductsUsed = affiliateProductDocs.map(p => ({ name: p.name, url: p.url }));
    }

    job.postId = post._id;
    job.publishStatus = post.status === 'published' ? 'published' : 'draft';
    job.status = 'completed';
    if (validation.requiresManualReview) {
      job.error = (job.error ? job.error + ' | ' : '') + `Saved as draft for manual review: ${validation.reviewReasons.join('; ')}.`;
    }
    job.completedAt = new Date();
    await job.save();
    return job;
  } catch (err) {
    // Catch-all: any unexpected failure never leaves a half-published post — the Post
    // is only created in step 8, after every prior stage succeeded.
    job.status = 'failed';
    job.error = err.message;
    job.completedAt = new Date();
    await job.save().catch(() => {});
    return job;
  }
}

// Retries a specific failed job (bounded by maxRetries) by running a fresh job — the
// failed record stays in history for audit; a new job row is created for the retry,
// which is simpler and safer than mutating a completed/failed record in place.
async function retryJob(jobId) {
  const original = await AutoPublisherJob.findById(jobId);
  if (!original) throw new Error('Job not found');
  if (original.retryCount >= original.maxRetries) throw new Error('Max retries reached for this job');
  original.retryCount += 1;
  await original.save();
  return runJob('manual');
}

module.exports = { runJob, retryJob, recoverInterruptedJobs, isAnotherJobRunning };
