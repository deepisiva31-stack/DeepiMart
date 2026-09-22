const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(process.cwd(), process.env.DB_PATH || './data/deepimart.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

function tableColumns(name) {
  return db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
}

const hasUsers = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
  .get();

let migrated = false;
if (hasUsers && !tableColumns('users').includes('location')) {
  db.exec(`ALTER TABLE users RENAME TO users_legacy;`);
  migrated = true;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('farmer', 'buyer', 'admin')),
    phone         TEXT    NOT NULL DEFAULT '',
    location      TEXT    NOT NULL DEFAULT '',
    bio           TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    farmer_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id  INTEGER NOT NULL REFERENCES categories(id),
    name         TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    photo        TEXT    NOT NULL DEFAULT '',
    price        REAL    NOT NULL,
    unit         TEXT    NOT NULL DEFAULT 'kg',
    quantity     REAL    NOT NULL DEFAULT 0,
    harvest_date TEXT    NOT NULL DEFAULT '',
    freshness    TEXT    NOT NULL DEFAULT '',
    location     TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity   REAL    NOT NULL DEFAULT 1,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (buyer_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code        TEXT    NOT NULL UNIQUE,
    buyer_id          INTEGER NOT NULL REFERENCES users(id),
    farmer_id         INTEGER NOT NULL REFERENCES users(id),
    total             REAL    NOT NULL,
    status            TEXT    NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'accepted', 'rejected', 'completed', 'cancelled')),
    payment_status    TEXT    NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'refunded', 'failed')),
    delivery_address  TEXT    NOT NULL DEFAULT '',
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id   INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT    NOT NULL,
    unit_price   REAL    NOT NULL,
    quantity     REAL    NOT NULL,
    subtotal     REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id),
    buyer_id   INTEGER NOT NULL REFERENCES users(id),
    amount     REAL    NOT NULL,
    method     TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'pending',
    reference  TEXT    NOT NULL UNIQUE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id           INTEGER NOT NULL UNIQUE REFERENCES orders(id),
    tracking_code      TEXT    NOT NULL UNIQUE,
    carrier            TEXT    NOT NULL,
    status             TEXT    NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'in_transit', 'out_for_delivery', 'delivered')),
    current_location   TEXT    NOT NULL DEFAULT '',
    estimated_delivery TEXT    NOT NULL DEFAULT '',
    history            TEXT    NOT NULL DEFAULT '[]',
    created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL REFERENCES users(id),
    receiver_id INTEGER NOT NULL REFERENCES users(id),
    body        TEXT    NOT NULL,
    read        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wishlist_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (buyer_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rating     INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    body       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (buyer_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT    NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otp_requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT    NOT NULL,
    purpose    TEXT    NOT NULL DEFAULT 'register',
    code_hash  TEXT    NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    reg_token  TEXT    NOT NULL DEFAULT '',
    used       INTEGER NOT NULL DEFAULT 0,
    ip         TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL,
    verified_at TEXT
  );
`);

if (migrated) {
  db.exec(`
    INSERT INTO users (id, name, email, password_hash, role, created_at)
      SELECT id, name, email, password_hash, role, created_at FROM users_legacy;
    DROP TABLE users_legacy;
  `);
}

module.exports = db;
