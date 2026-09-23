const express = require('express');
const crypto = require('node:crypto');
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

function makeOrderCode() {
  return 'ORD-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
}

function makeTrackingCode() {
  return 'DM-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function orderDetailQuery() {
  return `
    SELECT o.*,
           b.name AS buyer_name, b.email AS buyer_email, b.phone AS buyer_phone, b.location AS buyer_location,
           f.name AS farmer_name, f.phone AS farmer_phone, f.location AS farmer_location,
           d.tracking_code, d.carrier, d.status AS delivery_status, d.current_location,
           d.estimated_delivery, d.history AS delivery_history
      FROM orders o
      JOIN users b ON b.id = o.buyer_id
      JOIN users f ON f.id = o.farmer_id
      LEFT JOIN deliveries d ON d.order_id = o.id
  `;
}

function mapOrder(row) {
  const items = db
    .prepare('SELECT id, product_id, product_name, unit_price, quantity, subtotal FROM order_items WHERE order_id = ?')
    .all(row.id);
  const payment = db
    .prepare("SELECT method, status, reference, amount, created_at FROM payments WHERE order_id = ? ORDER BY id DESC")
    .get(row.id);
  let history = [];
  try {
    history = JSON.parse(row.delivery_history || '[]');
  } catch (e) {
    history = [];
  }
  return {
    id: row.id,
    orderCode: row.order_code,
    total: row.total,
    status: row.status,
    paymentStatus: row.payment_status,
    deliveryAddress: row.delivery_address,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    payment,
    buyer: { id: row.buyer_id, name: row.buyer_name, email: row.buyer_email, phone: row.buyer_phone, location: row.buyer_location },
    farmer: { id: row.farmer_id, name: row.farmer_name, phone: row.farmer_phone, location: row.farmer_location },
    delivery: row.tracking_code
      ? {
          trackingCode: row.tracking_code,
          carrier: row.carrier,
          status: row.delivery_status,
          currentLocation: row.current_location,
          estimatedDelivery: row.estimated_delivery,
          history,
        }
      : null,
  };
}

function canAccessOrder(user, order) {
  return user.role === 'admin' || user.id === order.buyer_id || user.id === order.farmer_id;
}

function orderDetailRow(orderId) {
  return db.prepare(`${orderDetailQuery()} WHERE o.id = ?`).get(orderId);
}

