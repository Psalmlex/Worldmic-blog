const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const AutoPublisherConfig = require('../models/AutoPublisherConfig');
const AutoPublisherJob = require('../models/AutoPublisherJob');
const { runJob, retryJob, isAnotherJobRunning } = require('../services/autoPublisherEngine');

// Only authenticated admins can view/configure/run this — editors are blocked
// (auth.requireAdmin), matching the "only authenticated administrators" requirement.
router.use(auth, auth.requireAdmin);

async function getOrCreateConfig() {
  let config = await AutoPublisherConfig.findOne({ singleton: true });
  if (!config) config = await AutoPublisherConfig.create({ singleton: true });
  return config;
}

// ── Config ──────────────────────────────────────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    res.json(config);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const EDITABLE_FIELDS = [
  'enabled', 'mode', 'timezone', 'publishTimes', 'postsPerDay', 'categories',
  'wordCount', 'minResearchSources', 'imageGenerationEnabled',
  'duplicateCheckPeriodDays', 'searchProvider',
];

router.put('/config', async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    for (const key of EDITABLE_FIELDS) {
      if (req.body[key] !== undefined) config[key] = req.body[key];
    }
    // Auto-Publish must be OFF by default and only switches on via an explicit,
    // deliberate choice — this endpoint just persists whatever the admin picked.
    await config.save();
    res.json(config);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Controls ────────────────────────────────────────────────────────────────
router.post('/run-now', async (req, res) => {
  try {
    if (await isAnotherJobRunning()) return res.status(409).json({ error: 'A job is already running. Try again shortly.' });
    const config = await getOrCreateConfig();
    if (!config.enabled) return res.status(400).json({ error: 'Auto Publisher is disabled. Enable it first.' });
    // Run in the background so the request returns immediately; the admin polls
    // /jobs or /status for progress rather than holding the connection open for
    // the full multi-minute pipeline.
    runJob('manual').catch(err => console.error('[autoPublisher] manual run failed:', err.message));
    res.json({ message: 'Run started. Check job history for progress.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pause', async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    config.paused = true;
    await config.save();
    res.json({ message: 'Auto Publisher paused.', config });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/resume', async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    config.paused = false;
    await config.save();
    res.json({ message: 'Auto Publisher resumed.', config });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/:id/retry', async (req, res) => {
  try {
    retryJob(req.params.id).catch(err => console.error('[autoPublisher] retry failed:', err.message));
    res.json({ message: 'Retry started.' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Status / history ────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    const [running, lastJob, successCount, failedCount] = await Promise.all([
      AutoPublisherJob.findOne({ status: 'running' }),
      AutoPublisherJob.findOne({ status: { $ne: 'running' } }).sort({ createdAt: -1 }),
      AutoPublisherJob.countDocuments({ status: 'completed' }),
      AutoPublisherJob.countDocuments({ status: 'failed' }),
    ]);
    res.json({
      enabled: config.enabled,
      paused: config.paused,
      mode: config.mode,
      timezone: config.timezone,
      currentlyRunning: !!running,
      runningJob: running,
      lastRunAt: config.lastRunAt,
      lastJob,
      successfulJobs: successCount,
      failedJobs: failedCount,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs', async (req, res) => {
  try {
    const { limit = 50, status } = req.query;
    const query = status ? { status } : {};
    const jobs = await AutoPublisherJob.find(query).sort({ createdAt: -1 }).limit(Number(limit)).populate('postId', 'title slug status');
    res.json(jobs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs/:id', async (req, res) => {
  try {
    const job = await AutoPublisherJob.findById(req.params.id).populate('postId', 'title slug status');
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
