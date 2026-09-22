'use strict';

const crypto = require('node:crypto');
const db = require('./db');
const { sendSms } = require('./sms');

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const PHONE_WINDOW_MS = 15 * 60 * 1000;
const PHONE_MAX_SENDS = 5;
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_SENDS = 10;

function pepper() {
  const secret = process.env.OTP_SECRET;
  if (secret && String(secret).trim()) return String(secret);
  if (process.env.NODE_ENV === 'production') {
    const err = new Error('SMS service unavailable. Check the server SMS configuration.');
    err.statusCode = 503;
    throw err;
  }
  // Local/dev fallback. Set OTP_SECRET in production.
  return 'deepimart-local-otp-secret';
}

// SQLite stores UTC timestamps as 'YYYY-MM-DD HH:MM:SS'.
function utcNowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function utcStr(msFromNow) {
  return new Date(Date.now() + msFromNow).toISOString().replace('T', ' ').slice(0, 19);
}

function parseUtc(value) {
  const str = String(value || '').trim();
  if (!str) return NaN;
  const iso = str.indexOf('T') === -1 ? str.replace(' ', 'T') : str;
  const hasZone = /Z$|[+-][0-9]{2}:?[0-9]{2}$/.test(iso);
  return Date.parse(hasZone ? iso : iso + 'Z');
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return '+' + digits;
}

function hashCode(code) {
  return crypto.createHmac('sha256', pepper()).update(String(code)).digest('hex');
}

