const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ALLOWED_ROLES = new Set(['farmer', 'buyer']);

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function validateEmail(email) {
  if (!email || email.length > 254) return false;
  if (!EMAIL_REGEX.test(email)) return false;
  return email.length <= 254;
}

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  };
}

router.post('/register', (req, res) => {
  try {
    const name = sanitizeString(req.body && req.body.name, 100);
    const email = sanitizeString(req.body && req.body.email, 254).toLowerCase();
    const password = typeof (req.body && req.body.password) === 'string' ? req.body.password : '';
    const role = sanitizeString(req.body && req.body.role, 20).toLowerCase();

    if (!name) {
      return res.status(400).json({ error: 'Please enter your name.' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }
    if (!ALLOWED_ROLES.has(role)) {
      return res.status(400).json({ error: 'Please select a valid role.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const passwordHash = bcrypt.hashSync(password, 12);
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email, passwordHash, role);

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

    return res.status(200).json({ message: 'Login successful.', user: toPublicUser(row) });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
