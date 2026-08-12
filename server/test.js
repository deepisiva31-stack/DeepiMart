process.env.DB_PATH = './data/test.db';
process.env.PORT = '3999';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(process.cwd(), process.env.DB_PATH);
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  try {
    fs.rmSync(dbPath + suffix, { force: true });
  } catch {}
}

const db = require('./db');
require('./index');

const BASE = 'http://localhost:3999';
let failures = 0;

async function post(url, body) {
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

function check(name, cond) {
  if (cond) {
    console.log('PASS', name);
  } else {
    failures++;
    console.log('FAIL', name);
  }
}

async function main() {
  const farmer = await post('/api/auth/register', {
    name: 'Asha',
    email: 'asha@example.com',
    password: 'secret123',
    role: 'farmer',
  });
  check('register valid farmer returns 201', farmer.status === 201);
  check('register response has user email', farmer.json.user && farmer.json.user.email === 'asha@example.com');
  check('register response has role', farmer.json.user && farmer.json.user.role === 'farmer');
  check(
    'register response NEVER contains password',
    !JSON.stringify(farmer.json).match(/"password/i) && !('password' in farmer.json.user)
  );

  const dup = await post('/api/auth/register', {
    name: 'Asha2',
    email: 'asha@example.com',
    password: 'secret123',
    role: 'buyer',
  });
  check('duplicate email returns 409', dup.status === 409);
  check('duplicate email message', dup.json.error === 'Email already registered.');

  const badEmail = await post('/api/auth/register', {
    name: 'Bob',
    email: 'not-an-email',
    password: 'secret123',
    role: 'farmer',
  });
  check('invalid email returns 400', badEmail.status === 400);
  check('invalid email message', badEmail.json.error === 'Please enter a valid email address.');

  const badRole = await post('/api/auth/register', {
    name: 'Bob',
    email: 'bob@example.com',
    password: 'secret123',
    role: 'admin',
  });
  check('invalid role rejected', badRole.status === 400);

  const buyer = await post('/api/auth/register', {
    name: ' Kofi ',
    email: '  KOFI@Example.com ',
    password: 'secret456',
    role: 'buyer',
  });
  check('register buyer returns 201', buyer.status === 201);
  check('name and email sanitized', buyer.json.user.name === 'Kofi' && buyer.json.user.email === 'kofi@example.com');

  const ok = await post('/api/auth/login', { email: 'asha@example.com', password: 'secret123' });
  check('login correct credentials returns 200', ok.status === 200);
  check('login response NEVER contains password', !('password' in ok.json.user) && !('password_hash' in ok.json.user));

  const wrong = await post('/api/auth/login', { email: 'asha@example.com', password: 'wrongpass' });
  check('login wrong password returns 401', wrong.status === 401);
  check('login wrong password message', wrong.json.error === 'Invalid email or password.');

  const unknown = await post('/api/auth/login', { email: 'nobody@example.com', password: 'secret123' });
  check('login unknown email returns 401', unknown.status === 401);
  check('login unknown email message', unknown.json.error === 'Invalid email or password.');

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get('asha@example.com');
  check('password stored as bcrypt hash', typeof row.password_hash === 'string' && row.password_hash.startsWith('$2'));
  check('stored hash is not plaintext', row.password_hash !== 'secret123');
  check('stored hash length >= 60', row.password_hash.length >= 60);

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  check('two users stored in DB', count === 2);

  db.close();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {}
  }

  console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
