// ─── Self-ping keep-alive ────────────────────────────────────────────────────
// Render's free tier sleeps a web service after ~15 minutes with no inbound HTTP
// traffic; the next request then has to cold-start it, which can take 10-60+
// seconds or time out entirely. Googlebot hitting the site while asleep is a
// well-known cause of Search Console's "host had problems in the past" flag and
// reduced crawl frequency — which is exactly what showed up in this site's Crawl
// Stats. An external uptime monitor (e.g. UptimeRobot) is the more reliable fix
// since it works even if this process itself is what's asleep, but this self-ping
// is a zero-setup stopgap: an outbound request to the app's OWN public URL counts
// as inbound traffic from Render's perspective, resetting the idle timer.
//
// Uses RENDER_EXTERNAL_URL, which Render sets automatically for web services — no
// manual configuration needed on Render. Falls back to a manually-set SELF_PING_URL
// for any other host. If neither is set (e.g. local development), this silently
// does nothing rather than erroring.
const axios = require('axios');

const PING_INTERVAL_MS = 10 * 60 * 1000; // under Render's ~15 min idle threshold
let timer = null;

function getSelfUrl() {
  return process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL || '';
}

async function ping() {
  const base = getSelfUrl();
  if (!base) return;
  try {
    await axios.get(`${base.replace(/\/$/, '')}/api/health`, { timeout: 20000 });
  } catch (err) {
    // A single missed ping isn't worth alarming logs over — Render's own health
    // checks and the next scheduled ping will recover it either way.
    console.warn('[keepAlive] self-ping failed:', err.message);
  }
}

function start() {
  const base = getSelfUrl();
  if (!base) {
    console.log('[keepAlive] No RENDER_EXTERNAL_URL or SELF_PING_URL set — self-ping disabled.');
    return;
  }
  if (timer) clearInterval(timer);
  timer = setInterval(ping, PING_INTERVAL_MS);
  console.log(`[keepAlive] Self-ping started against ${base} every ${PING_INTERVAL_MS / 60000} minutes.`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
