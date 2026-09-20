const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 3011;
const DB_PATH = path.resolve(process.cwd(), './data/ui.db');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

for (const suffix of ['', '-journal', '-wal', '-shm']) {
  try {
    fs.rmSync(DB_PATH + suffix, { force: true });
  } catch {}
}

const server = spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), DB_PATH: './data/ui.db' },
  stdio: 'pipe',
});
server.stdout.on('data', (d) => process.stdout.write('[server] ' + d.toString()));

let failures = 0;
let lastStep = 'startup';
let errors = [];
const t0 = Date.now();

function step(name) {
  lastStep = name;
  console.log('  > step: ' + name + ' (' + Math.round((Date.now() - t0) / 1000) + 's)');
}

function check(name, cond) {
  if (cond) console.log('PASS', name);
  else {
    failures++;
    console.log('FAIL', name);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://localhost:' + PORT + '/api/health');
      if (res.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error('server did not become ready');
}

async function main() {
  await waitForServer();
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'],
  });

  const page = await browser.newPage();
  global.page = page;
  page.setDefaultTimeout(12000);
  errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) errors.push('HTTP ' + r.status() + ' ' + r.url().replace(base, ''));
  });

  const base = 'http://localhost:' + PORT;

  async function click(selector) {
    await page.waitForSelector(selector);
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
    }, selector);
  }

  async function setValue(selector, value) {
    await page.waitForSelector(selector);
    await page.evaluate(
      (sel, v) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      selector,
      value
    );
  }

  async function login(email, password) {
    step('login ' + email);
    await page.goto(base + '/#/login', { waitUntil: 'load', timeout: 15000 });
    await page.waitForSelector('#auth-view:not(.hidden)');
    await setValue('#login-email', email);
    await setValue('#login-password', password);
    await click('#login-submit');
  }

  async function logout() {
    step('logout');
    await click('#logout-btn');
    await page.waitForSelector('#auth-view:not(.hidden)');
  }

  function goto(hash) {
    return page.evaluate((h) => {
      window.location.hash = h;
    }, hash);
  }

  // ===== Farmer flow =====
  await login('farmer@deepimart.com', 'farmer123');
  await page.waitForFunction(() => window.location.hash.indexOf('#/farmer/overview') === 0, { timeout: 8000 });
  await page.waitForSelector('.page-head h2');
  const farmerTitle = await page.$eval('.page-head h2', (n) => n.textContent);
  check('farmer redirected to farmer dashboard', farmerTitle.indexOf('Farmer Dashboard') === 0);

  step('farmer products');
  await goto('#/farmer/products');
  await page.waitForSelector('.data-table tbody tr');
  const prodCount = await page.$$eval('.data-table tbody tr', (r) => r.length);
  check('farmer sees products table', prodCount >= 4);

  step('farmer add product');
  await goto('#/farmer/products/add');
  await page.waitForSelector('#product-form');
  await setValue('#product-name', 'UI Test Maize');
  await page.select('#product-category', '3');
  await setValue('#product-price', '2500');
  await page.select('#product-unit', 'kg');
  await setValue('#product-quantity', '100');
  const tmpImg = path.join(require('os').tmpdir(), 'ui-smoke-' + Date.now() + '.png');
  fs.writeFileSync(tmpImg, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const photoInput = await page.waitForSelector('#product-photo', { visible: false });
  await photoInput.uploadFile(tmpImg);
  await page.evaluate(() => {
    const el = document.getElementById('product-photo');
    if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => (document.getElementById('product-photo-preview').src || '').indexOf('blob:') === 0, { timeout: 8000 });
  await click('#product-form button[type="submit"]');
  await page.waitForFunction(() => window.location.hash === '#/farmer/products', { timeout: 8000 });
  fs.rmSync(tmpImg, { force: true });
  const addedPhoto = await page.evaluate(async () => {
    const r = await fetch('/api/farmer/products', { headers: { Authorization: 'Bearer ' + localStorage.getItem('dm_token') } });
    const d = await r.json();
    const p = d.products.find((x) => x.name === 'UI Test Maize');
    return p ? p.photo : '';
  });
  check('farmer can add a product', typeof addedPhoto === 'string' && addedPhoto !== '');
  check('farmer product saved with uploaded image', typeof addedPhoto === 'string' && addedPhoto.indexOf('/uploads/') === 0);
  let imgProdId = null;
  if (typeof addedPhoto === 'string' && addedPhoto.indexOf('/uploads/') === 0) {
    imgProdId = await page.evaluate(async () => {
      const r = await fetch('/api/farmer/products', { headers: { Authorization: 'Bearer ' + localStorage.getItem('dm_token') } });
      const d = await r.json();
      const p = d.products.find((x) => x.name === 'UI Test Maize');
      return p ? String(p.id) : null;
    });
    await page.evaluate(async (prodId) => {
      const lr = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@deepimart.com', password: 'admin123' }) });
      const ld = await lr.json();
      if (ld.token && prodId) {
        await fetch('/api/admin/products/' + prodId, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ld.token }, body: JSON.stringify({ status: 'approved' }) });
      }
    }, imgProdId);
  }

  step('farmer orders');
  await goto('#/farmer/orders');
  await page.waitForSelector('.page-head h2');
  check('farmer orders page loads', (await page.$eval('.page-head h2', (n) => n.textContent)) === 'Orders');

  step('farmer profile edit');
  await goto('#/profile');
  await page.waitForSelector('#pf-bio');
  await setValue('#pf-bio', 'Family farm updated via UI test.');
  await click('#view .btn-row .btn-primary');
  await page.waitForFunction(() => {
    const toasts = document.querySelectorAll('#toast-root .toast');
    for (const t of toasts) if (t.textContent.indexOf('Profile updated') !== -1) return true;
    return false;
  }, { timeout: 8000 });
  check('profile edit saves via UI', true);
  await page.waitForFunction(() => {
    const toasts = document.querySelectorAll('#toast-root .toast');
    for (const t of toasts) if (t.textContent.indexOf('Profile updated') !== -1) return false;
    return true;
  }, { timeout: 8000 });

  step('farmer settings password change');
  await goto('#/settings');
  await page.waitForSelector('#st-current');
  await setValue('#st-current', 'farmer123');
  await setValue('#st-new', 'farmer1234');
  await setValue('#st-confirm', 'farmer1234');
  await click('#view .btn-row .btn-primary');
  await page.waitForFunction(() => document.querySelector('#toast-root .toast') !== null, { timeout: 8000 });
  const pwToast = await page.evaluate(() => document.querySelector('#toast-root .toast').textContent);
  check('settings password change via UI', pwToast.indexOf('Password changed') !== -1);
  const pwToastCls = await page.evaluate(() => document.querySelector('#toast-root .toast').className);
  check('password change shows success toast', pwToastCls.indexOf('success') !== -1);
  await logout();

  // ===== Buyer flow =====
  await login('buyer@deepimart.com', 'buyer123');
  step('buyer market');
  await page.waitForFunction(() => window.location.hash.indexOf('#/buyer/market') === 0, { timeout: 8000 });
  await page.waitForSelector('.product-grid .product-card');
  const cards = await page.$$eval('.product-card', (els) => els.length);
  check('buyer marketplace lists products', cards >= 5);
  await sleep(500);
  const marketImg = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.product-card img')).some((im) => {
      const src = (im.currentSrc || im.getAttribute('src') || '').toString();
      return src.indexOf('/uploads/') !== -1;
    });
  });
  check('buyer marketplace shows product image', marketImg);
  if (imgProdId) {
    await goto('#/buyer/product/' + imgProdId);
    await page.waitForSelector('.pd-photo img');
    const detailImg = await page.evaluate(() => {
      const im = document.querySelector('.pd-photo img');
      return ((im.currentSrc || im.getAttribute('src') || '').toString()).indexOf('/uploads/') !== -1;
    });
    check('buyer product detail shows product image', detailImg);
    await goto('#/buyer/market');
    await page.waitForSelector('#mkt-q');
  }

  step('buyer search');
  await page.evaluate(() => {
    const el = document.getElementById('mkt-q');
    el.value = 'Tomatoes';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.product-card').length === 1, { timeout: 8000 });
  check('buyer can search products', true);

  step('buyer product detail');
  await click('.product-card a[href^="#/buyer/product/"]');
  await page.waitForFunction(() => window.location.hash.indexOf('#/buyer/product/') === 0, { timeout: 8000 });
  await page.waitForSelector('.pd-info h3');
  check('product detail loads', (await page.$eval('.pd-info h3', (n) => n.textContent)) === 'Fresh Tomatoes');
  await page.waitForSelector('.compare-note');
  check('price comparison section loads', true);

  step('buyer add to cart');
  await click('.pd-info .btn-primary');
  await page.waitForFunction(() => document.getElementById('nav-cart-badge').textContent === '1', { timeout: 8000 });
  check('add to cart updates badge', true);

  step('buyer cart');
  await goto('#/buyer/cart');
  await page.waitForSelector('.checkout-bar .btn-primary');
  check('cart shows checkout', true);

  step('buyer checkout + payment');
  await click('.checkout-bar .btn-primary');
  await page.waitForSelector('#co-address');
  await setValue('#co-address', 'UI Test Address, Kampala');
  await setValue('#co-card-name', 'TEST USER');
  await setValue('#co-card-number', '4242424242424242');
  await setValue('#co-card-expiry', '12/30');
  await click('.modal-foot .btn-primary');
  await page.waitForFunction(() => window.location.hash.indexOf('#/buyer/orders') === 0, { timeout: 15000 });
  await page.waitForSelector('.order-card');
  const paid = await page.evaluate(() => document.body.textContent.indexOf('Payment: paid') !== -1);
  check('buyer places + pays order (mock)', paid);

  step('buyer farmers');
  await goto('#/buyer/market');
  await page.waitForSelector('.product-card');
  await goto('#/buyer/farmers');
  await page.waitForSelector('.farmer-grid .farmer-card');
  check('location-based farmer search loads', true);

  step('buyer wishlist');
  await goto('#/buyer/market');
  await page.waitForSelector('.product-card .wishlist-btn');
  await click('.product-card .wishlist-btn');
  await page.waitForFunction(() => document.querySelector('.product-card .wishlist-btn').classList.contains('wishlisted'), { timeout: 8000 });
  check('wishlist toggle adds product', true);

  step('buyer wishlist page');
  await goto('#/buyer/wishlist');
  await page.waitForSelector('.product-card', { timeout: 5000 });
  const wlCards = await page.$$eval('.product-card', (els) => els.length);
  check('wishlist page shows items', wlCards >= 1);

  step('buyer wishlist remove');
  await page.waitForSelector('.product-card button.btn-ghost');
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.product-card button.btn-ghost');
    for (const btn of btns) { if (btn.textContent === 'Remove') { btn.click(); break; } }
  });
  await page.waitForFunction(() => document.body.textContent.indexOf('Your wishlist is empty') !== -1, { timeout: 6000 });
  check('wishlist remove empties list', true);

  step('buyer reviews');
  const buyerToken = await page.evaluate(() => localStorage.getItem('dm_token'));
  const buyerOrders = await (await fetch(base + '/api/orders/buyer', { headers: { Authorization: 'Bearer ' + buyerToken } })).json();
  const reviewOrder = buyerOrders.orders[0];
  if (reviewOrder && reviewOrder.delivery) {
    for (let i = 0; i < 3; i++) {
      await fetch(base + '/api/deliveries/' + reviewOrder.id + '/advance', { method: 'POST', headers: { Authorization: 'Bearer ' + buyerToken, 'Content-Type': 'application/json' } });
    }
  }

  step('buyer product detail reviews');
  await goto('#/buyer/market');
  await page.waitForSelector('.product-card');
  await click('.product-card a[href^="#/buyer/product/"]');
  await page.waitForFunction(() => window.location.hash.indexOf('#/buyer/product/') === 0, { timeout: 8000 });
  await page.waitForSelector('.review-form-section', { timeout: 5000 });
  check('product detail shows reviews section', true);

  step('buyer write review');
  await page.evaluate(() => {
    const labels = document.querySelectorAll('.star-input .star-label');
    if (labels.length >= 4) labels[3].click();
  });
  await page.evaluate(() => {
    const ta = document.getElementById('rv-body');
    if (ta) { ta.value = 'Great product, very fresh and delicious!'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await click('#review-form-section .btn-primary');
  await page.waitForFunction(() => document.querySelector('.review-card') !== null, { timeout: 8000 });
  check('review submitted and displayed', await page.evaluate(() => document.querySelector('.review-card') !== null));

  step('buyer my reviews page');
  await goto('#/buyer/reviews');
  await page.waitForSelector('.review-card', { timeout: 5000 });
  check('my reviews page shows reviews', true);

  await logout();

  // ===== Admin flow =====
  await login('admin@deepimart.com', 'admin123');
  step('admin overview');
  await page.waitForFunction(() => window.location.hash.indexOf('#/admin/overview') === 0, { timeout: 8000 });
  await page.waitForSelector('.stats-grid .stat-card');
  check('admin dashboard stats load', true);

  step('admin users');
  await goto('#/admin/users');
  await page.waitForSelector('.data-table tbody tr');
  check('admin manage users loads', true);

  step('admin products');
  await goto('#/admin/products');
  await page.waitForSelector('.data-table tbody tr');
  check('admin verify products loads', true);

  step('admin reports');
  await goto('#/admin/reports');
  await page.waitForSelector('.bar-chart');
  check('admin reports render charts', true);
  await logout();

  // ===== Mobile responsiveness =====
  step('mobile viewport');
  await page.setViewport({ width: 390, height: 844 });
  await login('buyer@deepimart.com', 'buyer123');
  await page.waitForSelector('.nav-toggle');
  check('mobile nav toggle visible', await page.$eval('.nav-toggle', (n) => getComputedStyle(n).display !== 'none'));

  const jsErrors = errors.filter((e) => !/net::/.test(e));
  check('no JS console/page errors', jsErrors.length === 0);
  if (jsErrors.length) console.log(jsErrors.slice(0, 5).join('\n'));

  await browser.close();
  server.kill();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(DB_PATH + suffix, { force: true });
    } catch {}
  }

  console.log(failures === 0 ? '\nUI SMOKE TEST PASSED' : '\n' + failures + ' UI TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAILED at step: ' + lastStep);
  console.error(err.message);
  if (global.page) {
    try {
      global.page
        .evaluate(() => {
          const t = document.querySelector('#toast-root .toast');
          const m = document.querySelector('#login-message');
          return 'toast: ' + (t ? t.textContent : '(none)') + ' | login-message: ' + (m ? m.textContent : '(none)');
        })
        .then((s) => console.error('URL: ' + global.page.url() + ' | ' + s));
    } catch (e) {}
  }
  console.error(errors.slice(0, 8).join('\n'));
  server.kill();
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(DB_PATH + suffix, { force: true });
    } catch {}
  }
  process.exit(1);
});
