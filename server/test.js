process.env.DB_PATH = './data/test.db';
process.env.PORT = '3999';
process.env.DISABLE_SEED = '1';

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.resolve(process.cwd(), process.env.DB_PATH);
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  try {
    fs.rmSync(dbPath + suffix, { force: true });
  } catch {}
}

const db = require('./db');
db.prepare("INSERT INTO categories (name, slug) VALUES ('Vegetables', 'vegetables')").run();
db.prepare("INSERT INTO categories (name, slug) VALUES ('Fruits', 'fruits')").run();
require('./index');

const BASE = 'http://localhost:3999';
let failures = 0;

async function post(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + url, { method: 'POST', headers, body: JSON.stringify(body) });
  let json = {};
  try {
    json = await res.json();
  } catch (e) {}
  return { status: res.status, json };
}

async function get(url, token) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + url, { headers });
  let json = {};
  try {
    json = await res.json();
  } catch (e) {}
  return { status: res.status, json };
}

async function patch(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + url, { method: 'PATCH', headers, body: JSON.stringify(body) });
  let json = {};
  try {
    json = await res.json();
  } catch (e) {}
  return { status: res.status, json };
}

async function del(url, token) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + url, { method: 'DELETE', headers });
  let json = {};
  try {
    json = await res.json();
  } catch (e) {}
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
  // --- Registration & validation (kept from before) ---
  const farmer = await post('/api/auth/register', { name: 'Asha', email: 'asha@example.com', password: 'secret123', role: 'farmer', location: 'Kampala' });
  check('register valid farmer returns 201', farmer.status === 201);
  check('register response has user email', farmer.json.user && farmer.json.user.email === 'asha@example.com');

  const dup = await post('/api/auth/register', { name: 'Asha2', email: 'asha@example.com', password: 'secret123', role: 'buyer' });
  check('duplicate email returns 409', dup.status === 409);
  check('duplicate email message', dup.json.error === 'Email already registered.');

  const badEmail = await post('/api/auth/register', { name: 'Bob', email: 'not-an-email', password: 'secret123', role: 'farmer' });
  check('invalid email returns 400', badEmail.status === 400);
  check('invalid email message', badEmail.json.error === 'Please enter a valid email address.');

  const badRole = await post('/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'secret123', role: 'admin' });
  check('admin role cannot self-register', badRole.status === 400);

  const buyer = await post('/api/auth/register', { name: 'Kofi', email: 'kofi@example.com', password: 'secret123', role: 'buyer' });
  check('register valid buyer returns 201', buyer.status === 201);

  const adminHash = bcrypt.hashSync('admin123', 12);
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run('Root', 'root@example.com', adminHash);

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get('asha@example.com');
  check('password stored as bcrypt hash', typeof row.password_hash === 'string' && row.password_hash.startsWith('$2') && row.password_hash.length >= 60);

  // --- Login + sessions ---
  const login = await post('/api/auth/login', { email: 'asha@example.com', password: 'secret123' });
  check('login correct credentials returns 200', login.status === 200);
  check('login returns token', typeof login.json.token === 'string' && login.json.token.length > 20);
  check('login response has role', login.json.user.role === 'farmer');
  const farmerTok = login.json.token;

  const wrong = await post('/api/auth/login', { email: 'asha@example.com', password: 'wrongpass' });
  check('login wrong password returns 401', wrong.status === 401);
  check('login wrong password message', wrong.json.error === 'Invalid email or password.');

  const buyerLogin = await post('/api/auth/login', { email: 'kofi@example.com', password: 'secret123' });
  const buyerTok = buyerLogin.json.token;
  const adminLogin = await post('/api/auth/login', { email: 'root@example.com', password: 'admin123' });
  const adminTok = adminLogin.json.token;

  const me = await get('/api/auth/me', farmerTok);
  check('/me returns authenticated user', me.status === 200 && me.json.user.email === 'asha@example.com');

  // --- Products ---
  const categories = await get('/api/categories');
  const catId = categories.json.categories[0].id;

  const create = await post('/api/farmer/products', { name: 'Test Tomatoes', description: 'Fresh', categoryId: catId, price: 5000, unit: 'kg', quantity: 50, harvestDate: '2026-08-01', freshness: 'Fresh', location: 'Kampala' }, farmerTok);
  check('farmer creates product', create.status === 201);
  check('new product starts pending', create.json.product.status === 'pending');
  const productId = create.json.product.id;

  const notFarmer = await post('/api/farmer/products', { name: 'X', categoryId: catId, price: 1, unit: 'kg', quantity: 1 }, buyerTok);
  check('buyer cannot create product', notFarmer.status === 403);

  const listApproved = await get('/api/products');
  check('pending product not listed publicly', !listApproved.json.products.some((p) => p.id === productId));

  // --- Admin verify product ---
  const approve = await patch('/api/admin/products/' + productId, { status: 'approved' }, adminTok);
  check('admin approves product', approve.status === 200);
  const listApproved2 = await get('/api/products');
  check('approved product listed publicly', listApproved2.json.products.some((p) => p.id === productId));

  // --- Cart ---
  const addCart = await post('/api/cart', { productId, quantity: 2 }, buyerTok);
  check('buyer adds to cart', addCart.status === 201);
  const cart = await get('/api/cart', buyerTok);
  check('cart has 1 item', cart.json.items.length === 1 && cart.json.items[0].quantity === 2);

  // --- Order + payment + delivery ---
  const place = await post('/api/orders', { deliveryAddress: 'Kampala Road 12' }, buyerTok);
  check('buyer places order', place.status === 201);
  check('order split by farmer', place.json.orders.length === 1);
  const orderId = place.json.orders[0].id;
  check('order payment pending', place.json.orders[0].paymentStatus === 'pending');
  check('delivery tracking created', place.json.orders[0].delivery && place.json.orders[0].delivery.trackingCode);

  const pay = await post('/api/payments/' + orderId, { method: 'card', details: { number: '4242424242424242', expiry: '12/30', name: 'Kofi' } }, buyerTok);
  check('mock card payment succeeds', pay.status === 201);
  check('payment reference is marked demo', pay.json.payment.reference.startsWith('MOCK-'));

  const badPay = await post('/api/payments/' + orderId, { method: 'card', details: { number: '1234', expiry: '12/30', name: 'Kofi' } }, buyerTok);
  check('invalid card rejected', badPay.status === 400);

  const farmerOrders = await get('/api/orders/farmer', farmerTok);
  check('farmer sees order', farmerOrders.json.orders.some((o) => o.id === orderId && o.paymentStatus === 'paid'));

  const accept = await patch('/api/orders/' + orderId, { action: 'accept' }, farmerTok);
  check('farmer accepts order', accept.status === 200);

  const rejectOther = await patch('/api/orders/' + orderId, { action: 'reject' }, buyerTok);
  check('buyer cannot reject order', rejectOther.status === 403);

  const adv1 = await post('/api/deliveries/' + orderId + '/advance', {}, buyerTok);
  check('delivery advance in_transit', adv1.status === 200 && adv1.json.delivery.status === 'in_transit');
  const adv2 = await post('/api/deliveries/' + orderId + '/advance', {}, farmerTok);
  check('delivery advance out_for_delivery', adv2.status === 200 && adv2.json.delivery.status === 'out_for_delivery');
  const adv3 = await post('/api/deliveries/' + orderId + '/advance', {}, adminTok);
  check('delivery advance delivered', adv3.status === 200 && adv3.json.delivery.status === 'delivered');

  const orderDetail = await get('/api/orders/' + orderId, buyerTok);
  check('order auto-completed on delivery', orderDetail.json.order.status === 'completed');

  // --- Price comparison ---
  const compare = await get('/api/products/' + productId + '/compare', buyerTok);
  check('price comparison returns alternatives', compare.status === 200 && Array.isArray(compare.json.alternatives));

  // --- Location-based farmer search ---
  const farmers = await get('/api/farmers?q=Kampala');
  check('farmer location search works', farmers.status === 200 && farmers.json.farmers.some((f) => f.name === 'Asha'));

  // --- Chat ---
  const farmerId = (await get('/api/auth/me', farmerTok)).json.user.id;
  const sendMsg = await post('/api/chat/' + farmerId, { body: 'Hello, do you deliver to Wandegeya?' }, buyerTok);
  check('buyer sends chat message', sendMsg.status === 201);
  const unread = await get('/api/chat/unread', farmerTok);
  check('farmer has unread message', unread.json.unread >= 1);
  const partners = await get('/api/chat/partners', farmerTok);
  check('farmer sees buyer in partners', partners.json.partners.some((p) => p.name === 'Kofi'));
  const buyerId = (await get('/api/auth/me', buyerTok)).json.user.id;
  const convo = await get('/api/chat/' + buyerId, farmerTok);
  check('farmer reads conversation', convo.status === 200 && convo.json.messages.length === 1);

  // --- Wishlist ---
  const wlEmpty = await get('/api/wishlist', buyerTok);
  check('wishlist initially empty', wlEmpty.status === 200 && wlEmpty.json.items.length === 0);

  const wlAdd = await post('/api/wishlist', { productId }, buyerTok);
  check('buyer adds to wishlist', wlAdd.status === 201 && wlAdd.json.wishlisted === true);

  const wlDup = await post('/api/wishlist', { productId }, buyerTok);
  check('duplicate wishlist returns 409', wlDup.status === 409);

  const wlCheck = await get('/api/wishlist/check/' + productId, buyerTok);
  check('wishlist check returns true', wlCheck.status === 200 && wlCheck.json.wishlisted === true);

  const wlList = await get('/api/wishlist', buyerTok);
  check('wishlist has 1 item', wlList.status === 200 && wlList.json.items.length === 1);
  check('wishlist item has product details', wlList.json.items[0].productName === 'Test Tomatoes');

  const wlInvalid = await post('/api/wishlist', { productId: 9999 }, buyerTok);
  check('wishlist invalid product returns 404', wlInvalid.status === 404);

  const wlNoAuth = await post('/api/wishlist', { productId });
  check('wishlist requires auth', wlNoAuth.status === 401);

  const wlFarmerForbidden = await post('/api/wishlist', { productId }, farmerTok);
  check('farmer cannot use wishlist', wlFarmerForbidden.status === 403);

  const wlRemove = await del('/api/wishlist/' + productId, buyerTok);
  check('buyer removes from wishlist', wlRemove.status === 200 && wlRemove.json.wishlisted === false);

  const wlRemoveGone = await del('/api/wishlist/' + productId, buyerTok);
  check('remove non-existent returns 404', wlRemoveGone.status === 404);

  const wlCheckAfter = await get('/api/wishlist/check/' + productId, buyerTok);
  check('wishlist check returns false after remove', wlCheckAfter.status === 200 && wlCheckAfter.json.wishlisted === false);

  // --- Reviews ---
  const rvNoAuth = await post('/api/reviews', { productId, orderId, rating: 5, body: 'Great product!' });
  check('review requires auth', rvNoAuth.status === 401);

  const rvBadRating = await post('/api/reviews', { productId, orderId, rating: 0, body: 'Good stuff.' }, buyerTok);
  check('review rejects invalid rating (0)', rvBadRating.status === 400);

  const rvBadRating6 = await post('/api/reviews', { productId, orderId, rating: 6, body: 'Good stuff.' }, buyerTok);
  check('review rejects invalid rating (6)', rvBadRating6.status === 400);

  const rvEmpty = await post('/api/reviews', { productId, orderId, rating: 5, body: '' }, buyerTok);
  check('review rejects empty body', rvEmpty.status === 400);

  const rvShort = await post('/api/reviews', { productId, orderId, rating: 5, body: 'Hi' }, buyerTok);
  check('review rejects short body', rvShort.status === 400);

  const rvBadProduct = await post('/api/reviews', { productId: 9999, orderId, rating: 5, body: 'Great product!' }, buyerTok);
  check('review rejects invalid product', rvBadProduct.status === 404);

  const rvBadOrder = await post('/api/reviews', { productId, orderId: 9999, rating: 5, body: 'Great product!' }, buyerTok);
  check('review rejects invalid order', rvBadOrder.status === 404);

  const rvNotPurchased = await post('/api/reviews', { productId, orderId, rating: 5, body: 'Never bought this.' }, farmerTok);
  check('farmer cannot review (not buyer)', rvNotPurchased.status === 403);

  const rvSuccess = await post('/api/reviews', { productId, orderId, rating: 5, body: 'Excellent tomatoes, very fresh and tasty!' }, buyerTok);
  check('buyer creates review', rvSuccess.status === 201);
  check('review returns updated average', rvSuccess.json.averageRating === 5);
  check('review returns total count', rvSuccess.json.totalCount === 1);

  const rvDup = await post('/api/reviews', { productId, orderId, rating: 4, body: 'Another review for the same product.' }, buyerTok);
  check('duplicate review returns 409', rvDup.status === 409);

  const rvList = await get('/api/products/' + productId + '/reviews');
  check('product reviews endpoint returns reviews', rvList.status === 200 && rvList.json.reviews.length === 1);
  check('product reviews has average rating', rvList.json.averageRating === 5);
  check('product reviews has distribution', Array.isArray(rvList.json.distribution) && rvList.json.distribution.length === 5);

  const rvMine = await get('/api/reviews/mine', buyerTok);
  check('buyer can list own reviews', rvMine.status === 200 && rvMine.json.reviews.length === 1);
  check('my review has product name', rvMine.json.reviews[0].productName === 'Test Tomatoes');

  const rvMineFarmer = await get('/api/reviews/mine', farmerTok);
  check('farmer forbidden from buyer reviews', rvMineFarmer.status === 403);

  const rvInvalidProduct = await get('/api/products/9999/reviews');
  check('reviews for non-existent product returns 404', rvInvalidProduct.status === 404);

  const rvDeleteId = rvMine.json.reviews[0].id;
  const rvDelete = await del('/api/reviews/' + rvDeleteId, farmerTok);
  check('farmer cannot delete buyer review', rvDelete.status === 403);

  const rvDeleteBuyer = await del('/api/reviews/' + rvDeleteId, buyerTok);
  check('buyer can delete own review', rvDeleteBuyer.status === 200);

  const rvDeleteGone = await del('/api/reviews/' + rvDeleteId, buyerTok);
  check('delete non-existent review returns 404', rvDeleteGone.status === 404);

  const rvListAfter = await get('/api/products/' + productId + '/reviews');
  check('product reviews empty after delete', rvListAfter.json.reviews.length === 0 && rvListAfter.json.totalCount === 0);

  // --- Admin ---
  const adminUsers = await get('/api/admin/users', adminTok);
  check('admin lists users', adminUsers.status === 200 && adminUsers.json.users.length === 3);
  const buyerOnly = await get('/api/admin/users', buyerTok);
  check('buyer forbidden from admin', buyerOnly.status === 403);
  const reports = await get('/api/admin/reports', adminTok);
  check('admin reports available', reports.status === 200 && reports.json.orders.total === 1 && reports.json.revenue === 10000);

  const stock = await patch('/api/farmer/products/' + productId + '/stock', { quantity: 25 }, farmerTok);
  check('farmer updates stock', stock.status === 200 && stock.json.product.quantity === 25);

  const disableUser = await patch('/api/admin/users/' + buyerId, { status: 'disabled' }, adminTok);
  check('admin disables user', disableUser.status === 200);
  const loginDisabled = await post('/api/auth/login', { email: 'kofi@example.com', password: 'secret123' });
  check('disabled user cannot login', loginDisabled.status === 403);

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  check('all users stored in DB', count === 3);

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
