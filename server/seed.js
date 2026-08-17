const bcrypt = require('bcryptjs');
const db = require('./db');

function insertUser(name, email, password, role, phone, location, bio) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const hash = bcrypt.hashSync(password, 12);
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash, role, phone, location, bio) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, email, hash, role, phone, location, bio);
  return result.lastInsertRowid;
}

function ensureCategory(name, slug) {
  const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
  if (existing) return existing.id;
  const result = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name, slug);
  return result.lastInsertRowid;
}

function ensureProduct(farmerId, categoryId, name, description, photo, price, unit, quantity, harvestDate, freshness, location, status) {
  const existing = db
    .prepare('SELECT id FROM products WHERE name = ? AND farmer_id = ?')
    .get(name, farmerId);
  if (existing) return existing.id;
  const result = db
    .prepare(
      `INSERT INTO products (farmer_id, category_id, name, description, photo, price, unit, quantity, harvest_date, freshness, location, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(farmerId, categoryId, name, description, photo, price, unit, quantity, harvestDate, freshness, location, status);
  return result.lastInsertRowid;
}

function seed() {
  const cat = {};
  cat.vegetables = ensureCategory('Vegetables', 'vegetables');
  cat.fruits = ensureCategory('Fruits', 'fruits');
  cat.grains = ensureCategory('Grains & Cereals', 'grains-cereals');
  cat.dairy = ensureCategory('Dairy', 'dairy');
  cat.meat = ensureCategory('Poultry & Meat', 'poultry-meat');
  cat.tubers = ensureCategory('Tubers & Roots', 'tubers-roots');

  const admin = insertUser('DeepiMart Admin', 'admin@deepimart.com', 'admin123', 'admin', '+256700000001', 'Kampala, Uganda', 'Marketplace administrator.');
  const farmer = insertUser(
    'Grace Nakato',
    'farmer@deepimart.com',
    'farmer123',
    'farmer',
    '+256772123456',
    'Kampala, Uganda',
    'Family farm growing vegetables and fruits since 2009.'
  );
  const farmer2 = insertUser(
    'James Ochieng',
    'farmer2@deepimart.com',
    'farmer123',
    'farmer',
    '+256701654321',
    'Masaka, Uganda',
    'Organic grains, tubers and poultry from Masaka.'
  );
  const buyer = insertUser('John Okello', 'buyer@deepimart.com', 'buyer123', 'buyer', '+256782987654', 'Kampala, Uganda', '');

  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const threeDays = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const fiveDays = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const tenDays = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const tomatoesId = ensureProduct(farmer, cat.vegetables, 'Fresh Tomatoes', 'Vine-ripened tomatoes, hand-picked daily.', '', 3000, 'kg', 120, yesterday, 'Harvested this morning.', 'Kampala', 'approved');
  const cabbageId = ensureProduct(farmer, cat.vegetables, 'Green Cabbage', 'Crisp green cabbage heads, high quality.', '', 1500, 'piece', 80, threeDays, 'Cool-stored after harvest.', 'Kampala', 'approved');
  ensureProduct(farmer, cat.fruits, 'Sweet Mangoes', 'Sun-ripened local mangoes.', '', 5000, 'kg', 60, threeDays, 'Picked at peak ripeness.', 'Kampala', 'approved');
  ensureProduct(farmer2, cat.grains, 'Organic Rice', 'Long-grain rice from Masaka wetlands.', '', 6500, 'kg', 400, tenDays, 'Freshly milled.', 'Masaka', 'approved');
  ensureProduct(farmer2, cat.tubers, 'Irish Potatoes', 'Clean, graded Irish potatoes.', '', 2500, 'kg', 300, fiveDays, 'Recently harvested.', 'Masaka', 'approved');
  ensureProduct(farmer2, cat.meat, 'Farm Eggs (Tray)', 'Free-range eggs, 30 per tray.', '', 12000, 'tray', 25, yesterday, 'Collected yesterday.', 'Masaka', 'approved');
  ensureProduct(farmer, cat.fruits, 'Bananas (Matooke)', 'Green cooking bananas, sturdy bunch.', '', 10000, 'bunch', 40, fiveDays, 'Fresh from the farm.', 'Kampala', 'pending');

  const orders = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  if (orders === 0) {
    const today = new Date().toISOString();
    const orderCode = 'ORD-SEED-' + Date.now().toString(36).toUpperCase();
    const oid = db
      .prepare(
        `INSERT INTO orders (order_code, buyer_id, farmer_id, total, status, payment_status, delivery_address, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'completed', 'paid', ?, ?, ?)`
      )
      .run(orderCode, buyer, farmer, 18000, 'Namugongo, Kampala', today, today).lastInsertRowid;

    db.prepare(
      'INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(oid, tomatoesId, 'Fresh Tomatoes', 3000, 4, 12000);
    db.prepare(
      'INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(oid, cabbageId, 'Green Cabbage', 1500, 4, 6000);

    db.prepare(
      `INSERT INTO payments (order_id, buyer_id, amount, method, status, reference, created_at)
       VALUES (?, ?, ?, 'card', 'paid', ?, ?)`
    ).run(oid, buyer, 18000, 'MOCK-SEED01', today);

    const history = JSON.stringify([
      { at: today, status: 'processing', text: 'Order placed.' },
      { at: today, status: 'in_transit', text: 'Picked up by DeepiMart Go.' },
      { at: today, status: 'delivered', text: 'Delivered to buyer.' },
    ]);
    db.prepare(
      `INSERT INTO deliveries (order_id, tracking_code, carrier, status, current_location, estimated_delivery, history, created_at)
       VALUES (?, ?, 'DeepiMart Go', 'delivered', 'Delivered to buyer', ?, ?, ?)`
    ).run(oid, 'DM-SEED01', today, history, today);
  }

  console.log('Seed data ready (demo accounts: admin@deepimart.com, farmer@deepimart.com, buyer@deepimart.com).');
}

module.exports = { seed };
