# Deploying DeepiMart to Render

DeepiMart is a Node.js (Express + SQLite) single-page application. It is built to run as a single
web service on Render (or any Node host). No separate database service or object storage is required,
but **persistent disk storage must be configured** because the app uses a SQLite database file and
stores uploaded images on disk.

## 1. What the app needs at runtime (read this first)

| Concern | Current behaviour | Deployment requirement |
| --- | --- | --- |
| Node version | Uses built-in `node:sqlite` (Node ≥ 22.5) and `--env-file-if-exists` (Node ≥ 22.9) | **Node ≥ 22.9**. Set `NODE_VERSION=22` on Render. |
| Database | SQLite file `data/deepimart.db` (path from `DB_PATH`, default `./data/deepimart.db`) | SQLite is file-based. The DB file (plus `-wal`/`-shm`) must live on a **persistent disk**, otherwise data is wiped on every redeploy. |
| Uploaded images | Files written to `uploads/` (path from `UPLOADS_DIR`) and served at `/uploads/...` | The folder must live on the **same persistent disk**. |
| Port | `process.env.PORT \|\| 3000` (`server/index.js:14`) | Render injects `PORT` automatically. |
| Entry file | `server/index.js` (see `package.json` "main" and "start") | Start command is `npm start`. |
| Seeding | `server/seed.js` runs on boot unless `DISABLE_SEED=1`. It is **idempotent**: it only inserts missing demo users/categories/products and never deletes or overwrites existing rows. | No action needed; set `DISABLE_SEED=1` if you want a clean production database. |
| Authentication | bcrypt password hashing + opaque random sessions stored in the `sessions` table; tokens sent via `Authorization: Bearer <token>` (over HTTPS/TLS). No secrets stored in source. Accounts are created with email + password directly; a single admin account (`admin@deepimart.com`) is seeded once with strict bcrypt validation (no demo bypass). | Works as-is over Render's HTTPS. |
| Static assets | `public/` (CSS, JS, images) served by `express.static`; the app uses hash-based routing (`#/...`) so no SPA fallback rewrite is needed. | Works as-is. |

Because the app is hash-routed and all API calls use relative URLs, **nothing in the codebase is
hardcoded to localhost** for serving. `localhost` only appears in test scripts and the dev startup log.

## 2. GitHub setup

1. Create a repository on GitHub (e.g. `DeepiMart`).
2. Push the project from your machine:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:<your-username>/DeepiMart.git
git push -u origin main
```

> `.gitignore` already excludes `node_modules/`, `data/`, `uploads/`, `*.db*`, and `.env` — your
> database, uploaded images, and credentials will **not** be committed to GitHub.

## 3. Create the service on Render

1. Go to https://dashboard.render.com and click **New + → Web Service**.
2. Connect your GitHub account and select the `DeepiMart` repository.
3. Fill in the service form:

| Field | Value |
| --- | --- |
| Name | `deepimart` (or your preference) |
| Language / Environment | `Node` |
| Branch | `main` |
| Runtime / Node version | set `NODE_VERSION=22` in **Environment** (advanced); Render picks supported versions |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free (or Starter for always-on) |

4. Under **Environment**, add the variables exactly as in section 4.
5. Under **Disks**, add a **persistent disk** (important!):
   - **Name**: `data`
   - **Mount Path**: `/var/data`
   - **Size**: 1 GB is plenty for a small marketplace.
6. Click **Create Web Service** and wait for the deploy to finish.

### 3.1 Auto-deploy on push

By default Render rebuilds on every push to the connected branch. You can also enable **Manual
Deploys** from the service's **Settings → Deploy Hooks** if you prefer to control releases.

## 4. Environment variables

Set these on the Render service (Settings → Environment), or in `.env` locally. Never commit real
values to the repository. An annotated template lives in `.env.example`.

| Variable | Required | Value on Render (example) | Notes |
| --- | --- | --- | --- |
| `NODE_VERSION` | Yes | `22` | Render uses this instead of its default Node image. |
| `DB_PATH` | Yes | `/var/data/deepimart.db` | Must point **inside the mounted disk**. |
| `UPLOADS_DIR` | Yes | `/var/data/uploads` | Must point **inside the mounted disk**. |
| `PORT` | No | (auto) | Render injects this; the app defaults to 3000. |
| `NODE_ENV` | No | (auto `production`) | Render sets it; keeps error responses generic. |
| `CORS_ORIGIN` | No | `https://deepimart.onrender.com` | Optional; comma-separated. Leave unset for a same-origin SPA. |
| `ADMIN_SETUP_CODE` | No | n/a | Removed. Admin credentials are seeded once (`admin@deepimart.com` / `admin123`); login always validates the stored bcrypt hash. | 
| `DEMO_MODE` | No | n/a | Removed. There is no "any credentials" bypass — wrong admin credentials always return 401. |
| `DISABLE_SEED` | No | `1` | Set to `1` to skip demo seed data. Safe to omit (seed is idempotent). |

