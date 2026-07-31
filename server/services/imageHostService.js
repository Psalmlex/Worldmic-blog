const axios = require('axios');
const FormData = require('form-data');
const cloudinary = require('cloudinary').v2;
const { Settings } = require('../models/Models');

// Every uploaded image's public_id is stored as "<provider>::<providerSpecificId>" so that
// deletion still works correctly even after the admin switches the active provider later —
// each image "remembers" which service it actually lives on.

async function getSetting(key) {
  const doc = await Settings.findOne({ key });
  return doc?.value;
}

async function getActiveProvider() {
  return (await getSetting('imageHostProvider')) || 'cloudinary';
}

// ─────────────────────────── Cloudinary ───────────────────────────
async function uploadCloudinary(buffer, folder) {
  const cloudName = (await getSetting('cloudinaryCloudName')) || process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = (await getSetting('cloudinaryApiKey')) || process.env.CLOUDINARY_API_KEY;
  const apiSecret = (await getSetting('cloudinaryApiSecret')) || process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured. Add credentials in Admin → Settings → Image Hosting.');
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (err, result) => {
      if (err) return reject(err);
      resolve({ url: result.secure_url, id: `cloudinary::${result.public_id}` });
    });
    stream.end(buffer);
  });
}

async function deleteCloudinary(publicId) {
  const cloudName = (await getSetting('cloudinaryCloudName')) || process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = (await getSetting('cloudinaryApiKey')) || process.env.CLOUDINARY_API_KEY;
  const apiSecret = (await getSetting('cloudinaryApiSecret')) || process.env.CLOUDINARY_API_SECRET;
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  await cloudinary.uploader.destroy(publicId);
}

// ─────────────────────────── ImageKit.io ───────────────────────────
async function uploadImageKit(buffer, filename, folder) {
  const privateKey = await getSetting('imagekitPrivateKey');
  if (!privateKey) throw new Error('ImageKit is not configured. Add your private key in Admin → Settings → Image Hosting.');
  const form = new FormData();
  form.append('file', buffer, filename);
  form.append('fileName', filename);
  form.append('folder', `/${folder}`);
  form.append('useUniqueFileName', 'true');
  const res = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
    headers: form.getHeaders(),
    auth: { username: privateKey, password: '' },
  });
  return { url: res.data.url, id: `imagekit::${res.data.fileId}` };
}

async function deleteImageKit(fileId) {
  const privateKey = await getSetting('imagekitPrivateKey');
  if (!privateKey) return;
  await axios.delete(`https://api.imagekit.io/v1/files/${fileId}`, { auth: { username: privateKey, password: '' } });
}

// ─────────────────────────── Uploadcare ───────────────────────────
async function uploadUploadcare(buffer, filename) {
  const publicKey = await getSetting('uploadcarePublicKey');
  if (!publicKey) throw new Error('Uploadcare is not configured. Add your public key in Admin → Settings → Image Hosting.');
  const form = new FormData();
  form.append('UPLOADCARE_PUB_KEY', publicKey);
  form.append('UPLOADCARE_STORE', '1');
  form.append('file', buffer, filename);
  const res = await axios.post('https://upload.uploadcare.com/base/', form, { headers: form.getHeaders() });
  const uuid = res.data.file;
  return { url: `https://ucarecdn.com/${uuid}/`, id: `uploadcare::${uuid}` };
}

async function deleteUploadcare(uuid) {
  const publicKey = await getSetting('uploadcarePublicKey');
  const secretKey = await getSetting('uploadcareSecretKey');
  if (!publicKey || !secretKey) return; // best effort — deletion needs the secret key too
  await axios.delete(`https://api.uploadcare.com/files/${uuid}/`, {
    headers: { Authorization: `Uploadcare.Simple ${publicKey}:${secretKey}` },
  });
}

