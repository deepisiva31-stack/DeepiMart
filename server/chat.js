const express = require('express');
const db = require('./db');
const { requireAuth, requireRole } = require('./session');

const router = express.Router();

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

router.get('/partners', requireAuth, (req, res) => {
  const me = req.user.id;
  const fromMessages = db
    .prepare(
      `SELECT DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS partner_id
         FROM messages WHERE sender_id = ? OR receiver_id = ?`
    )
    .all(me, me, me)
    .map((r) => r.partner_id);

  const fromOrders = db
    .prepare(
      `SELECT DISTINCT CASE WHEN buyer_id = ? THEN farmer_id ELSE buyer_id END AS partner_id
         FROM orders WHERE buyer_id = ? OR farmer_id = ?`
    )
    .all(me, me, me)
    .map((r) => r.partner_id);

  const ids = [...new Set([...fromMessages, ...fromOrders])];
  const partners = [];

  const partnerStmt = db.prepare('SELECT id, name, email, role, location FROM users WHERE id = ? AND status = ?');
  const lastMsgStmt = db.prepare(
    `SELECT body, created_at, sender_id FROM messages
      WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
      ORDER BY id DESC LIMIT 1`
  );
  const unreadStmt = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND receiver_id = ? AND read = 0');

  for (const id of ids) {
    const user = partnerStmt.get(id, 'active');
    if (!user) continue;
    const last = lastMsgStmt.get(me, id, id, me);
    const unread = unreadStmt.get(id, me).n;
    partners.push({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      location: user.location || '',
      lastMessage: last ? { body: last.body, createdAt: last.created_at, fromMe: last.sender_id === me } : null,
      unread: unread,
    });
  }

  partners.sort((a, b) => (a.lastMessage ? Date.parse(a.lastMessage.createdAt) : 0) - (b.lastMessage ? Date.parse(b.lastMessage.createdAt) : 0));
  res.json({ partners });
});

router.get('/unread', requireAuth, (req, res) => {
  const n = db
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE receiver_id = ? AND read = 0')
    .get(req.user.id).n;
  res.json({ unread: n });
});

router.get('/:userId', requireAuth, (req, res) => {
  const userId = num(req.params.userId, NaN);
  const partner = db.prepare('SELECT id, name, role, location FROM users WHERE id = ? AND status = ?').get(userId, 'active');
  if (!partner) return res.status(404).json({ error: 'User not found.' });
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot chat with yourself.' });

  db.prepare('UPDATE messages SET read = 1 WHERE sender_id = ? AND receiver_id = ?').run(userId, req.user.id);

  const messages = db
    .prepare(
      `SELECT id, sender_id, body, created_at FROM messages
        WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
        ORDER BY id ASC`
    )
    .all(req.user.id, userId, userId, req.user.id);
  res.json({ partner, messages });
});

router.post('/:userId', requireAuth, (req, res) => {
  const userId = num(req.params.userId, NaN);
  const body = sanitizeString(req.body && req.body.body, 2000);
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });

  const partner = db.prepare('SELECT id FROM users WHERE id = ? AND status = ?').get(userId, 'active');
  if (!partner) return res.status(404).json({ error: 'User not found.' });
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot chat with yourself.' });

  const result = db
    .prepare('INSERT INTO messages (sender_id, receiver_id, body) VALUES (?, ?, ?)')
    .run(req.user.id, userId, body);
  const message = db.prepare('SELECT id, sender_id, body, created_at FROM messages WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ message });
});

module.exports = router;
