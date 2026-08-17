const crypto = require('node:crypto');
const db = require('./db');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone || '',
    location: row.location || '',
    bio: row.bio || '',
    status: row.status || 'active',
    createdAt: row.created_at,
  };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  );
  return token;
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getUserByToken(token) {
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, new Date().toISOString());
  return row || null;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? getUserByToken(token) : null;
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'Your account has been disabled.' });
  }
  req.user = toPublicUser(user);
  req.token = token;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = { toPublicUser, createSession, destroySession, getUserByToken, requireAuth, requireRole };
