const AutoPublisherJob = require('../models/AutoPublisherJob');
const AutoPublisherConfig = require('../models/AutoPublisherConfig');
const Post = require('../models/Post');
const ai = require('./aiService'); // existing article/image generation — reused, not duplicated
const { discoverTopic } = require('./topicDiscoveryService');
const { checkDuplicate } = require('./duplicateCheckService');
const { researchTopic } = require('./searchService');

const SENSITIVE_MIN_EXTRA_SOURCES = 2; // stricter research bar for health/finance/politics/breaking news

function formatResearchForPrompt(sources) {
  return sources.map((s, i) =>
    `[${i + 1}] ${s.title}\n${s.extractedText ? s.extractedText.slice(0, 1200) : s.snippet}\nSource: ${s.link}`
  ).join('\n\n');
}

// Basic content-integrity validation — never publish incomplete/empty content.
// For sensitive subjects, require more research depth before allowing publish.
function validateArticle(postData, { sensitive, sourcesUsed, minResearchSources }) {
  const problems = [];
  if (!postData?.title || postData.title.trim().length < 5) problems.push('Missing or too-short title');
  const plainText = (postData?.content || '').replace(/<[^>]+>/g, '').trim();
  if (plainText.length < 300) problems.push('Article body is too short to be a real post');
  if (!postData?.excerpt) problems.push('Missing excerpt');

  let requiresManualReview = false;
  if (sensitive && sourcesUsed < minResearchSources + SENSITIVE_MIN_EXTRA_SOURCES) {
    // Not a hard failure — sensitive topics still get published-as-draft for human
    // review rather than being discarded, per "apply stricter validation."
    requiresManualReview = true;
  }

  return { ok: problems.length === 0, problems, requiresManualReview };
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
    // ── 1. Topic discovery ──
    const recentTopics = (await AutoPublisherJob.find({}).sort({ createdAt: -1 }).limit(10).select('topic')).map(j => j.topic).filter(Boolean);
    const discovered = await discoverTopic({ categories: config.categories, recentTopics });
    job.topic = discovered.topic;
    job.category = discovered.category;
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

    // ── 3. Research ──
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
      researchContext = formatResearchForPrompt(research.sources);
      sourcesUsed = research.sources.length;
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

    // ── 4. Write (reuses the existing multi-stage AI writing pipeline) ──
    job.articleStatus = 'running';
    await job.save();
    let postData;
    try {
      postData = await ai.generatePost(discovered.topic, '', discovered.category, {
        length: config.wordCount,
        contentType: 'article',
        researchContext,
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
    const validation = validateArticle(postData, { sensitive: discovered.sensitive, sourcesUsed, minResearchSources: config.minResearchSources });
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

    // ── 7. Create post (existing Post model — slug/excerpt fallback logic untouched) ──
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

    job.postId = post._id;
    job.publishStatus = post.status === 'published' ? 'published' : 'draft';
    job.status = 'completed';
    if (validation.requiresManualReview) {
      job.error = (job.error ? job.error + ' | ' : '') + 'Saved as draft for manual review: sensitive topic did not meet the stricter research bar for auto-publish.';
    }
    job.completedAt = new Date();
    await job.save();
    return job;
  } catch (err) {
    // Catch-all: any unexpected failure never leaves a half-published post — the Post
    // is only created in step 7, after every prior stage succeeded.
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
