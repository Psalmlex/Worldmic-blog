const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Post = require('../models/Post');
const auth = require('../middleware/auth');
const { Settings } = require('../models/Models');
const { sendEmail } = require('../services/emailService');

// Public: Get published posts
router.get('/', async (req, res) => {
  try {
    const { category, search, limit = 10, page = 1 } = req.query;
    let query = { status: 'published' };
    if (category) query.category = new RegExp(category, 'i');
    if (search) query.$or = [
      { title: new RegExp(search, 'i') },
      { content: new RegExp(search, 'i') },
      { tags: new RegExp(search, 'i') }
    ];
    const skip = (page - 1) * limit;
    const posts = await Post.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).select('-__v');
    const total = await Post.countDocuments(query);
    res.json({ posts, total, pages: Math.ceil(total / limit), currentPage: Number(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public: Get single post
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Post not found' });
    const post = await Post.findById(req.params.id);
    if (!post || post.status !== 'published') return res.status(404).json({ error: 'Post not found' });
    post.views += 1;
    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public: Like a post
router.post('/:id/like', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Post not found' });
    const post = await Post.findByIdAndUpdate(req.params.id, { $inc: { likes: 1 } }, { new: true });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ likes: post.likes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public: Get categories
router.get('/meta/categories', async (req, res) => {
  try {
    const categories = await Post.distinct('category', { status: 'published' });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get all posts (editors see only their own; admins see everything)
router.get('/admin/all', auth, async (req, res) => {
  try {
    const isAdmin = req.admin?.role === 'admin';
    const filter = isAdmin ? {} : { authorUsername: req.admin?.username };
    const posts = await Post.find(filter).sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Create post
router.post('/', auth, async (req, res) => {
  try {
    let authorDisplay = req.body.author;
    if (!authorDisplay && req.admin?.username) {
      if (req.admin.role === 'admin') {
        authorDisplay = 'World Mic';
      } else {
        const { StaffUser } = require('../models/Models');
        const staff = await StaffUser.findOne({ username: req.admin.username });
        authorDisplay = staff?.name || req.admin.username;
      }
    }
    const post = new Post({ ...req.body, author: authorDisplay || 'World Mic', authorUsername: req.admin?.username || '' });
    await post.save();
    res.status(201).json(post);

    // Notify the admin when someone OTHER than the admin publishes/drafts a post —
    // fire-and-forget, never blocks or fails the actual save.
    if (req.admin?.role && req.admin.role !== 'admin') {
      Settings.findOne({ key: 'notifyEmail' }).then(async setting => {
        const notifyEmail = setting?.value;
        if (!notifyEmail) return;
        const action = post.status === 'published' ? 'published' : 'saved a draft of';
        await sendEmail(notifyEmail, `🔔 ${authorDisplay} ${action} a post — World Mic`, `
          <h2>${authorDisplay} ${action} a post</h2>
          <p><strong>Title:</strong> ${post.title}</p>
          <p><strong>Status:</strong> ${post.status}</p>
          <p style="margin-top:20px"><a href="${req.protocol}://${req.get('host')}/admin-posts.html">Review in Admin →</a></p>
        `).catch(err => console.error('[notify] Failed to send new-post notification email:', err.message));
      }).catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update post
router.put('/:id', auth, async (req, res) => {
  try {
    const existing = await Post.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (req.admin?.role !== 'admin' && existing.authorUsername !== req.admin?.username) {
      return res.status(403).json({ error: 'You can only edit your own posts' });
    }
    const post = await Post.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(post);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Delete post — editors can only request deletion of their own posts; admins delete immediately
router.delete('/:id', auth, async (req, res) => {
  try {
    const existing = await Post.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Post not found' });
    if (req.admin?.role !== 'admin') {
      if (existing.authorUsername !== req.admin?.username) {
        return res.status(403).json({ error: 'You can only request deletion of your own posts' });
      }
      await Post.findByIdAndUpdate(req.params.id, { deletionRequested: true, deletionRequestedBy: req.admin?.username || 'editor' }, { new: true });
      return res.json({ message: 'Deletion requested — an admin needs to approve it', pending: true });
    }
    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: list posts with a pending deletion request
router.get('/admin/pending-deletions', auth, auth.requireAdmin, async (req, res) => {
  try {
    const posts = await Post.find({ deletionRequested: true }).select('title category deletionRequestedBy updatedAt');
    res.json(posts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: reject a pending deletion request (clears the flag, keeps the post)
router.post('/:id/reject-deletion', auth, auth.requireAdmin, async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(req.params.id, { deletionRequested: false, deletionRequestedBy: '' }, { new: true });
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json({ message: 'Deletion request rejected' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
