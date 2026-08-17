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

function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function productSelect() {
  return `
    SELECT p.*,
           u.name AS farmer_name,
           u.location AS farmer_location,
           u.phone AS farmer_phone,
           u.bio AS farmer_bio,
           c.name AS category_name,
           COALESCE(r.rev_avg, 0) AS avg_rating,
           COALESCE(r.rev_count, 0) AS review_count
      FROM products p
      JOIN users u ON u.id = p.farmer_id
      JOIN categories c ON c.id = p.category_id
      LEFT JOIN (
        SELECT product_id, AVG(rating) AS rev_avg, COUNT(*) AS rev_count
          FROM reviews GROUP BY product_id
      ) r ON r.product_id = p.id
  `;
}

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    photo: row.photo || '',
    price: row.price,
    unit: row.unit,
    quantity: row.quantity,
    harvestDate: row.harvest_date,
    freshness: row.freshness,
    location: row.location || row.farmer_location || '',
    status: row.status,
    createdAt: row.created_at,
    category: { id: row.category_id, name: row.category_name },
    farmer: {
      id: row.farmer_id,
      name: row.farmer_name,
      location: row.farmer_location,
      phone: row.farmer_phone,
      bio: row.farmer_bio,
    },
    averageRating: Math.round((row.avg_rating || 0) * 10) / 10,
    reviewCount: row.review_count || 0,
  };
}

function validProductInput(body) {
  const name = sanitizeString(body.name, 120);
  const description = sanitizeString(body.description, 2000);
  const photo = sanitizeString(body.photo, 2000000);
  const categoryId = num(body.categoryId, NaN);
  const price = num(body.price, NaN);
  const unit = sanitizeString(body.unit, 20);
  const quantity = num(body.quantity, NaN);
  const harvestDate = sanitizeString(body.harvestDate, 20);
  const freshness = sanitizeString(body.freshness, 200);
  const location = sanitizeString(body.location, 120);

  if (!name || name.length < 2) return { error: 'Please enter a product name.' };
  if (!Number.isInteger(categoryId)) return { error: 'Please choose a category.' };
  if (!Number.isFinite(price) || price <= 0) return { error: 'Please enter a valid price.' };
  if (!unit) return { error: 'Please choose a unit.' };
  if (!Number.isFinite(quantity) || quantity < 0) return { error: 'Please enter a valid quantity.' };
  if (harvestDate && !/^\d{4}-\d{2}-\d{2}$/.test(harvestDate)) {
    return { error: 'Please enter a valid harvest date.' };
  }

  const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!category) return { error: 'Please choose a valid category.' };

  return {
    data: { name, description, photo, categoryId, price, unit, quantity, harvestDate, freshness, location },
  };
}

// Public marketplace
router.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT id, name, slug FROM categories ORDER BY name').all();
  res.json({ categories: rows });
});

