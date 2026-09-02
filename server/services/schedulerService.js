const moment = require('moment-timezone'); // full IANA tz + DST handled correctly, not hand-rolled
const AutoPublisherConfig = require('../models/AutoPublisherConfig');
const AutoPublisherJob = require('../models/AutoPublisherJob');
const { runJob, recoverInterruptedJobs, isAnotherJobRunning } = require('./autoPublisherEngine');

const TICK_MS = 60 * 1000; // check once a minute — publish times are minute-granularity
let timer = null;

// How many *scheduled* jobs (any status) already exist for "today" in the configured
// timezone. Using the DB as the source of truth (rather than an in-memory counter or
// a single "lastFiredSlotKey" scalar) makes this correct across restarts and across
// however many time slots are configured, with no extra bookkeeping fields needed.
async function scheduledJobsToday(timezone) {
  const startOfDay = moment.tz(timezone).startOf('day').toDate();
  return AutoPublisherJob.countDocuments({ trigger: 'scheduled', createdAt: { $gte: startOfDay } });
}

async function tick() {
  try {
    const config = await AutoPublisherConfig.findOne({ singleton: true });
    if (!config || !config.enabled || config.paused) return;
    if (!config.publishTimes?.length) return;
    if (await isAnotherJobRunning()) return; // never run concurrent jobs

    const nowLocal = moment.tz(config.timezone || 'UTC');
    const dueSlots = config.publishTimes.filter(t => {
      const [h, m] = t.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return false;
      const slotTime = nowLocal.clone().set({ hour: h, minute: m, second: 0, millisecond: 0 });
      return nowLocal.isSameOrAfter(slotTime);
    });
    if (!dueSlots.length) return;

    const doneToday = await scheduledJobsToday(config.timezone || 'UTC');
    if (doneToday >= dueSlots.length) return; // already fired for every slot that's due so far today

    config.lastRunAt = new Date();
    await config.save();
    await runJob('scheduled');
  } catch (err) {
    console.error('[autoPublisher] scheduler tick error:', err.message);
  }
}

async function start() {
  const recovered = await recoverInterruptedJobs();
  if (recovered) console.log(`[autoPublisher] Recovered ${recovered} job(s) interrupted by a previous restart.`);
  if (timer) clearInterval(timer);
  timer = setInterval(tick, TICK_MS);
  // Also check once immediately on boot — covers the case where the process was
  // asleep/down through one or more scheduled times (e.g. Render free-tier sleep)
  // and should catch up rather than silently wait for tomorrow.
  tick();
  console.log('[autoPublisher] Scheduler started.');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
