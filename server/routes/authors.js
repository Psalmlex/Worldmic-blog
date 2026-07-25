const express = require('express');
const router = express.Router();
const { StaffUser } = require('../models/Models');
const Post = require('../models/Post');

// Public author profile: bio, stats, and their published posts
router.get('/:username', async (req, res) => {
  try {
    const author = await StaffUser.findOne({ username: req.params.username.toLowerCase().trim() })
      .select('username name bio avatarUrl followerCount role createdAt');
    if (!author) return res.status(404).json({ error: 'Writer not found' });

    const posts = await Post.find({ authorUsername: author.username, status: 'published' })
      .sort({ createdAt: -1 })
      .select('title excerpt category featuredImage views likes createdAt');

    const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
    const totalViews = posts.reduce((sum, p) => sum + (p.views || 0), 0);

    res.json({
      username: author.username,
      name: author.name || author.username,
      bio: author.bio || '',
      avatarUrl: author.avatarUrl || '',
      followerCount: author.followerCount || 0,
      memberSince: author.createdAt,
      postCount: posts.length,
      totalLikes, totalViews,
      posts,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Follow / unfollow — anonymous (tracked client-side via localStorage, like the post-like system)
router.post('/:username/follow', async (req, res) => {
  try {
    const author = await StaffUser.findOneAndUpdate(
      { username: req.params.username.toLowerCase().trim() },
      { $inc: { followerCount: 1 } },
      { new: true }
    );
    if (!author) return res.status(404).json({ error: 'Writer not found' });
    res.json({ followerCount: author.followerCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:username/unfollow', async (req, res) => {
  try {
    const author = await StaffUser.findOne({ username: req.params.username.toLowerCase().trim() });
    if (!author) return res.status(404).json({ error: 'Writer not found' });
    author.followerCount = Math.max(0, (author.followerCount || 0) - 1);
    await author.save();
    res.json({ followerCount: author.followerCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
