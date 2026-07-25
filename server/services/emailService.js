const nodemailer = require('nodemailer');
const { Settings } = require('../models/Models');

async function getSetting(key) {
  const doc = await Settings.findOne({ key });
  return doc?.value;
}

async function getTransporter() {
  const host = (await getSetting('smtpHost')) || process.env.SMTP_HOST;
  const port = Number((await getSetting('smtpPort')) || process.env.SMTP_PORT || 587);
  const user = (await getSetting('smtpUser')) || process.env.SMTP_USER;
  const pass = (await getSetting('smtpPass')) || process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Email is not configured yet. Add your SMTP details in Admin → Settings → Email.');
  }

  return nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
    family: 4, // force IPv4 — avoids connection timeouts on hosts with broken/slow IPv6 routing to Gmail
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
  });
}

async function getFromAddress() {
  const fromName = (await getSetting('smtpFromName')) || 'World Mic';
  const fromEmail = (await getSetting('smtpFromEmail')) || (await getSetting('smtpUser')) || process.env.SMTP_USER;
  return `"${fromName}" <${fromEmail}>`;
}

// Send one email
async function sendEmail(to, subject, html) {
  const transporter = await getTransporter();
  const from = await getFromAddress();
  try {
    const info = await transporter.sendMail({ from, to, subject, html });
    console.log(`[email] Sent to ${to} — messageId: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`[email] Failed to send to ${to}:`, err.message);
    throw err;
  }
}

// Send the same email to many subscribers, one at a time (safest for typical SMTP rate limits).
// Returns { sent, failed } counts; does not throw on individual failures.
async function sendBulkEmail(recipients, subject, html) {
  const transporter = await getTransporter();
  const from = await getFromAddress();
  let sent = 0, failed = 0;
  for (const to of recipients) {
    try {
      // Personal unsubscribe-style footer per recipient could be added here later
      await transporter.sendMail({ from, to, subject, html });
      sent++;
    } catch (err) {
      console.error(`Email to ${to} failed:`, err.message);
      failed++;
    }
  }
  return { sent, failed };
}

module.exports = { sendEmail, sendBulkEmail };
