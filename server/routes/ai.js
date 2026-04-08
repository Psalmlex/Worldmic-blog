const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ai = require('../services/aiService');
const Post = require('../models/Post');
const { Comment, Settings, AILog } = require('../models/Models');

async function log(action, command, target, result, status = 'success') {
  try {
    await AILog.create({ action, command, target, result, status });
  } catch (e) { console.error('Log error:', e.message); }
}

// Main AI command handler
router.post('/command', auth, async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'No command provided' });

  try {
    const intent = await ai.parseAdminCommand(command);
    res.json({ intent, message: intent.summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate a new post
router.post('/generate-post', auth, async (req, res) => {
  const { topic, tone, category } = req.body;
  try {
    const postData = await ai.generatePost(topic, tone, category);
    await log('create_post', `Generate post: ${topic}`, topic, 'Post generated successfully');
    res.json({ postData, message: 'Post generated successfully. Review and publish.' });
  } catch (err) {
    await log('create_post', `Generate post: ${topic}`, topic, err.message, 'failed');
    res.status(500).json({ error: err.message });
  }
});

// Re-edit post by ID or URL
router.post('/reedit-post', auth, async (req, res) => {
  const { postId, instructions } = req.body;
  try {
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const improved = await ai.reeditPost(post.content, post.title, instructions);
    await log('edit_post', `Reedit post: ${post.title}`, postId, 'Post re-edited');
    res.json({ improved, originalId: postId, message: 'Post improved. Review and save.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate featured image
router.post('/generate-image', auth, async (req, res) => {
  const { prompt, postId } = req.body;
  try {
    const result = await ai.generateImage(prompt);
    if (result.error) return res.status(400).json({ error: result.error });
    if (postId && result.url) {
      await Post.findByIdAndUpdate(postId, { featuredImage: result.url });
    }
    await log('generate_image', `Generate image: ${prompt}`, postId || 'standalone', result.url ? 'Image generated' : 'Failed');
    res.json({ imageUrl: result.url, message: 'Image generated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-reply to comments
router.post('/reply-comments', auth, async (req, res) => {
  const { commentIds } = req.body; // array of comment IDs, or empty for all pending
  try {
    let query = { status: 'approved', replyStatus: 'none' };
    if (commentIds?.length) query._id = { $in: commentIds };
    const comments = await Comment.find(query).populate('postId', 'title');
    if (!comments.length) return res.json({ message: 'No comments to reply to', count: 0 });

    const replies = [];
    for (const comment of comments) {
      const reply = await ai.generateCommentReply(comment.postId?.title || 'Blog Post', comment.content, comment.name);
      await Comment.findByIdAndUpdate(comment._id, { aiReply: reply, replyStatus: 'pending' });
      replies.push({ id: comment._id, name: comment.name, reply });
    }
    await log('reply_comments', 'Auto-reply to comments', `${replies.length} comments`, 'Replies generated');
    res.json({ replies, count: replies.length, message: `Generated ${replies.length} replies. Review before sending.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trending suggestions
router.get('/trending', auth, async (req, res) => {
  try {
    const categories = await Post.distinct('category', { status: 'published' });
    const suggestions = await ai.getTrendingSuggestions(categories);
    await log('suggest_trending', 'Get trending suggestions', 'all', `${suggestions.length} suggestions`);
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get AI logs
router.get('/logs', auth, async (req, res) => {
  try {
    const { AILog } = require('../models/Models');
    const logs = await AILog.find().sort({ createdAt: -1 }).limit(50);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chat with AI (general assistant)
router.post('/chat', auth, async (req, res) => {
  const { message, history = [] } = req.body;
  try {
    const axios = require('axios');
    const messages = [...history, { role: 'user', content: message }];
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are Mica, the AI assistant for World Mic blog platform. You help the admin manage the blog, create content, and answer questions. Be concise, helpful, and professional. When the admin asks you to do something actionable (create post, edit, etc.), respond with the action and a confirmation request. Current date: ${new Date().toLocaleDateString()}.`,
      messages,
    }, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      }
    });
    const reply = response.data.content[0].text;
    await log('chat', message, 'admin', reply.substring(0, 100));
    res.json({ reply, messages: [...messages, { role: 'assistant', content: reply }] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