router.get('/products', (req, res) => {
  const q = sanitizeString(req.query.q, 120);
  const category = num(req.query.category, NaN);
  const minPrice = num(req.query.minPrice, NaN);
  const maxPrice = num(req.query.maxPrice, NaN);
  const location = sanitizeString(req.query.location, 120);
  const farmer = num(req.query.farmer, NaN);
  const sort = sanitizeString(req.query.sort, 30);

  const clauses = ["p.status = 'approved'"];
  const params = [];

  if (q) {
    clauses.push('(p.name LIKE ? OR p.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (Number.isInteger(category)) {
    clauses.push('p.category_id = ?');
    params.push(category);
  }
  if (Number.isFinite(minPrice)) {
    clauses.push('p.price >= ?');
    params.push(minPrice);
  }
  if (Number.isFinite(maxPrice)) {
    clauses.push('p.price <= ?');
    params.push(maxPrice);
  }
  if (location) {
    clauses.push('(u.location LIKE ? OR p.location LIKE ?)');
    params.push(`%${location}%`, `%${location}%`);
  }
  if (Number.isInteger(farmer)) {
    clauses.push('p.farmer_id = ?');
    params.push(farmer);
  }

  let orderBy = 'p.created_at DESC';
  if (sort === 'price_asc') orderBy = 'p.price ASC';
  if (sort === 'price_desc') orderBy = 'p.price DESC';
  if (sort === 'name') orderBy = 'p.name ASC';

  const rows = db
    .prepare(`${productSelect()} WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy}`)
    .all(...params);

  res.json({ products: rows.map(mapProduct), count: rows.length });
});

router.get('/products/:id', (req, res) => {
  const row = db
    .prepare(`${productSelect()} WHERE p.id = ?`)
    .get(num(req.params.id, NaN));
  if (!row) {
    return res.status(404).json({ error: 'Product not found.' });
  }
  res.json({ product: mapProduct(row) });
});

router.get('/products/:id/compare', (req, res) => {
  const id = num(req.params.id, NaN);
  const row = db.prepare(`${productSelect()} WHERE p.id = ?`).get(id);
  if (!row) {
    return res.status(404).json({ error: 'Product not found.' });
  }

  const nameMatch = normalizeName(row.name);
  const sameName = db
    .prepare(
      `${productSelect()} WHERE p.id != ? AND p.status = 'approved' AND lower(p.name) = lower(?)`
    )
    .all(id, row.name)
    .map(mapProduct);

  const alternatives = [];
  if (sameName.length === 0) {
    const cats = db
      .prepare(
        `${productSelect()} WHERE p.id != ? AND p.status = 'approved' AND p.category_id = ? ORDER BY p.price ASC LIMIT 5`
      )
      .all(id, row.category_id)
      .map(mapProduct);
    alternatives.push(...cats);
  } else {
    alternatives.push(...sameName);
  }

  const allPrices = [
    { name: row.name, price: row.price, farmer: row.farmer_name },
    ...alternatives.map((a) => ({ name: a.name, price: a.price, farmer: a.farmer.name })),
  ];
  const cheapest = allPrices.reduce((best, cur) => (cur.price < best.price ? cur : best), allPrices[0]);

  res.json({ product: mapProduct(row), alternatives, cheapest });
});

router.get('/farmers', (req, res) => {
  const q = sanitizeString(req.query.q, 120);
  const params = [];
  let where = "u.role = 'farmer' AND u.status = 'active'";
  if (q) {
    where += ' AND (u.location LIKE ? OR u.name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.location, u.phone, u.bio,
              (SELECT COUNT(*) FROM products p WHERE p.farmer_id = u.id AND p.status = 'approved') AS product_count
         FROM users u
        WHERE ${where}
        ORDER BY u.name`
    )
    .all(...params);
  res.json({ farmers: rows });
});

// Farmer product management
router.get('/farmer/products', requireAuth, requireRole('farmer'), (req, res) => {
  const rows = db
    .prepare(`${productSelect()} WHERE p.farmer_id = ? ORDER BY p.created_at DESC`)
    .all(req.user.id);
  res.json({ products: rows.map(mapProduct) });
});

router.post('/farmer/products', requireAuth, requireRole('farmer'), (req, res) => {
  const check = validProductInput(req.body || {});
  if (check.error) return res.status(400).json({ error: check.error });
  const d = check.data;
  const result = db
    .prepare(
      `INSERT INTO products (farmer_id, category_id, name, description, photo, price, unit, quantity, harvest_date, freshness, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, d.categoryId, d.name, d.description, d.photo, d.price, d.unit, d.quantity, d.harvestDate, d.freshness, d.location || req.user.location);
  const row = db.prepare(`${productSelect()} WHERE p.id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ message: 'Product added. It will be visible to buyers once verified.', product: mapProduct(row) });
});

router.put('/farmer/products/:id', requireAuth, requireRole('farmer'), (req, res) => {
  const id = num(req.params.id, NaN);
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const check = validProductInput(req.body || {});
  if (check.error) return res.status(400).json({ error: check.error });
  const d = check.data;

  db.prepare(
    `UPDATE products
        SET category_id = ?, name = ?, description = ?, photo = ?, price = ?, unit = ?,
            quantity = ?, harvest_date = ?, freshness = ?, location = ?
      WHERE id = ?`
  ).run(d.categoryId, d.name, d.description, d.photo, d.price, d.unit, d.quantity, d.harvestDate, d.freshness, d.location || existing.location, id);

  const row = db.prepare(`${productSelect()} WHERE p.id = ?`).get(id);
  res.json({ message: 'Product updated.', product: mapProduct(row) });
});

router.patch('/farmer/products/:id/stock', requireAuth, requireRole('farmer'), (req, res) => {
  const id = num(req.params.id, NaN);
  const existing = db.prepare('SELECT * FROM products WHERE id = ? AND farmer_id = ?').get(id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const quantity = num(req.body && req.body.quantity, NaN);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return res.status(400).json({ error: 'Please enter a valid quantity.' });
  }
  db.prepare('UPDATE products SET quantity = ? WHERE id = ?').run(quantity, id);
  const row = db.prepare(`${productSelect()} WHERE p.id = ?`).get(id);
  res.json({ message: 'Stock updated.', product: mapProduct(row) });
});

router.delete('/farmer/products/:id', requireAuth, requireRole('farmer'), (req, res) => {
  const id = num(req.params.id, NaN);
  const result = db.prepare('DELETE FROM products WHERE id = ? AND farmer_id = ?').run(id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Product not found.' });
  res.json({ message: 'Product deleted.' });
});

module.exports = router;
