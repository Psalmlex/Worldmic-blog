const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const imageHost = require('../services/imageHostService');

// Memory storage: the buffer is handed straight to whichever provider is active in
// Admin → Settings → Image Hosting, instead of being tied to one provider's storage engine.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP, and GIF images are allowed'));
    }
    cb(null, true);
  },
});

// POST /api/upload/image — featured image for a blog post
router.post('/image', auth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { url, id } = await imageHost.uploadBuffer(req.file.buffer, req.file.mimetype, req.file.originalname, 'worldmic/posts');
    res.json({ url, public_id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/upload/ad — ad banner image
router.post('/ad', auth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { url, id } = await imageHost.uploadBuffer(req.file.buffer, req.file.mimetype, req.file.originalname, 'worldmic/ads');
    res.json({ url, public_id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/upload/:public_id — remove from whichever provider stored it
router.delete('/:public_id', auth, async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.public_id);
    await imageHost.deleteImage(id);
    res.json({ message: 'Image deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
