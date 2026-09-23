process.env.DB_PATH = './data/test.db';
process.env.PORT = '3999';
process.env.DISABLE_SEED = '1';
process.env.ADMIN_SETUP_CODE = 'test-admin-setup-123'; // only enforced when DEMO_MODE is off (production)

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

async function put(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + url, { method: 'PUT', headers, body: JSON.stringify(body) });
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

async function uploadImg(url, file, token) {
  const form = new FormData();
  if (file) form.append('image', new Blob([file.bytes], { type: file.type }), file.name);
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + url, { method: 'POST', headers, body: form });
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
  // --- Health checks (deployment readiness) ---
  const healthRoot = await get('/health');
  check('GET /health returns ok', healthRoot.status === 200 && healthRoot.json.status === 'ok');
  const healthApi = await get('/api/health');
  check('GET /api/health returns ok', healthApi.status === 200 && healthApi.json.status === 'ok');

  // --- Registration (email + password) ---
  const farmer = await post('/api/auth/register', { name: 'Asha', email: 'asha@example.com', password: 'secret123', role: 'farmer', phone: '+256700000001', location: 'Kampala' });
  check('register valid farmer returns 201', farmer.status === 201);
  check('register response has user email', farmer.json.user.email === 'asha@example.com');
  check('register response has role', farmer.json.user.role === 'farmer');
  check('register response has phone', farmer.json.user.phone === '+256700000001');

  const dup = await post('/api/auth/register', { name: 'Asha2', email: 'asha@example.com', password: 'secret123', role: 'buyer', phone: '+256700000011' });
  check('duplicate email returns 409', dup.status === 409);
  check('duplicate email message', dup.json.error === 'Email already registered.');

  const badEmail = await post('/api/auth/register', { name: 'Bob', email: 'not-an-email', password: 'secret123', role: 'farmer' });
  check('invalid email returns 400', badEmail.status === 400);
  check('invalid email message', badEmail.json.error === 'Please enter a valid email address.');

  const badRole = await post('/api/auth/register', { name: 'Bob', email: 'bob@example.com', password: 'secret123', role: 'admin', phone: '+256700000015' });
  check('admin role cannot self-register', badRole.status === 400);

  const buyer = await post('/api/auth/register', { name: 'Kofi', email: 'kofi@example.com', password: 'secret123', role: 'buyer', phone: '+256700000002', location: 'Accra' });
  check('register valid buyer returns 201', buyer.status === 201);

  // Registration succeeds with just email + password.
  const plain = await post('/api/auth/register', { name: 'Nadia', email: 'nadia@example.com', password: 'secret123', role: 'buyer', phone: '+256700000060' });
  check('register succeeds via email/password', plain.status === 201);

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

  // --- Profile editing ---
  const profNoAuth = await patch('/api/auth/profile', { name: 'No' });
  check('profile update requires auth', profNoAuth.status === 401);

  const profEmpty = await patch('/api/auth/profile', { name: '   ' }, farmerTok);
  check('profile update rejects empty name', profEmpty.status === 400);

  const prof = await patch('/api/auth/profile', { name: 'Asha', phone: '+256777000111', location: 'Kampala', bio: 'Organic farmer.' }, farmerTok);
  check('profile update succeeds', prof.status === 200);
  check('profile update returns new phone', prof.json.user.phone === '+256777000111');
  check('profile update returns new bio', prof.json.user.bio === 'Organic farmer.');

  const meAfter = await get('/api/auth/me', farmerTok);
  check('profile changes reflected in /me', meAfter.json.user.phone === '+256777000111' && meAfter.json.user.bio === 'Organic farmer.');

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

  // --- Product image upload ---
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
  const uploadedFiles = [];
  const pngFile = { bytes: pngBytes, type: 'image/png', name: 'crop.png' };

  const upNoAuth = await uploadImg('/api/farmer/product-images', pngFile);
  check('image upload requires auth', upNoAuth.status === 401);

  const upBuyer = await uploadImg('/api/farmer/product-images', pngFile, buyerTok);
  check('buyer cannot upload product images', upBuyer.status === 403);

  const upOk = await uploadImg('/api/farmer/product-images', pngFile, farmerTok);
  check('farmer uploads product image', upOk.status === 201 && upOk.json.url && /^\/uploads\/[a-z0-9]+_[0-9a-f]{20}\.png$/.test(upOk.json.url));
  const imgUrl = upOk.json.url;
  if (upOk.json.url) {
    const stored = path.join(UPLOADS_DIR, path.basename(upOk.json.url));
    uploadedFiles.push(path.basename(upOk.json.url));
    check('uploaded image stored on disk', fs.existsSync(stored));
  }
  if (imgUrl) {
    const served = await fetch(BASE + imgUrl);
    check('uploaded image served publicly', served.status === 200 && (served.headers.get('content-type') || '').indexOf('image/png') === 0);
  }

  const upExec = await uploadImg('/api/farmer/product-images', { bytes: pngBytes, type: 'image/png', name: 'crop.exe' }, farmerTok);
  check('executable file rejected', upExec.status === 400);

  const upTxt = await uploadImg('/api/farmer/product-images', { bytes: pngBytes, type: 'image/png', name: 'crop.txt' }, farmerTok);
  check('unsupported file extension rejected', upTxt.status === 400);

  const upMismatch = await uploadImg('/api/farmer/product-images', { bytes: pngBytes, type: 'text/plain', name: 'crop.png' }, farmerTok);
  check('mismatched mime type rejected', upMismatch.status === 400);

  const upBig = await uploadImg('/api/farmer/product-images', { bytes: Buffer.alloc(2 * 1024 * 1024 + 1, 65), type: 'image/png', name: 'big.png' }, farmerTok);
  check('oversized image rejected', upBig.status === 400);

  const upEmpty = await uploadImg('/api/farmer/product-images', null, farmerTok);
  check('upload without file rejected', upEmpty.status === 400);

  const withImg = await post('/api/farmer/products', { name: 'Image Tomato', description: 'Fresh', categoryId: catId, price: 2200, unit: 'kg', quantity: 10, photo: imgUrl }, farmerTok);
  check('create product with uploaded image', withImg.status === 201 && withImg.json.product.photo === imgUrl);
  const imgProdId = withImg.json.product.id;

  const badPhoto = await post('/api/farmer/products', { name: 'Path Photo', description: 'x', categoryId: catId, price: 2200, unit: 'kg', quantity: 10, photo: '../secret.png' }, farmerTok);
  check('create product rejects path traversal photo', badPhoto.status === 400);

  const jsPhoto = await post('/api/farmer/products', { name: 'Js Photo', description: 'x', categoryId: catId, price: 2200, unit: 'kg', quantity: 10, photo: 'javascript:alert(1)' }, farmerTok);
  check('create product rejects unsafe photo string', jsPhoto.status === 400);

  const up2 = await uploadImg('/api/farmer/product-images', { bytes: pngBytes, type: 'image/webp', name: 'crop.webp' }, farmerTok);
  check('farmer uploads webp image', up2.status === 201 && /\.webp$/.test(up2.json.url || ''));
  const img2Url = up2.json.url;
  if (img2Url) uploadedFiles.push(path.basename(img2Url));

  const baseFields = { name: 'Image Tomato', description: 'Fresh', categoryId: catId, price: 2200, unit: 'kg', quantity: 10, harvestDate: '', freshness: 'Fresh', location: 'Kampala' };

  const replace = await put('/api/farmer/products/' + imgProdId, { ...baseFields, photo: img2Url }, farmerTok);
  check('edit replaces product image', replace.status === 200 && replace.json.product.photo === img2Url);
  if (imgUrl) check('old image file removed after replace', !fs.existsSync(path.join(UPLOADS_DIR, path.basename(imgUrl))));

  const keep = await put('/api/farmer/products/' + imgProdId, { ...baseFields, photo: img2Url }, farmerTok);
  check('edit keeps existing image when none selected', keep.status === 200 && keep.json.product.photo === img2Url);

  const badUpd = await put('/api/farmer/products/' + imgProdId, { ...baseFields, photo: '/etc/passwd' }, farmerTok);
  check('edit rejects path traversal photo', badUpd.status === 400);

  const up3 = await uploadImg('/api/farmer/product-images', pngFile, farmerTok);
  const img3Url = up3.json.url;
  if (img3Url) uploadedFiles.push(path.basename(img3Url));
  const deleteImg = await post('/api/farmer/products', { name: 'Delete Img', description: 'x', categoryId: catId, price: 1500, unit: 'kg', quantity: 5, photo: img3Url }, farmerTok);
  check('create product with image for delete test', deleteImg.status === 201);
  const deleteProdId = deleteImg.json.product.id;
  const delImg = await del('/api/farmer/products/' + deleteProdId, farmerTok);
  check('farmer deletes product with image', delImg.status === 200);
  check('image file removed when product deleted', img3Url ? !fs.existsSync(path.join(UPLOADS_DIR, path.basename(img3Url))) : true);

  const approveImg = await patch('/api/admin/products/' + imgProdId, { status: 'approved' }, adminTok);
  check('admin approves product with image', approveImg.status === 200);
  const listImg = await get('/api/products');
  const listedImg = listImg.json.products.find((p) => p.id === imgProdId);
  check('public listing includes product image', !!listedImg && listedImg.photo === img2Url);

  const buyerCannotPut = await put('/api/farmer/products/' + imgProdId, baseFields, buyerTok);
  check('buyer cannot modify product image', buyerCannotPut.status === 403);

  for (const f of uploadedFiles) {
    try {
      fs.rmSync(path.join(UPLOADS_DIR, f), { force: true });
    } catch {}
  }

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

  // --- Stock management ---
  const afterOrder = await get('/api/products/' + productId);
  check('stock reduced after successful order', afterOrder.json.product.quantity === 48);

  const overCart = await post('/api/cart', { productId, quantity: 1000 }, buyerTok);
  check('cart rejects quantity above stock', overCart.status === 400);

  const zeroCart = await post('/api/cart', { productId, quantity: 0 }, buyerTok);
  check('cart rejects zero quantity', zeroCart.status === 400);

  const stockUp = await patch('/api/farmer/products/' + productId + '/stock', { quantity: 48 }, farmerTok);
  check('farmer restores stock before out-of-stock test', stockUp.status === 200);

  const reAdd = await post('/api/cart', { productId, quantity: 2 }, buyerTok);
  check('buyer re-adds item to cart', reAdd.status === 201);
  const cartRow = await get('/api/cart', buyerTok);
  const cartItemId = cartRow.json.items[0].cartItemId;

  const overPut = await put('/api/cart/' + cartItemId, { quantity: 1000 }, buyerTok);
  check('cart update rejects quantity above stock', overPut.status === 400);

  const stockZero = await patch('/api/farmer/products/' + productId + '/stock', { quantity: 0 }, farmerTok);
  check('farmer sets stock to zero', stockZero.status === 200);
  const outOfStockAdd = await post('/api/cart', { productId, quantity: 1 }, buyerTok);
  check('cannot add out-of-stock product to cart', outOfStockAdd.status === 400);

  const outOfStockOrder = await post('/api/orders', { deliveryAddress: 'Kampala' }, buyerTok);
  check('cannot place order for out-of-stock product', outOfStockOrder.status === 400);
  check('out-of-stock order mentions availability', String(outOfStockOrder.json.error).indexOf('available') !== -1);

  const stockRestore = await patch('/api/farmer/products/' + productId + '/stock', { quantity: 48 }, farmerTok);
  check('farmer restores stock after tests', stockRestore.status === 200);
  const cleanupCart = await del('/api/cart/' + cartItemId, buyerTok);
  check('cart cleanup after stock tests', cleanupCart.status === 200);

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

  // --- Password change ---
  const pwNoAuth = await patch('/api/auth/password', { currentPassword: 'secret123', newPassword: 'newpass456' });
  check('password change requires auth', pwNoAuth.status === 401);

  const pwWrong = await patch('/api/auth/password', { currentPassword: 'wrong', newPassword: 'newpass456' }, buyerTok);
  check('password change rejects wrong current password', pwWrong.status === 400);

  const pwShort = await patch('/api/auth/password', { currentPassword: 'secret123', newPassword: 'abc' }, buyerTok);
  check('password change rejects short password', pwShort.status === 400);

  const pwSame = await patch('/api/auth/password', { currentPassword: 'secret123', newPassword: 'secret123' }, buyerTok);
  check('password change rejects unchanged password', pwSame.status === 400);

  const pwMissing = await patch('/api/auth/password', { currentPassword: '', newPassword: 'newpass456' }, buyerTok);
  check('password change rejects empty current password', pwMissing.status === 400);

  const secondSession = await post('/api/auth/login', { email: 'kofi@example.com', password: 'secret123' });
  check('buyer can open a second session', secondSession.status === 200);
  const extraTok = secondSession.json.token;

  const pwOk = await patch('/api/auth/password', { currentPassword: 'secret123', newPassword: 'newpass456' }, buyerTok);
  check('password change succeeds', pwOk.status === 200);
  check('password change signs out other sessions', (await get('/api/auth/me', extraTok)).status === 401);
  check('current session stays signed in', (await get('/api/auth/me', buyerTok)).status === 200);

  const oldLogin = await post('/api/auth/login', { email: 'kofi@example.com', password: 'secret123' });
  check('old password no longer works', oldLogin.status === 401);
  const newLogin = await post('/api/auth/login', { email: 'kofi@example.com', password: 'newpass456' });
  check('new password works', newLogin.status === 200 && newLogin.json.user.email === 'kofi@example.com');

  // --- Admin self-service account creation (Create New Admin) ---
  // Demo mode: no Admin Setup Code is required (an incoming code is ignored).
  const setupMissing = await post('/api/auth/admin/setup', { name: 'Manager Zero', email: 'manager0@example.com', password: 'secret123' });
  check('admin setup without code creates admin', setupMissing.status === 201);
  const setupWrong = await post('/api/auth/admin/setup', { name: 'Manager One B', email: 'manager1b@example.com', password: 'secret123', setupCode: 'totally-wrong' });
  check('setup code ignored in demo mode', setupWrong.status === 201);
  const setupBadEmail = await post('/api/auth/admin/setup', { name: 'A2', email: 'not-an-email', password: 'secret123' });
  check('admin setup rejects invalid email', setupBadEmail.status === 400);
  const setupNoName = await post('/api/auth/admin/setup', { email: 'm3@example.com', password: 'secret123' });
  check('admin setup requires name', setupNoName.status === 400 && setupNoName.json.error === 'Please enter your name.');
  const setupShort = await post('/api/auth/admin/setup', { name: 'A4', email: 'm4@example.com', password: 'x' });
  check('admin setup rejects short password', setupShort.status === 400);
  const setupOk1 = await post('/api/auth/admin/setup', { name: 'Manager One', email: 'manager1@example.com', password: 'secret123' });
  check('admin setup creates admin account', setupOk1.status === 201 && setupOk1.json.admin.role === 'admin');
  const setupDup = await post('/api/auth/admin/setup', { name: 'Mgr', email: 'manager1@example.com', password: 'secret123' });
  check('admin setup rejects existing email', setupDup.status === 409 && setupDup.json.error === 'Email already exists.');
  const setupOk2 = await post('/api/auth/admin/setup', { name: 'Manager Two', email: 'manager2@example.com', password: 'secret123' });
  check('multiple admin accounts can be created', setupOk2.status === 201);

  // --- Admin login (demo mode: any email/password signs in to the dashboard) ---
  const demoLoginMatch = await post('/api/auth/admin/login', { email: 'root@example.com', password: 'definitely-wrong' });
  check('demo admin login accepts wrong password', demoLoginMatch.status === 200 && demoLoginMatch.json.user.role === 'admin' && demoLoginMatch.json.user.email === 'root@example.com');
  const demoLoginUnknown = await post('/api/auth/admin/login', { email: 'whoever@example.com', password: 'whatever' });
  check('demo admin login accepts unknown email', demoLoginUnknown.status === 200 && demoLoginUnknown.json.user.role === 'admin');
  const demoTok = demoLoginUnknown.json.token;
  const demoAdminUsers = await get('/api/admin/users', demoTok);
  check('demo admin login reaches admin API', demoAdminUsers.status === 200 && Array.isArray(demoAdminUsers.json.users));
  const demoLoginEmpty = await post('/api/auth/admin/login', { email: '', password: '' });
  check('admin login requires email and password', demoLoginEmpty.status === 400);

  const mgr1Login = await post('/api/auth/login', { email: 'manager1@example.com', password: 'secret123' });
  check('created admin can log in', mgr1Login.status === 200 && mgr1Login.json.user.role === 'admin');
  const mgr1Tok = mgr1Login.json.token;
  const mgrAdmin = await get('/api/admin/users', mgr1Tok);
  check('created admin has admin access', mgrAdmin.status === 200 && Array.isArray(mgrAdmin.json.users));

  const mgrRegister = await post('/api/auth/register', { name: 'X', email: 'x-admin@example.com', password: 'secret123', role: 'admin' });
  check('register cannot create admin', mgrRegister.status === 400);

  // --- Admin ---
  const adminUsers = await get('/api/admin/users', adminTok);
  check('admin lists users', adminUsers.status === 200 && adminUsers.json.users.length === 8);
  const buyerOnly = await get('/api/admin/users', buyerTok);
  check('buyer forbidden from admin', buyerOnly.status === 403);
  const reports = await get('/api/admin/reports', adminTok);
  check('admin reports available', reports.status === 200 && reports.json.orders.total === 1 && reports.json.revenue === 10000);
  const s = reports.json.summary;
  check(
    'admin reports summary counts',
    reports.status === 200 && !!s && s.orders === 1 && typeof s.buyers === 'number' && typeof s.sellers === 'number' && typeof s.delivered === 'number' && typeof s.pending === 'number' && typeof s.cancelled === 'number'
  );

  const stock = await patch('/api/farmer/products/' + productId + '/stock', { quantity: 25 }, farmerTok);
  check('farmer updates stock', stock.status === 200 && stock.json.product.quantity === 25);

  const disableUser = await patch('/api/admin/users/' + buyerId, { status: 'disabled' }, adminTok);
  check('admin disables user', disableUser.status === 200);
  const loginDisabled = await post('/api/auth/login', { email: 'kofi@example.com', password: 'newpass456' });
  check('disabled user cannot login', loginDisabled.status === 403);

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  check('all users stored in DB', count === 8);

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