The single admin account is provisioned by the idempotent seed on first boot and never
recreated, reset, or overwritten on restart. The seeded `admin@deepimart.com` account is what
logs in; there is no self-service "Create New Admin" flow.

Minimum working set on a fresh Render service using a `/var/data` disk:

```
NODE_VERSION=22
DB_PATH=/var/data/deepimart.db
UPLOADS_DIR=/var/data/uploads
```

## 5. Database requirements

- **Engine**: SQLite (built into Node via `node:sqlite`). No external database server.
- **Persistence**: the DB is a single file. Render's normal filesystem is **ephemeral** — anything
  outside a mounted Disk is replaced on every deploy. Therefore `DB_PATH` must be inside the mounted
  disk (`/var/data/...`).
- **Data safety**: startup never drops or rebuilds tables (`CREATE TABLE IF NOT EXISTS`). The seed
  routine only inserts missing rows. Existing accounts, orders, and products are preserved across
  restarts and redeploys.
- **Backups**: to back up, stop/copy the `.db` file (plus `-wal`/`-shm` if present), or download it/
  them from the Render Shell. The server also supports a `DB_PATH` override, so you can download the
  current file, run locally with `DB_PATH=./data/deepimart.db`, and restore by re-uploading the file.

## 6. Image storage requirements

- Product images are uploaded with `multer` to `UPLOADS_DIR` (default `uploads/`) and served at
  `/uploads/<file>`. Filenames are server-generated and never user-supplied.
- For the same reason as the DB, `UPLOADS_DIR` must live on the mounted disk (`/var/data/uploads`)
  so images **survive restarts and redeploys**. Without a disk, every redeploy would reset uploaded
  images (products would reference missing files and fall back to placeholders).
- Profile images are static files under `public/assets/images/` (shipped with the repo) and need no
  special handling.

## 7. How to test the public URL

After the first successful deploy, Render prints a URL like `https://deepimart.onrender.com`. Verify it:

```bash
# 1. Health check
curl https://deepimart.onrender.com/health
# => {"status":"ok"}

# 2. Page + static assets
curl -I https://deepimart.onrender.com/            # 200, HTML
curl -I https://deepimart.onrender.com/styles.css  # 200, text/css
curl -I https://deepimart.onrender.com/assets/images/farmer-default.png # 200, image/png

# 3. Registration (creates a buyer)
curl -X POST https://deepimart.onrender.com/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test User","email":"test@example.com","password":"secret123","role":"buyer"}'
# => 201 {"message":"Account created successfully.", ...}

# 4. Login
curl -X POST https://deepimart.onrender.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"secret123"}'
# => 200 {"token":"...", "user": {...}}   (token is NOT a password/secret — it is a random session id)

# 5. Browse
curl https://deepimart.onrender.com/api/products   # approved product listings
curl https://deepimart.onrender.com/api/categories # categories
```

In a browser (on any laptop/PC/mobile):
1. Open `https://deepimart.onrender.com`.
2. Log in with demo accounts (created by the seed) or your newly registered account:
   - Farmer: `farmer@deepimart.com` / `farmer123` — dashboard, add product **with an image**.
   - Buyer: `buyer@deepimart.com` / `buyer123` — add to cart, checkout, pay (mock), track delivery.
   - Admin: `admin@deepimart.com` / `admin123` — verify products, manage users, view reports.
3. Confirm order/payment and delivery flows, wishlist, reviews, and chat.
4. **Restart test**: trigger **Manual Deploy → Clear Build Cache and Deploy**, or edit a file and push.
   Log back in and confirm your registered account, orders, and uploaded product images are still there.

Local development still works unchanged:

```bash
cp .env.example .env   # optional customization
npm install
npm start              # http://localhost:3000
```

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| App crashes at boot (`node:sqlite` unknown) | Set `NODE_VERSION=22` (or higher) in Render env and redeploy. |
| Data/images disappear after redeploy | `DB_PATH`/`UPLOADS_DIR` are not on the mounted disk — point both at `/var/data/...`. |
| 500 on any request touching DB | Confirm the disk mounted successfully; check Render logs (`console.error` output is server-side only). |
| Seeded demo accounts unwanted | Set `DISABLE_SEED=1`. |