// ─────────────────────────── ImgBB ───────────────────────────
async function uploadImgbb(buffer, filename) {
  const apiKey = await getSetting('imgbbApiKey');
  if (!apiKey) throw new Error('ImgBB is not configured. Add your API key in Admin → Settings → Image Hosting.');
  const form = new FormData();
  form.append('image', buffer.toString('base64'));
  const res = await axios.post(`https://api.imgbb.com/1/upload?key=${apiKey}`, form, { headers: form.getHeaders() });
  const data = res.data.data;
  // ImgBB's free tier only supports deletion via a one-time "delete_url" link, not a real API —
  // stash it (base64'd so it survives the "provider::id" split) for best-effort deletion later.
  const encoded = Buffer.from(data.delete_url || '').toString('base64');
  return { url: data.url, id: `imgbb::${encoded}` };
}

async function deleteImgbb(encodedDeleteUrl) {
  try {
    const deleteUrl = Buffer.from(encodedDeleteUrl, 'base64').toString('utf8');
    if (deleteUrl) await axios.get(deleteUrl);
  } catch {
    /* ImgBB's delete link isn't a scriptable API for every account — best effort only */
  }
}

// ─────────────────────────── Custom API ───────────────────────────
async function uploadCustom(buffer, filename, mimetype) {
  const url = await getSetting('customUploadUrl');
  const apiKey = await getSetting('customUploadApiKey');
  const fieldName = (await getSetting('customUploadFieldName')) || 'image';
  const urlField = (await getSetting('customUploadResponseField')) || 'url';
  if (!url) throw new Error('Custom image API is not configured. Add the upload URL in Admin → Settings → Image Hosting.');
  const form = new FormData();
  form.append(fieldName, buffer, { filename, contentType: mimetype });
  const headers = { ...form.getHeaders() };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await axios.post(url, form, { headers });
  const resolved = urlField.split('.').reduce((o, k) => (o == null ? o : o[k]), res.data);
  if (!resolved) throw new Error(`Custom API response didn't contain a value at "${urlField}" — check the response field path in Settings.`);
  return { url: resolved, id: `custom::${resolved}` };
}

async function deleteCustom() {
  // Deletion conventions vary too much across arbitrary APIs to generalize safely — skip silently.
}

// ─────────────────────────── Dispatch ───────────────────────────
async function uploadBuffer(buffer, mimetype, filename, folder) {
  const provider = await getActiveProvider();
  switch (provider) {
    case 'imagekit': return uploadImageKit(buffer, filename, folder);
    case 'uploadcare': return uploadUploadcare(buffer, filename);
    case 'imgbb': return uploadImgbb(buffer, filename);
    case 'custom': return uploadCustom(buffer, filename, mimetype);
    default: return uploadCloudinary(buffer, folder);
  }
}

// Accepts either a "data:image/...;base64,..." string or a plain external image URL —
// used by AI image generation, which produces one or the other depending on provider —
// and routes it through whichever hosting provider is currently active.
async function uploadFromSource(source, filename, folder) {
  let buffer, mimetype;
  if (source.startsWith('data:image')) {
    const match = source.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
    if (!match) throw new Error('Invalid base64 image data');
    mimetype = match[1];
    buffer = Buffer.from(match[2], 'base64');
  } else {
    const response = await axios.get(source, { responseType: 'arraybuffer' });
    buffer = Buffer.from(response.data);
    mimetype = response.headers['content-type'] || 'image/png';
  }
  return uploadBuffer(buffer, mimetype, filename, folder);
}

async function deleteImage(publicId) {
  const [provider, ...rest] = String(publicId).split('::');
  const id = rest.join('::');
  switch (provider) {
    case 'imagekit': return deleteImageKit(id);
    case 'uploadcare': return deleteUploadcare(id);
    case 'imgbb': return deleteImgbb(id);
    case 'custom': return deleteCustom(id);
    case 'cloudinary': return deleteCloudinary(id);
    default: return deleteCloudinary(publicId); // legacy IDs saved before this upgrade had no prefix
  }
}

module.exports = { uploadBuffer, uploadFromSource, deleteImage, getActiveProvider };
