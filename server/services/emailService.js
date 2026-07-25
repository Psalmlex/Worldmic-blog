const nodemailer = require('nodemailer');
const axios = require('axios');
const { Settings } = require('../models/Models');

async function getSetting(key) {
  const doc = await Settings.findOne({ key });
  return doc?.value;
}

async function getFromAddress() {
  const fromName = (await getSetting('smtpFromName')) || 'World Mic';
  const fromEmail = (await getSetting('smtpFromEmail')) || (await getSetting('smtpUser')) || process.env.SMTP_USER;
  return { fromName, fromEmail };
}

// ─── Brevo HTTP API (recommended) — sends over HTTPS, works on Render's free tier ──
// Render's free web services block outbound SMTP ports (25/465/587) entirely as of Sep 2025,
// so any SMTP-based sending will always time out there. Brevo's API uses regular HTTPS instead.
async function sendViaBrevo(to, subject, html) {
  const apiKey = await getSetting('brevoApiKey');
  const { fromName, fromEmail } = await getFromAddress();
  const response = await axios.post('https://api.brevo.com/v3/smtp/email', {
    sender: { name: fromName, email: fromEmail },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  }, {
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  return { messageId: response.data.messageId };
}

// ─── SMTP fallback (only works if hosting allows outbound SMTP — e.g. paid Render, or elsewhere) ──
async function getTransporter() {
  const host = (await getSetting('smtpHost')) || process.env.SMTP_HOST;
  const port = Number((await getSetting('smtpPort')) || process.env.SMTP_PORT || 587);
  const user = (await getSetting('smtpUser')) || process.env.SMTP_USER;
  const pass = (await getSetting('smtpPass')) || process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Email is not configured yet. Add a Brevo API key (recommended) or SMTP details in Admin → Settings → Email.');
  }

  return nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
    family: 4,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
  });
}

async function sendViaSmtp(to, subject, html) {
  const transporter = await getTransporter();
  const { fromName, fromEmail } = await getFromAddress();
  const info = await transporter.sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, html });
  return { messageId: info.messageId };
}

// Send one email — uses Brevo if configured, otherwise falls back to SMTP
async function sendEmail(to, subject, html) {
  const brevoKey = await getSetting('brevoApiKey');
  try {
    const info = brevoKey ? await sendViaBrevo(to, subject, html) : await sendViaSmtp(to, subject, html);
    console.log(`[email] Sent to ${to} via ${brevoKey ? 'Brevo' : 'SMTP'} — messageId: ${info.messageId}`);
    return info;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error(`[email] Failed to send to ${to}:`, msg);
    throw new Error(msg);
  }
}

// Send the same email to many subscribers, one at a time (safest for typical SMTP rate limits).
// Returns { sent, failed } counts; does not throw on individual failures.
async function sendBulkEmail(recipients, subject, html) {
  let sent = 0, failed = 0;
  for (const to of recipients) {
    try {
      await sendEmail(to, subject, html);
      sent++;
    } catch (err) {
      failed++;
    }
  }
  return { sent, failed };
}

module.exports = { sendEmail, sendBulkEmail };
