const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('./db');
const { toPublicUser, createSession, destroySession, requireAuth } = require('./session');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ALLOWED_ROLES = new Set(['farmer', 'buyer']);

// Demo / development mode. When enabled the "Create New Admin" flow no longer
// requires the ADMIN_SETUP_CODE and the Admin login accepts any email/password
// so demo users always reach the Admin Dashboard. Set DEMO_MODE=true explicitly
// (or leave it unset outside production). In production (NODE_ENV=production and
// DEMO_MODE not enabled) full credential + setup-code validation is enforced.
const DEMO_MODE =
  process.env.DEMO_MODE === 'true' || process.env.DEMO_MODE === '1' || process.env.NODE_ENV !== 'production';

// In-memory per-IP limiter for the protected admin-setup endpoint (single
// server instance; brute-force protection for the ADMIN_SETUP_CODE).
const setupAttempts = new Map();
const SETUP_LIMIT = 20;
const SETUP_WINDOW_MS = 15 * 60 * 1000;

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64);
}

function setupRateLimited(ip) {
  const now = Date.now();
  const rec = (setupAttempts.get(ip) || []).filter((t) => now - t < SETUP_WINDOW_MS);
  setupAttempts.set(ip, rec);
  return rec.length >= SETUP_LIMIT;
}

function recordSetupAttempt(ip) {
  const now = Date.now();
  const rec = (setupAttempts.get(ip) || []).filter((t) => now - t < SETUP_WINDOW_MS);
  rec.push(now);
  setupAttempts.set(ip, rec);
}

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function validateEmail(email) {
  if (!email || email.length > 254) return false;
  return EMAIL_REGEX.test(email);
}

function validateRegistration(req, res) {
  const name = sanitizeString(req.body && req.body.name, 100);
  const email = sanitizeString(req.body && req.body.email, 254).toLowerCase();
  const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
  const role = sanitizeString(req.body && req.body.role, 20).toLowerCase();
  const phone = sanitizeString(req.body && req.body.phone, 30);

  if (!name) {
    res.status(400).json({ error: 'Please enter your name.' });
    return null;
  }
  if (!validateEmail(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return null;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    return null;
  }
  if (!ALLOWED_ROLES.has(role)) {
    res.status(400).json({ error: 'Please select a valid role.' });
    return null;
  }

  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingEmail) {
    res.status(409).json({ error: 'Email already registered.' });
    return null;
  }

  return { name, email, password, role, phone };
}

