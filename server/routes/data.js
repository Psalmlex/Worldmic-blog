const express = require('express');
const router = express.Router();
const { Comment, Ad, Settings, Subscriber } = require('../models/Models');
const auth = require('../middleware/auth');

// ======= COMMENTS =======
router.get('/comments/post/:postId', async (req, res) => {
  try {
    const comments = await Comment.find({ postId: req.params.postId, status: 'approved' }).sort({ createdAt: -1 });
    res.json(comments);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/comments', async (req, res) => {
  try {
    const comment = new Comment(req.body);
    await comment.save();
    res.status(201).json({ message: 'Comment submitted for review', comment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/comments/admin/all', auth, async (req, res) => {
  try {
    const comments = await Comment.find().populate('postId', 'title').sort({ createdAt: -1 });
    res.json(comments);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/comments/:id', auth, async (req, res) => {
  try {
    const comment = await Comment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(comment);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/comments/:id', auth, async (req, res) => {
  try {
    await Comment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Comment deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ======= ADS =======
router.get('/ads', async (req, res) => {
  try {
    const { position } = req.query;
    let query = { isActive: true };
    if (position) query.position = position;
    const ads = await Ad.find(query);
    // Track impression
    if (ads.length > 0) {
      await Ad.updateMany({ _id: { $in: ads.map(a => a._id) } }, { $inc: { impressions: 1 } });
    }
    res.json(ads);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ads/admin/all', auth, async (req, res) => {
  try {
    const ads = await Ad.find().sort({ createdAt: -1 });
    res.json(ads);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ads', auth, async (req, res) => {
  try {
    const ad = new Ad(req.body);
    await ad.save();
    res.status(201).json(ad);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/ads/:id', auth, async (req, res) => {
  try {
    const ad = await Ad.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(ad);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ads/:id', auth, async (req, res) => {
  try {
    await Ad.findByIdAndDelete(req.params.id);
    res.json({ message: 'Ad deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ads/:id/click', async (req, res) => {
  try {
    await Ad.findByIdAndUpdate(req.params.id, { $inc: { clicks: 1 } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ======= SETTINGS =======
const jwt = require('jsonwebtoken');
const SENSITIVE_SETTINGS_KEYS = ['imageApiKey', 'textAiKey'];

router.get('/settings', async (req, res) => {
  try {
    const settings = await Settings.find();
    const result = {};
    settings.forEach(s => { if (!SENSITIVE_SETTINGS_KEYS.includes(s.key)) result[s.key] = s.value; });

    // Only an authenticated admin gets the API keys back
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role === 'admin') {
          settings.forEach(s => { if (SENSITIVE_SETTINGS_KEYS.includes(s.key)) result[s.key] = s.value; });
        }
      } catch { /* invalid/missing token: sensitive keys simply stay excluded */ }
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings', auth, auth.requireAdmin, async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      await Settings.findOneAndUpdate({ key }, { key, value, updatedBy: 'admin' }, { upsert: true, new: true });
    }
    res.json({ message: 'Settings updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ======= NEWSLETTER =======
router.post('/subscribe', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    const existing = await Subscriber.findOne({ email });
    if (existing) {
      if (existing.status === 'unsubscribed') {
        existing.status = 'active';
        await existing.save();
        return res.json({ message: 'Welcome back! Your subscription is reactivated.' });
      }
      return res.status(400).json({ error: 'This email is already subscribed' });
    }
    await Subscriber.create({ email });
    res.status(201).json({ message: 'Subscribed! Thanks for joining.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/subscribers/admin/all', auth, async (req, res) => {
  try {
    const subscribers = await Subscriber.find().sort({ createdAt: -1 });
    res.json(subscribers);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/subscribers/:id', auth, async (req, res) => {
  try {
    await Subscriber.findByIdAndDelete(req.params.id);
    res.json({ message: 'Subscriber removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