// ---- Cart ----
router.get('/cart', requireAuth, requireRole('buyer'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT ci.id AS cart_item_id, ci.quantity AS cart_quantity, ci.created_at,
              p.*, u.name AS farmer_name, u.location AS farmer_location, c.name AS category_name
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         JOIN users u ON u.id = p.farmer_id
         JOIN categories c ON c.id = p.category_id
        WHERE ci.buyer_id = ?
        ORDER BY ci.created_at DESC`
    )
    .all(req.user.id);

  const items = rows.map((r) => ({
    cartItemId: r.cart_item_id,
    productId: r.id,
    productName: r.name,
    photo: r.photo || '',
    price: r.price,
    unit: r.unit,
    available: r.quantity,
    quantity: r.cart_quantity,
    subtotal: r.price * r.cart_quantity,
    status: r.status,
    farmer: { id: r.farmer_id, name: r.farmer_name, location: r.farmer_location },
  }));
  const total = items.filter((i) => i.status === 'approved').reduce((sum, i) => sum + i.subtotal, 0);
  res.json({ items, total });
});

router.post('/cart', requireAuth, requireRole('buyer'), (req, res) => {
  const productId = num(req.body && req.body.productId, NaN);
  const quantity = num(req.body && req.body.quantity, 1);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product.' });
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Enter a valid quantity.' });

  const product = db.prepare("SELECT * FROM products WHERE id = ? AND status = 'approved'").get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  if (quantity > product.quantity) return res.status(400).json({ error: 'Only ' + product.quantity + ' ' + product.unit + ' available.' });

  db.prepare(
    `INSERT INTO cart_items (buyer_id, product_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(buyer_id, product_id) DO UPDATE SET quantity = MIN(quantity + excluded.quantity, (SELECT p.quantity FROM products p WHERE p.id = excluded.product_id))`
  ).run(req.user.id, productId, quantity);

  const row = db
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(quantity * (SELECT price FROM products WHERE id = product_id)), 0) AS total FROM cart_items WHERE buyer_id = ?')
    .get(req.user.id);
  res.status(201).json({ message: 'Added to cart.', cartCount: row.count, total: row.total });
});

router.put('/cart/:itemId', requireAuth, requireRole('buyer'), (req, res) => {
  const itemId = num(req.params.itemId, NaN);
  const quantity = num(req.body && req.body.quantity, NaN);
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Enter a valid quantity.' });

  const item = db
    .prepare('SELECT ci.*, p.quantity AS available FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.id = ? AND ci.buyer_id = ?')
    .get(itemId, req.user.id);
  if (!item) return res.status(404).json({ error: 'Cart item not found.' });
  if (quantity > item.available) return res.status(400).json({ error: 'Only ' + item.available + ' available.' });

  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(quantity, itemId);
  res.json({ message: 'Cart updated.' });
});

router.delete('/cart/:itemId', requireAuth, requireRole('buyer'), (req, res) => {
  const result = db.prepare('DELETE FROM cart_items WHERE id = ? AND buyer_id = ?').run(num(req.params.itemId, NaN), req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Cart item not found.' });
  res.json({ message: 'Removed from cart.' });
});

// ---- Orders ----
router.post('/orders', requireAuth, requireRole('buyer'), (req, res) => {
  const deliveryAddress = sanitizeString(req.body && req.body.deliveryAddress, 300);
  if (!deliveryAddress) return res.status(400).json({ error: 'Please enter a delivery address.' });

  // Payment method is chosen at checkout: "online" (instant, simulated) or
  // "cod" (cash on delivery). Anything else defaults to cash on delivery.
  const payMethod = sanitizeString(req.body && req.body.paymentMethod, 20) === 'online' ? 'online' : 'cod';

  const rows = db
    .prepare(
      `SELECT ci.id AS cart_item_id, ci.quantity, p.id AS product_id, p.farmer_id, p.price,
              p.quantity AS available, p.name, p.unit, p.status AS product_status
         FROM cart_items ci JOIN products p ON p.id = ci.product_id
        WHERE ci.buyer_id = ?`
    )
    .all(req.user.id);
  if (rows.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  const invalid = rows.find((r) => r.product_status !== 'approved');
  if (invalid) {
    return res.status(400).json({ error: `"${invalid.name}" is no longer available for purchase.` });
  }
  const outOfStock = rows.find((r) => r.quantity > r.available);
  if (outOfStock) {
    return res.status(400).json({ error: `Only ${outOfStock.available} ${outOfStock.unit} of "${outOfStock.name}" is available.` });
  }

  const byFarmer = {};
  for (const row of rows) {
    if (!byFarmer[row.farmer_id]) byFarmer[row.farmer_id] = [];
    byFarmer[row.farmer_id].push(row);
  }

  const created = [];
  db.exec('BEGIN');
  try {
    for (const [farmerId, group] of Object.entries(byFarmer)) {
      const total = group.reduce((sum, r) => sum + r.price * r.quantity, 0);
      const orderCode = makeOrderCode();
      const result = db
        .prepare('INSERT INTO orders (order_code, buyer_id, farmer_id, total, delivery_address) VALUES (?, ?, ?, ?, ?)')
        .run(orderCode, req.user.id, Number(farmerId), total, deliveryAddress);

      const insertItem = db.prepare(
        'INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const r of group) {
        insertItem.run(result.lastInsertRowid, r.product_id, r.name, r.price, r.quantity, r.price * r.quantity);
        db.prepare('UPDATE products SET quantity = quantity - ? WHERE id = ?').run(r.quantity, r.product_id);
      }

      const trackingCode = makeTrackingCode();
      const est = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const history = [
        {
          at: new Date().toISOString(),
          status: 'processing',
          text: `Order placed. Delivery partner assigned (${trackingCode}).`,
        },
      ];
      db.prepare(
        `INSERT INTO deliveries (order_id, tracking_code, carrier, status, current_location, estimated_delivery, history)
         VALUES (?, ?, ?, 'processing', 'Farm pickup', ?, ?)`
      ).run(result.lastInsertRowid, trackingCode, 'DeepiMart Go', est, JSON.stringify(history));

      // Record the chosen payment method up front. "online" is paid at
      // checkout (simulated); "cod" stays pending until goods are received.
      const payMethodName = payMethod === 'online' ? 'online' : 'cod';
      const payStatus = payMethod === 'online' ? 'paid' : 'pending';
      const payRef = (payMethod === 'online' ? 'MOCK-' : 'COD-') + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
      db.prepare(
        'INSERT INTO payments (order_id, buyer_id, amount, method, status, reference) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(result.lastInsertRowid, req.user.id, total, payMethodName, payStatus, payRef);
      if (payMethod === 'online') {
        db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(result.lastInsertRowid);
      }

      created.push(result.lastInsertRowid);
    }
    db.prepare('DELETE FROM cart_items WHERE buyer_id = ?').run(req.user.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('Order placement error:', err);
    return res.status(500).json({ error: 'Could not place the order. Please try again.' });
  }

  const orders = created.map((id) => mapOrder(orderDetailRow(id)));
  const message =
    payMethod === 'online'
      ? 'Orders placed and paid via online payment.'
      : 'Orders placed. Payment due on delivery (cash).';
  res.status(201).json({ message, orders });
});

router.get('/orders/buyer', requireAuth, requireRole('buyer'), (req, res) => {
  const rows = db.prepare(`${orderDetailQuery()} WHERE o.buyer_id = ? ORDER BY o.created_at DESC`).all(req.user.id);
  res.json({ orders: rows.map(mapOrder) });
});

router.get('/orders/farmer', requireAuth, requireRole('farmer'), (req, res) => {
  const rows = db.prepare(`${orderDetailQuery()} WHERE o.farmer_id = ? ORDER BY o.created_at DESC`).all(req.user.id);
  res.json({ orders: rows.map(mapOrder) });
});

router.get('/orders/:id', requireAuth, (req, res) => {
  const row = orderDetailRow(num(req.params.id, NaN));
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  if (!canAccessOrder(req.user, row)) return res.status(403).json({ error: 'You cannot view this order.' });
  res.json({ order: mapOrder(row) });
});

router.patch('/orders/:id', requireAuth, (req, res) => {
  const id = num(req.params.id, NaN);
  const action = sanitizeString(req.body && req.body.action, 20);
  const row = orderDetailRow(id);
  if (!row) return res.status(404).json({ error: 'Order not found.' });

  const order = mapOrder(row);
  const isFarmer = row.farmer_id === req.user.id;
  const isBuyer = row.buyer_id === req.user.id;

  if (action === 'accept') {
    if (!isFarmer) return res.status(403).json({ error: 'Only the farmer can do that.' });
    if (order.status !== 'placed') return res.status(400).json({ error: 'This order cannot be accepted.' });
    db.prepare("UPDATE orders SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(id);
    return res.json({ message: 'Order accepted.' });
  }

  if (action === 'reject') {
    if (!isFarmer) return res.status(403).json({ error: 'Only the farmer can do that.' });
    if (order.status !== 'placed') return res.status(400).json({ error: 'This order cannot be rejected.' });
    const newPayment = order.paymentStatus === 'paid' ? 'refunded' : order.paymentStatus;
    db.prepare("UPDATE orders SET status = 'rejected', payment_status = ?, updated_at = datetime('now') WHERE id = ?").run(newPayment, id);
    if (newPayment === 'refunded') {
      db.prepare("UPDATE payments SET status = 'refunded' WHERE order_id = ? AND status = 'paid'").run(id);
    }
    return res.json({ message: 'Order rejected.' + (newPayment === 'refunded' ? ' Payment refunded (demo).' : '') });
  }

  if (action === 'complete') {
    if (!isFarmer) return res.status(403).json({ error: 'Only the farmer can do that.' });
    if (order.status !== 'accepted') return res.status(400).json({ error: 'Only accepted orders can be completed.' });
    db.prepare("UPDATE orders SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(id);
    db.prepare("UPDATE deliveries SET status = 'delivered', current_location = 'Delivered to buyer' WHERE order_id = ?").run(id);
    return res.json({ message: 'Order marked as completed.' });
  }

  if (action === 'cancel') {
    if (!isBuyer) return res.status(403).json({ error: 'Only the buyer can cancel.' });
    if (order.status !== 'placed') return res.status(400).json({ error: 'This order cannot be cancelled.' });
    db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(id);
    for (const item of order.items) {
      db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?').run(item.quantity, item.product_id);
    }
    return res.json({ message: 'Order cancelled and stock restored.' });
  }

  return res.status(400).json({ error: 'Invalid action.' });
});

// ---- Mock payments ----
router.post('/payments/:orderId', requireAuth, requireRole('buyer'), (req, res) => {
  const orderId = num(req.params.orderId, NaN);
  const row = orderDetailRow(orderId);
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  if (row.buyer_id !== req.user.id) return res.status(403).json({ error: 'This is not your order.' });
  if (row.payment_status === 'paid') return res.status(400).json({ error: 'This order is already paid.' });
  if (row.status !== 'placed') return res.status(400).json({ error: 'This order is not eligible for payment.' });

  const method = sanitizeString(req.body && req.body.method, 20);
  const details = (req.body && req.body.details) || {};

  // Cash on delivery: no payment taken now, order stays pending.
  if (method === 'cod') {
    const reference = 'COD-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
    db.prepare('INSERT INTO payments (order_id, buyer_id, amount, method, status, reference) VALUES (?, ?, ?, ?, ?, ?)').run(
      orderId,
      req.user.id,
      row.total,
      'cod',
      'pending',
      reference
    );
    return res.status(201).json({
      message: 'Cash on delivery selected. Pay when you receive the order.',
      payment: { reference, method: 'cod', amount: row.total, status: 'pending' },
    });
  }

  // Online payment: instant (simulated) settlement.

  if (method === 'online') {
    // Supersede any pending cash-on-delivery arrangement.
    db.prepare("UPDATE payments SET status = 'cancelled' WHERE order_id = ? AND method = 'cod' AND status = 'pending'").run(orderId);
    const reference = 'MOCK-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
    db.prepare('INSERT INTO payments (order_id, buyer_id, amount, method, status, reference) VALUES (?, ?, ?, ?, ?, ?)').run(
      orderId,
      req.user.id,
      row.total,
      'online',
      'paid',
      reference
    );
    db.prepare("UPDATE orders SET payment_status = 'paid', updated_at = datetime('now') WHERE id = ?").run(orderId);
    return res.status(201).json({
      message: 'Online payment successful (simulated).',
      payment: { reference, method: 'online', amount: row.total, status: 'paid' },
    });
  }

  if (method !== 'card' && method !== 'mobile_money') {
    return res.status(400).json({ error: 'Please choose a payment method.' });
  }

  if (method === 'card') {
    const number = String(details.number || '').replace(/\s+/g, '');
    const expiry = String(details.expiry || '');
    const name = sanitizeString(details.name, 100);
    if (!/^\d{16}$/.test(number)) {
      return res.status(400).json({ error: 'Card number must be 16 digits (demo: 4242 4242 4242 4242).' });
    }
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) {
      return res.status(400).json({ error: 'Expiry must be in MM/YY format.' });
    }
    if (!name) return res.status(400).json({ error: 'Please enter the name on the card.' });
  } else if (method === 'mobile_money') {
    const phone = String(details.phone || '').replace(/[^0-9]/g, '');
    if (phone.length < 9 || phone.length > 15) {
      return res.status(400).json({ error: 'Please enter a valid phone number.' });
    }
  } else {
    return res.status(400).json({ error: 'Please choose a payment method.' });
  }

  // A real payment supersedes a pending cash-on-delivery arrangement.
  db.prepare("UPDATE payments SET status = 'cancelled' WHERE order_id = ? AND method = 'cod' AND status = 'pending'").run(orderId);

  const reference = 'MOCK-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
  db.prepare('INSERT INTO payments (order_id, buyer_id, amount, method, status, reference) VALUES (?, ?, ?, ?, ?, ?)').run(
    orderId,
    req.user.id,
    row.total,
    method,
    'paid',
    reference
  );
  db.prepare("UPDATE orders SET payment_status = 'paid', updated_at = datetime('now') WHERE id = ?").run(orderId);

  res.status(201).json({
    message: 'Payment successful (demo mock gateway - no real money moved).',
    payment: { reference, method, amount: row.total, status: 'paid' },
  });
});

// ---- Delivery tracking ----
const DELIVERY_STEPS = ['processing', 'in_transit', 'out_for_delivery', 'delivered'];

router.get('/deliveries/:orderId', requireAuth, (req, res) => {
  const row = orderDetailRow(num(req.params.orderId, NaN));
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  if (!canAccessOrder(req.user, row)) return res.status(403).json({ error: 'You cannot view this delivery.' });
  res.json({ delivery: mapOrder(row).delivery });
});

router.post('/deliveries/:orderId/advance', requireAuth, (req, res) => {
  const row = orderDetailRow(num(req.params.orderId, NaN));
  if (!row) return res.status(404).json({ error: 'Order not found.' });
  if (!canAccessOrder(req.user, row)) return res.status(403).json({ error: 'You cannot update this delivery.' });

  const delivery = db.prepare('SELECT * FROM deliveries WHERE order_id = ?').get(row.id);
  if (!delivery) return res.status(404).json({ error: 'No delivery record yet.' });
  if (delivery.status === 'delivered') return res.status(400).json({ error: 'Delivery already completed.' });

  const idx = DELIVERY_STEPS.indexOf(delivery.status);
  const nextStatus = DELIVERY_STEPS[idx + 1];
  const locations = {
    in_transit: 'In transit - regional hub',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered to buyer',
  };
  let history = [];
  try {
    history = JSON.parse(delivery.history);
  } catch (e) {
    history = [];
  }
  history.push({
    at: new Date().toISOString(),
    status: nextStatus,
    text: `Tracking updated to "${nextStatus.replace(/_/g, ' ')}".`,
  });

  db.prepare(
    `UPDATE deliveries SET status = ?, current_location = ?, history = ? WHERE id = ?`
  ).run(nextStatus, locations[nextStatus] || delivery.current_location, JSON.stringify(history), delivery.id);

  if (nextStatus === 'delivered') {
    db.prepare("UPDATE orders SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(row.id);
    // Cash on delivery is settled when the goods arrive.
    const codPay = db
      .prepare("SELECT id FROM payments WHERE order_id = ? AND method = 'cod' AND status = 'pending' ORDER BY id DESC LIMIT 1")
      .get(row.id);
    if (codPay) {
      db.prepare("UPDATE payments SET status = 'paid' WHERE id = ?").run(codPay.id);
      db.prepare("UPDATE orders SET payment_status = 'paid', updated_at = datetime('now') WHERE id = ?").run(row.id);
    }
  }

  const updated = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(delivery.id);
  let hist = [];
  try {
    hist = JSON.parse(updated.history);
  } catch (e) {}
  res.json({
    message: 'Delivery advanced (demo simulation).',
    delivery: {
      trackingCode: updated.tracking_code,
      carrier: updated.carrier,
      status: updated.status,
      currentLocation: updated.current_location,
      estimatedDelivery: updated.estimated_delivery,
      history: hist,
    },
  });
});

// ---- Wishlist ----
router.get('/wishlist', requireAuth, requireRole('buyer'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT wi.id AS wishlist_item_id, wi.created_at,
              p.*, u.name AS farmer_name, u.location AS farmer_location, c.name AS category_name
         FROM wishlist_items wi
         JOIN products p ON p.id = wi.product_id
         JOIN users u ON u.id = p.farmer_id
         JOIN categories c ON c.id = p.category_id
        WHERE wi.buyer_id = ?
        ORDER BY wi.created_at DESC`
    )
    .all(req.user.id);

  const items = rows.map((r) => ({
    wishlistItemId: r.wishlist_item_id,
    productId: r.id,
    productName: r.name,
    photo: r.photo || '',
    price: r.price,
    unit: r.unit,
    available: r.quantity,
    status: r.status,
    farmer: { id: r.farmer_id, name: r.farmer_name, location: r.farmer_location },
    addedAt: r.created_at,
  }));
  res.json({ items });
});