router.post('/register', (req, res) => {
  try {
    const data = validateRegistration(req, res);
    if (!data) return;

    const passwordHash = bcrypt.hashSync(data.password, 12);
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role, phone, location) VALUES (?, ?, ?, ?, ?, ?)')
      .run(data.name, data.email, passwordHash, data.role, data.phone, sanitizeString(req.body && req.body.location, 120));

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({ message: 'Account created successfully.', user: toPublicUser(row) });
  } catch (err) {
    if (String(err && err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email already registered.' });
    }
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Protected, env-gated admin self-service account creation (forgotten admin
// access recovery). In production it validates ADMIN_SETUP_CODE on the server
// (never exposed to the browser); in demo mode the code is not required.
// Existing accounts are never modified.
function insertAdmin(name, email, passwordHash) {
  return db
    .prepare("INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'admin', 'active')")
    .run(name, email, passwordHash);
}

router.post('/admin/setup', (req, res) => {
  try {
    const ip = clientIp(req);
    const setupCode = typeof (req.body && req.body.setupCode) === 'string' ? req.body.setupCode : '';

    if (!DEMO_MODE) {
      const expected = process.env.ADMIN_SETUP_CODE;
      if (!expected || !String(expected).trim()) {
        return res.status(503).json({ error: 'Admin setup is not enabled on this server.' });
      }
      if (setupRateLimited(ip)) {
        return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      }
      const a = Buffer.from(String(expected).trim());
      const b = Buffer.from(String(setupCode).trim());
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        recordSetupAttempt(ip);
        return res.status(403).json({ error: 'Invalid Admin Setup Code.' });
      }
    }

    const name = sanitizeString(req.body && req.body.name, 100);
    const email = sanitizeString(req.body && req.body.email, 254).toLowerCase();
    const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';

    const fail = (status, message) => {
      if (!DEMO_MODE) recordSetupAttempt(ip);
      return res.status(status).json({ error: message });
    };

    if (!name) return fail(400, 'Please enter your name.');
    if (!validateEmail(email)) return fail(400, 'Please enter a valid email address.');
    if (password.length < 6) return fail(400, 'Password must be at least 6 characters long.');

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return fail(409, 'Email already exists.');

    const passwordHash = bcrypt.hashSync(password, 12);
    const result = insertAdmin(name, email, passwordHash);

    return res.status(201).json({
      message: 'Admin account created. You can now log in.',
      admin: { id: result.lastInsertRowid, name, email, role: 'admin' },
    });
  } catch (err) {
    if (String(err && err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email already exists.' });
    }
    console.error('Admin setup error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Admin login. Demo mode lets any email/password through to the Admin
// Dashboard (existing admin identity is kept when the email matches, otherwise
// a seeded/available admin is used as the demo account). Production mode keeps
// full credential validation.
router.post('/admin/login', (req, res) => {
  try {
    const email = sanitizeString(req.body && req.body.email, 254).toLowerCase();
    const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter your email and password.' });
    }

    const row = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'admin'").get(email);

    if (DEMO_MODE) {
      let admin = row;
      if (!admin) {
        admin =
          db.prepare("SELECT * FROM users WHERE role = 'admin' AND email = ?").get('admin@deepimart.com') ||
          db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
      }
      if (!admin) {
        return res.status(503).json({ error: 'No admin account exists. Create one with "Create New Admin".' });
      }
      const token = createSession(admin.id);
      return res.status(200).json({ message: 'Login successful.', token, user: toPublicUser(admin) });
    }

    if (!row) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (row.status !== 'active') {
      return res.status(403).json({ error: 'Your account has been disabled.' });
    }
    const token = createSession(row.id);
    return res.status(200).json({ message: 'Login successful.', token, user: toPublicUser(row) });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.post('/login', (req, res) => {
  try {
    const email = sanitizeString(req.body && req.body.email, 254).toLowerCase();
    const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';

    if (!validateEmail(email) || !password) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!row) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordOk = bcrypt.compareSync(password, row.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (row.status !== 'active') {
      return res.status(403).json({ error: 'Your account has been disabled.' });
    }

    const token = createSession(row.id);
    return res.status(200).json({ message: 'Login successful.', token, user: toPublicUser(row) });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.patch('/profile', requireAuth, (req, res) => {
  const name = sanitizeString(req.body && req.body.name, 100);
  const phone = sanitizeString(req.body && req.body.phone, 30);
  const location = sanitizeString(req.body && req.body.location, 120);
  const bio = sanitizeString(req.body && req.body.bio, 2000);

  if (!name) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }

  db.prepare('UPDATE users SET name = ?, phone = ?, location = ?, bio = ? WHERE id = ?').run(
    name,
    phone,
    location,
    bio,
    req.user.id
  );

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ message: 'Profile updated.', user: toPublicUser(row) });
});

router.patch('/password', requireAuth, (req, res) => {
  const currentPassword = typeof (req.body && req.body.currentPassword) === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof (req.body && req.body.newPassword) === 'string' ? req.body.newPassword : '';

  if (!currentPassword) {
    return res.status(400).json({ error: 'Please enter your current password.' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }
  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from your current password.' });
  }

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.token);

  res.json({ message: 'Password changed. Other sessions signed out.' });
});

router.post('/logout', requireAuth, (req, res) => {
  destroySession(req.token);
  res.json({ message: 'Logged out.' });
});

module.exports = router;
