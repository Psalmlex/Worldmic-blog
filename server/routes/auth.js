const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const { StaffUser, Inquiry } = require('../models/Models');

function genCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function genToken() { return crypto.randomBytes(24).toString('hex'); }

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(401).json({ error: 'Invalid credentials' });
  try {
    const envUser = process.env.ADMIN_USERNAME || 'admin';
    const envPass = process.env.ADMIN_PASSWORD || 'WorldMic2025!';

    // The single super-admin account, defined via environment variables
    if (username === envUser && password === envPass) {
      const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
      return res.json({ token, message: 'Login successful', role: 'admin', username });
    }

    // Additional staff accounts (created by the admin, or self-signed-up writers)
    const staff = await StaffUser.findOne({ username: username.toLowerCase().trim() });
    if (!staff) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, staff.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    if (!staff.emailVerified) return res.status(403).json({ error: 'Please verify your email before logging in.', needsVerification: true, username: staff.username });

    const token = jwt.sign({ username: staff.username, role: staff.role, staffId: staff._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, message: 'Login successful', role: staff.role, username: staff.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ valid: false });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, role: decoded.role || 'admin', username: decoded.username });
  } catch {
    res.status(401).json({ valid: false });
  }
});

// ======= STAFF MANAGEMENT (admin only) =======
router.get('/staff', auth, auth.requireAdmin, async (req, res) => {
  try {
    const Post = require('../models/Post');
    const staff = await StaffUser.find().select('-passwordHash -verificationCode').sort({ createdAt: -1 });
    const staffWithStats = await Promise.all(staff.map(async (s) => {
      const posts = await Post.find({ authorUsername: s.username }).select('views likes');
      const totalViews = posts.reduce((sum, p) => sum + (p.views || 0), 0);
      const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
      return { ...s.toObject(), postCount: posts.length, totalViews, totalLikes };
    }));
    res.json(staffWithStats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/staff', auth, auth.requireAdmin, async (req, res) => {
  try {
    const { username, password, role, name } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const cleanUsername = username.toLowerCase().trim();
    const envUser = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    if (cleanUsername === envUser) return res.status(400).json({ error: 'That username is reserved' });
    const existing = await StaffUser.findOne({ username: cleanUsername });
    if (existing) return res.status(400).json({ error: 'Username already taken' });
    const passwordHash = await bcrypt.hash(password, 10);
    const staff = await StaffUser.create({ username: cleanUsername, passwordHash, role: role === 'admin' ? 'admin' : 'editor', name: name || '', emailVerified: true });
    res.status(201).json({ _id: staff._id, username: staff.username, role: staff.role, name: staff.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/staff/:id', auth, auth.requireAdmin, async (req, res) => {
  try {
    await StaffUser.findByIdAndDelete(req.params.id);
    res.json({ message: 'Staff account removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Any logged-in staff member can update their own profile (bio, avatar, display name)
router.put('/me', auth, async (req, res) => {
  try {
    const { name, bio, avatarUrl } = req.body;
    const staff = await StaffUser.findOneAndUpdate(
      { username: req.admin.username },
      { ...(name !== undefined && { name }), ...(bio !== undefined && { bio }), ...(avatarUrl !== undefined && { avatarUrl }) },
      { new: true }
    );
    if (!staff) return res.status(404).json({ error: 'Only self-signed-up writer accounts have an editable profile' });
    res.json({ username: staff.username, name: staff.name, bio: staff.bio, avatarUrl: staff.avatarUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ======= WRITER INVITE FLOW =======

// Admin approves a "team" inquiry and sends them a signup invite by email
router.post('/invite/:inquiryId', auth, auth.requireAdmin, async (req, res) => {
  try {
    const inquiry = await Inquiry.findById(req.params.inquiryId);
    if (!inquiry) return res.status(404).json({ error: 'Inquiry not found' });
    if (inquiry.type !== 'team') return res.status(400).json({ error: 'Only Join Team inquiries can be invited' });

    const token = genToken();
    inquiry.inviteToken = token;
    inquiry.inviteStatus = 'invited';
    inquiry.status = 'reviewed';
    await inquiry.save();

    const { sendEmail } = require('../services/emailService');
    const signupUrl = `${req.protocol}://${req.get('host')}/writer-signup.html?token=${token}`;
    await sendEmail(inquiry.email, "You're invited to write for World Mic!", `
      <div style="font-family:sans-serif;line-height:1.6">
        <h2>Welcome to World Mic, ${inquiry.name}!</h2>
        <p>We reviewed your application and we'd love to have you on the team.</p>
        <p>Click below to set up your writer account:</p>
        <p><a href="${signupUrl}" style="background:#1a73e8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Set Up My Account</a></p>
        <p style="color:#888;font-size:0.85rem">Or copy this link: ${signupUrl}</p>
      </div>`);

    res.json({ message: `Invite sent to ${inquiry.email}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Validate an invite token (used by the signup page to show who's signing up)
router.get('/invite/:token', async (req, res) => {
  try {
    const inquiry = await Inquiry.findOne({ inviteToken: req.params.token });
    if (!inquiry) return res.status(404).json({ error: 'Invalid or expired invite link' });
    if (inquiry.inviteStatus === 'signed_up') return res.status(400).json({ error: 'This invite has already been used' });
    res.json({ name: inquiry.name, email: inquiry.email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Complete signup from an invite: creates the account (unverified) and emails a confirmation code
router.post('/writer-signup', async (req, res) => {
  try {
    const { token, username, password, bio } = req.body;
    if (!token || !username || !password) return res.status(400).json({ error: 'Missing required fields' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const inquiry = await Inquiry.findOne({ inviteToken: token });
    if (!inquiry) return res.status(404).json({ error: 'Invalid or expired invite link' });
    if (inquiry.inviteStatus === 'signed_up') return res.status(400).json({ error: 'This invite has already been used' });

    const cleanUsername = username.toLowerCase().trim();
    const envUser = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
    if (cleanUsername === envUser) return res.status(400).json({ error: 'That username is reserved' });
    const existing = await StaffUser.findOne({ username: cleanUsername });
    if (existing) return res.status(400).json({ error: 'Username already taken' });

    const passwordHash = await bcrypt.hash(password, 10);
    const code = genCode();
    const staff = await StaffUser.create({
      username: cleanUsername, passwordHash, role: 'editor',
      name: inquiry.name, email: inquiry.email, bio: bio || '',
      emailVerified: false, verificationCode: code,
      verificationCodeExpires: new Date(Date.now() + 30 * 60 * 1000),
    });

    inquiry.inviteStatus = 'signed_up';
    await inquiry.save();

    const { sendEmail } = require('../services/emailService');
    await sendEmail(inquiry.email, 'Your World Mic confirmation code', `
      <div style="font-family:sans-serif;line-height:1.6">
        <h2>Confirm your email</h2>
        <p>Your confirmation code is:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:4px">${code}</p>
        <p style="color:#888;font-size:0.85rem">This code expires in 30 minutes.</p>
      </div>`);

    res.status(201).json({ message: 'Account created — check your email for a confirmation code.', username: staff.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/verify-email', async (req, res) => {
  try {
    const { username, code } = req.body;
    const staff = await StaffUser.findOne({ username: (username || '').toLowerCase().trim() });
    if (!staff) return res.status(404).json({ error: 'Account not found' });
    if (staff.emailVerified) return res.json({ message: 'Already verified — you can log in.' });
    if (!staff.verificationCode || staff.verificationCode !== String(code).trim()) return res.status(400).json({ error: 'Incorrect code' });
    if (staff.verificationCodeExpires && staff.verificationCodeExpires < new Date()) return res.status(400).json({ error: 'Code expired — request a new one' });

    staff.emailVerified = true;
    staff.verificationCode = '';
    await staff.save();
    res.json({ message: 'Email verified! You can now log in.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/resend-code', async (req, res) => {
  try {
    const { username } = req.body;
    const staff = await StaffUser.findOne({ username: (username || '').toLowerCase().trim() });
    if (!staff) return res.status(404).json({ error: 'Account not found' });
    if (staff.emailVerified) return res.json({ message: 'Already verified — you can log in.' });

    const code = genCode();
    staff.verificationCode = code;
    staff.verificationCodeExpires = new Date(Date.now() + 30 * 60 * 1000);
    await staff.save();

    const { sendEmail } = require('../services/emailService');
    await sendEmail(staff.email, 'Your new World Mic confirmation code', `
      <div style="font-family:sans-serif;line-height:1.6">
        <p style="font-size:32px;font-weight:700;letter-spacing:4px">${code}</p>
        <p style="color:#888;font-size:0.85rem">This code expires in 30 minutes.</p>
      </div>`);
    res.json({ message: 'New code sent!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