router.post('/wishlist', requireAuth, requireRole('buyer'), (req, res) => {
  const productId = num(req.body && req.body.productId, NaN);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product.' });

  const product = db.prepare("SELECT * FROM products WHERE id = ? AND status = 'approved'").get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  const existing = db.prepare('SELECT id FROM wishlist_items WHERE buyer_id = ? AND product_id = ?').get(req.user.id, productId);
  if (existing) return res.status(409).json({ error: 'Already in your wishlist.' });

  db.prepare('INSERT INTO wishlist_items (buyer_id, product_id) VALUES (?, ?)').run(req.user.id, productId);
  res.status(201).json({ message: 'Added to wishlist.', wishlisted: true });
});

router.delete('/wishlist/:productId', requireAuth, requireRole('buyer'), (req, res) => {
  const productId = num(req.params.productId, NaN);
  const result = db.prepare('DELETE FROM wishlist_items WHERE buyer_id = ? AND product_id = ?').run(req.user.id, productId);
  if (result.changes === 0) return res.status(404).json({ error: 'Not in your wishlist.' });
  res.json({ message: 'Removed from wishlist.', wishlisted: false });
});

router.get('/wishlist/check/:productId', requireAuth, requireRole('buyer'), (req, res) => {
  const productId = num(req.params.productId, NaN);
  const found = db.prepare('SELECT id FROM wishlist_items WHERE buyer_id = ? AND product_id = ?').get(req.user.id, productId);
  res.json({ wishlisted: !!found });
});

