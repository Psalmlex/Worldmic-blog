const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Storage for blog featured images
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'worldmic/posts',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation: [{ width: 1200, height: 630, crop: 'limit', quality: 'auto' }],
  },
});

// Storage for ad images
const adStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'worldmic/ads',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation: [{ quality: 'auto' }],
  },
});

const upload    = multer({ storage });
const adUpload  = multer({ storage: adStorage });

module.exports = { cloudinary, upload, adUpload };
