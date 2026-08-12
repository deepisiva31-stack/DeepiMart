const path = require('node:path');
const express = require('express');
const cors = require('cors');

const authRouter = require('./auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    credentials: true,
  })
);

app.use(express.json({ limit: '10kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Invalid request payload.' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`DeepiMart server running at http://localhost:${PORT}`);
});
