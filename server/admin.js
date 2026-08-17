const express = require('express');
const db = require('./db');
const { requireAuth, requireRole } = require('./session');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

router.get('/users', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, email, role, phone, location, status, created_at,
              (SELECT COUNT(*) FROM products p WHERE p.farmer_id = u.id) AS product_count,
              (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id) AS order_count
         FROM users u ORDER BY created_at DESC`
    )
    .all();
  res.json({ users: rows });
});

router.patch('/users/:id', (req, res) => {
  const id = num(req.params.id, NaN);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user.' });
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot modify your own account here.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const status = sanitizeString(req.body && req.body.status, 20);
  const role = sanitizeString(req.body && req.body.role, 20);

  if (status && ['active', 'disabled'].includes(status)) {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  }
  if (role && ['farmer', 'buyer', 'admin'].includes(role)) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }
  if (status === 'disabled') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  const updated = db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(id);
  res.json({ message: 'User updated.', user: updated });
});

router.delete('/users/:id', (req, res) => {
  const id = num(req.params.id, NaN);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user.' });
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: 'User deleted.' });
});

router.get('/products', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.price, p.unit, p.quantity, p.status, p.created_at,
              u.name AS farmer_name, c.name AS category_name
         FROM products p
         JOIN users u ON u.id = p.farmer_id
         JOIN categories c ON c.id = p.category_id
        ORDER BY p.created_at DESC`
    )
    .all();
  res.json({ products: rows });
});

router.patch('/products/:id', (req, res) => {
  const id = num(req.params.id, NaN);
  const status = sanitizeString(req.body && req.body.status, 20);
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  db.prepare('UPDATE products SET status = ? WHERE id = ?').run(status, id);
  res.json({ message: `Product ${status === 'approved' ? 'approved' : status}.` });
});

router.get('/orders', (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.id, o.order_code, o.total, o.status, o.payment_status, o.created_at,
              b.name AS buyer_name, f.name AS farmer_name
         FROM orders o
         JOIN users b ON b.id = o.buyer_id
         JOIN users f ON f.id = o.farmer_id
        ORDER BY o.created_at DESC`
    )
    .all();
  res.json({ orders: rows });
});

router.get('/reports', (req, res) => {
  const usersByRole = db
    .prepare('SELECT role, COUNT(*) AS n FROM users GROUP BY role')
    .all()
    .map((r) => ({ role: r.role, n: r.n }));

  const ordersByStatus = db
    .prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status')
    .all()
    .map((r) => ({ status: r.status, n: r.n }));

  const payments = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'paid'").get();
  const orderCounts = db.prepare('SELECT COUNT(*) AS n FROM orders').get();
  const pendingOrders = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'placed'").get();
  const productCounts = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  const pendingProducts = db.prepare("SELECT COUNT(*) AS n FROM products WHERE status = 'pending'").get();
  const userCounts = db.prepare('SELECT COUNT(*) AS n FROM users').get();

  const topProducts = db
    .prepare(
      `SELECT p.name, SUM(oi.quantity) AS sold, SUM(oi.subtotal) AS revenue
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
        WHERE o.status != 'cancelled' AND o.status != 'rejected'
        GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 5`
    )
    .all();

  const topFarmers = db
    .prepare(
      `SELECT f.name, COUNT(o.id) AS orders, COALESCE(SUM(o.total), 0) AS revenue
         FROM users f
         LEFT JOIN orders o ON o.farmer_id = f.id AND o.status != 'cancelled' AND o.status != 'rejected'
        WHERE f.role = 'farmer'
        GROUP BY f.id ORDER BY revenue DESC LIMIT 5`
    )
    .all();

  const dailySales = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
         FROM orders
        WHERE status != 'cancelled' AND status != 'rejected'
        GROUP BY day ORDER BY day DESC LIMIT 14`
    )
    .all()
    .reverse();

  res.json({
    users: { total: userCounts.n, byRole: usersByRole },
    products: { total: productCounts.n, pending: pendingProducts.n },
    orders: { total: orderCounts.n, placed: pendingOrders.n, byStatus: ordersByStatus },
    revenue: payments.total,
    topProducts,
    topFarmers,
    dailySales,
  });
});

module.exports = router;
