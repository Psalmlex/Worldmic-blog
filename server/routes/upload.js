const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const { cloudinary, upload, adUpload } = require('../../config/cloudinary');

// POST /api/upload/image  — featured image for a blog post
router.post('/image', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    url:       req.file.path,          // Cloudinary HTTPS URL
    public_id: req.file.filename,
  });
});

// POST /api/upload/ad  — ad banner image
router.post('/ad', auth, adUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    url:       req.file.path,
    public_id: req.file.filename,
  });
});

// DELETE /api/upload/:public_id  — remove from Cloudinary
router.delete('/:public_id', auth, async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.public_id);
    await cloudinary.uploader.destroy(id);
    res.json({ message: 'Image deleted from Cloudinary' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