function hashMatches(code, storedHash) {
  const a = Buffer.from(hashCode(code), 'utf8');
  const b = Buffer.from(String(storedHash || ''), 'utf8');
  if (a.length !== b.length || b.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function slugIp(ip) {
  return String(ip || '').slice(0, 64);
}

function activeRow(phone) {
  return db
    .prepare(
      `SELECT * FROM otp_requests
        WHERE phone = ? AND purpose = 'register' AND used = 0
        ORDER BY id DESC LIMIT 1`
    )
    .get(phone);
}

function windowCount(column, value, windowMs) {
  const since = utcStr(-windowMs);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM otp_requests
        WHERE ${column} = ? AND created_at >= ?`
    )
    .get(value, since);
  return row ? row.n : 0;
}

// Sends a fresh OTP. Fails safely when SMS is not configured: nothing is
// stored and no "sent" response is returned.
async function sendOtp(phoneValue, ip) {
  const phone = normalizePhone(phoneValue);
  if (!phone) {
    const err = new Error('Please enter a valid mobile number.');
    err.statusCode = 400;
    throw err;
  }

  try {
    db.prepare("DELETE FROM otp_requests WHERE created_at < datetime('now', '-1 day')").run();
  } catch (cleanupErr) {}

  const existingUser = db
    .prepare("SELECT id FROM users WHERE phone = ? AND status = 'active'")
    .get(phone);
  if (existingUser) {
    const err = new Error('Phone number already registered.');
    err.statusCode = 409;
    throw err;
  }

  const last = activeRow(phone);
  if (last) {
    const lastMs = parseUtc(last.created_at);
    const age = Date.now() - lastMs;
    if (Number.isFinite(age) && age < RESEND_COOLDOWN_MS) {
      const wait = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - age) / 1000));
      const err = new Error('Please wait ' + wait + 's before requesting another OTP.');
      err.statusCode = 429;
      err.retryAfter = wait;
      throw err;
    }
  }

  if (
    windowCount('phone', phone, PHONE_WINDOW_MS) >= PHONE_MAX_SENDS ||
    windowCount('ip', slugIp(ip), IP_WINDOW_MS) >= IP_MAX_SENDS
  ) {
    const err = new Error('Too many OTP requests. Try again later.');
    err.statusCode = 429;
    err.retryAfter = 60;
    throw err;
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const expiresAt = utcStr(OTP_TTL_MS);

  // Single active OTP per phone: invalidate older codes first.
  db.prepare(
    "UPDATE otp_requests SET used = 1 WHERE phone = ? AND purpose = 'register' AND used = 0"
  ).run(phone);

  const inserted = db
    .prepare(
      `INSERT INTO otp_requests (phone, purpose, code_hash, attempts, reg_token, used, ip, expires_at)
       VALUES (?, 'register', ?, 0, '', 0, ?, ?)`
    )
    .run(phone, hashCode(code), slugIp(ip), expiresAt);

  try {
    await sendSms(phone, code);
  } catch (e) {
    // Never pretend an OTP went out: remove the stored row and fail.
    try {
      db.prepare('DELETE FROM otp_requests WHERE id = ?').run(inserted.lastInsertRowid);
    } catch (cleanupErr) {}
    const err = new Error(e && e.message ? e.message : 'SMS service unavailable. Check the server SMS configuration.');
    err.statusCode = (e && e.statusCode) || 503;
    throw err;
  }

  return {
    phone,
    ttlSeconds: Math.round(OTP_TTL_MS / 1000),
    resendAfterSeconds: Math.round(RESEND_COOLDOWN_MS / 1000),
  };
}

// Verifies a code and mints a single-use registration token.
function verifyOtp(phoneValue, codeValue) {
  const phone = normalizePhone(phoneValue);
  const code = String(codeValue || '').trim();
  if (!phone) {
    const err = new Error('Please enter a valid mobile number.');
    err.statusCode = 400;
    throw err;
  }
  if (!/^[0-9]{6}$/.test(code)) {
    const err = new Error('Invalid OTP.');
    err.statusCode = 400;
    throw err;
  }

  const row = activeRow(phone);
  if (!row) {
    const err = new Error('Invalid or expired OTP. Please request a new code.');
    err.statusCode = 400;
    throw err;
  }

  const expiresMs = parseUtc(row.expires_at);
  if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) {
    db.prepare('UPDATE otp_requests SET used = 1 WHERE id = ?').run(row.id);
    const err = new Error('OTP has expired. Please request a new code.');
    err.statusCode = 400;
    throw err;
  }

  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    db.prepare('UPDATE otp_requests SET used = 1 WHERE id = ?').run(row.id);
    const err = new Error('Too many verification attempts. Please request a new OTP.');
    err.statusCode = 429;
    throw err;
  }

  if (!hashMatches(code, row.code_hash)) {
    const attempts = row.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      db.prepare('UPDATE otp_requests SET used = 1 WHERE id = ?').run(row.id);
      const err = new Error('Too many verification attempts. Please request a new OTP.');
      err.statusCode = 429;
      throw err;
    }
    db.prepare('UPDATE otp_requests SET attempts = ? WHERE id = ?').run(attempts, row.id);
    const err = new Error('Invalid OTP. ' + (OTP_MAX_ATTEMPTS - attempts) + ' attempts left.');
    err.statusCode = 400;
    throw err;
  }

  const regToken = crypto.randomBytes(24).toString('hex');
  const verifiedAt = utcNowStr();
  const newExpiry = utcStr(OTP_TTL_MS);
  db.prepare(
    'UPDATE otp_requests SET used = 1, attempts = ?, reg_token = ?, verified_at = ?, expires_at = ? WHERE id = ?'
  ).run(row.attempts + 1, regToken, verifiedAt, newExpiry, row.id);

  return { phone, regToken, ttlSeconds: Math.round(OTP_TTL_MS / 1000) };
}

// Consumes a registration token so it can be used exactly once.
function consumeRegToken(phoneValue, regToken) {
  const phone = normalizePhone(phoneValue);
  const token = String(regToken || '').trim();
  if (!phone || !/^[0-9a-f]{48}$/.test(token)) return false;

  const row = db
    .prepare(
      `SELECT * FROM otp_requests
        WHERE phone = ? AND reg_token = ? AND used = 1 AND verified_at IS NOT NULL
        ORDER BY id DESC LIMIT 1`
    )
    .get(phone, token);
  if (!row) return false;

  const expiresMs = parseUtc(row.expires_at);
  if (!Number.isFinite(expiresMs) || Date.now() > expiresMs) return false;

  // Clearing reg_token makes the token single-use.
  const res = db
    .prepare('UPDATE otp_requests SET reg_token = ? WHERE id = ? AND reg_token = ?')
    .run('', row.id, token);
  return res.changes === 1;
}

module.exports = {
  normalizePhone,
  sendOtp,
  verifyOtp,
  consumeRegToken,
  OTP_TTL_MS,
};