// ---- Reviews ----
router.get('/products/:id/reviews', (req, res) => {
  const productId = num(req.params.id, NaN);
  const product = db.prepare("SELECT id FROM products WHERE id = ? AND status = 'approved'").get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  const rows = db
    .prepare(
      `SELECT r.*, u.name AS reviewer_name
         FROM reviews r
         JOIN users u ON u.id = r.buyer_id
        WHERE r.product_id = ?
        ORDER BY r.created_at DESC`
    )
    .all(productId);

  const summary = db
    .prepare('SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS avg FROM reviews WHERE product_id = ?')
    .get(productId);

  const distribution = [0, 0, 0, 0, 0];
  rows.forEach(function (r) {
    distribution[r.rating - 1]++;
  });

  res.json({
    reviews: rows.map(function (r) {
      return {
        id: r.id,
        rating: r.rating,
        body: r.body,
        reviewerName: r.reviewer_name,
        createdAt: r.created_at,
      };
    }),
    averageRating: Math.round(summary.avg * 10) / 10,
    totalCount: summary.count,
    distribution,
  });
});

router.post('/reviews', requireAuth, requireRole('buyer'), (req, res) => {
  const productId = num(req.body && req.body.productId, NaN);
  const orderId = num(req.body && req.body.orderId, NaN);
  const rating = num(req.body && req.body.rating, NaN);
  const body = sanitizeString(req.body && req.body.body, 2000);

  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product.' });
  if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'Invalid order.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  if (!body || body.length < 5) return res.status(400).json({ error: 'Review must be at least 5 characters.' });

  const product = db.prepare("SELECT id FROM products WHERE id = ? AND status = 'approved'").get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(orderId, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.status !== 'completed') return res.status(400).json({ error: 'You can only review products from completed orders.' });

  const orderItem = db.prepare('SELECT id FROM order_items WHERE order_id = ? AND product_id = ?').get(orderId, productId);
  if (!orderItem) return res.status(400).json({ error: 'This product was not part of the specified order.' });

  const existing = db.prepare('SELECT id FROM reviews WHERE buyer_id = ? AND product_id = ?').get(req.user.id, productId);
  if (existing) return res.status(409).json({ error: 'You have already reviewed this product.' });

  db.prepare('INSERT INTO reviews (buyer_id, product_id, order_id, rating, body) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, productId, orderId, rating, body
  );

  const summary = db
    .prepare('SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS avg FROM reviews WHERE product_id = ?')
    .get(productId);

  res.status(201).json({
    message: 'Review submitted.',
    averageRating: Math.round(summary.avg * 10) / 10,
    totalCount: summary.count,
  });
});

router.get('/reviews/mine', requireAuth, requireRole('buyer'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, p.name AS product_name, p.photo AS product_photo
         FROM reviews r
         JOIN products p ON p.id = r.product_id
        WHERE r.buyer_id = ?
        ORDER BY r.created_at DESC`
    )
    .all(req.user.id);

  res.json({
    reviews: rows.map(function (r) {
      return {
        id: r.id,
        rating: r.rating,
        body: r.body,
        productName: r.product_name,
        productPhoto: r.product_photo || '',
        productId: r.product_id,
        createdAt: r.created_at,
      };
    }),
  });
});

router.delete('/reviews/:id', requireAuth, requireRole('buyer'), (req, res) => {
  const id = num(req.params.id, NaN);
  const result = db.prepare('DELETE FROM reviews WHERE id = ? AND buyer_id = ?').run(id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Review not found.' });
  res.json({ message: 'Review deleted.' });
});

module.exports = router;
