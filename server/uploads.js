const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const ALLOWED_EXTS = Object.values(MIME_EXT);

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function randomFileName(mimeType) {
  const ext = MIME_EXT[mimeType] || '.jpg';
  return Date.now().toString(36) + '_' + crypto.randomBytes(10).toString('hex') + ext;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        ensureUploadsDir();
        cb(null, UPLOADS_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      cb(null, randomFileName(file.mimetype));
    },
  }),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const mimeOk = Object.prototype.hasOwnProperty.call(MIME_EXT, file.mimetype);
    const ext = path.extname(file.originalname || '').toLowerCase();
    const extOk = mimeOk && ALLOWED_EXTS.includes(ext);
    if (!mimeOk || !extOk) {
      const err = new Error('Invalid image type. Please upload a JPG, PNG or WEBP image.');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

function isStoredPhoto(photo) {
  return (
    typeof photo === 'string' &&
    /^\/uploads\/[a-z0-9]+_[0-9a-f]{20}\.(jpg|png|webp)$/.test(photo)
  );
}

function fileForPhoto(photo) {
  if (!isStoredPhoto(photo)) return null;
  return path.join(UPLOADS_DIR, path.basename(photo));
}

function removePhoto(photo) {
  const file = fileForPhoto(photo);
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {}
}

module.exports = {
  upload,
  UPLOADS_DIR,
  MAX_IMAGE_BYTES,
  isStoredPhoto,
  removePhoto,
};