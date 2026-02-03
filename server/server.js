require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const morgan = require('morgan');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { run, get, all, init } = require('./db');
const { hashPassword, compareWithUpgrade, requireAuth, requireAdmin } = require('./auth');
const https = require('https');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Strong session secret handling: require env in production, otherwise generate ephemeral dev secret.
const SESSION_SECRET = (() => {
  const secret = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production' && !secret) {
    throw new Error('SESSION_SECRET is required in production. Set it in the environment.');
  }
  if (!secret) {
    console.warn('[security] SESSION_SECRET not set; generating a temporary dev secret (sessions reset on restart).');
    return crypto.randomBytes(64).toString('hex');
  }
  return secret;
})();

// Auth rate limits (per IP)
const AUTH_LIMIT_LOGIN = { limit: 7, windowMs: 15 * 60 * 1000 }; // 7 attempts / 15 minutes
const AUTH_LIMIT_REGISTER = { limit: 3, windowMs: 60 * 60 * 1000 }; // 3 registrations / hour

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(morgan('dev'));

const jsonParser = express.json();
const urlParser = express.urlencoded({ extended: true });
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payments/webhook') return next();
  return jsonParser(req, res, next);
});
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payments/webhook') return next();
  return urlParser(req, res, next);
});

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname) }),
    name: 'eic.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

// Inquiry form (class page)
app.post(
  '/api/inquiry',
  [
    body('name').isLength({ min: 2 }),
    body('email').isEmail(),
    body('phone').optional(),
    body('message').isLength({ min: 5 }),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const enabled = (await getSetting('inquiries_enabled', 'true')) === 'true';
    if (!enabled) return res.status(403).json({ success: false, message: 'Inquiries disabled' });
    try {
      await run('INSERT INTO inquiries (name, email, phone, message) VALUES (?, ?, ?, ?)', [
        req.body.name,
        req.body.email,
        req.body.phone || '',
        req.body.message,
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('inquiry', err);
      return res.status(500).json({ success: false });
    }
  }
);

app.get('/api/admin/inquiries', requireAdmin, async (req, res) => {
  try {
    const rows = await all('SELECT id, name, email, phone, message, created_at FROM inquiries ORDER BY created_at DESC LIMIT 200');
    return res.json({ success: true, inquiries: rows });
  } catch (err) {
    console.error('inquiries list', err);
    return res.status(500).json({ success: false });
  }
});

app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.use('/images', express.static(path.join(__dirname, '..', 'public', 'images')));

function sendView(req, res, file) {
  run('INSERT INTO analytics (path, user_id, ip) VALUES (?, ?, ?)', [
    req.path,
    req.session?.user ? req.session.user.id : null,
    req.ip,
  ]).catch(() => {});
  return res.sendFile(path.join(__dirname, '..', 'views', file));
}

app.get('/', (req, res) => sendView(req, res, 'index.html'));
app.get('/about', (req, res) => sendView(req, res, 'about.html'));
app.get('/services', (req, res) => sendView(req, res, 'services.html'));
app.get('/contact', (req, res) => sendView(req, res, 'contact.html'));
app.get('/learn', (req, res) => sendView(req, res, 'learn.html'));
app.get('/glossary', (req, res) => sendView(req, res, 'glossary.html'));
app.get('/founder', (req, res) => sendView(req, res, 'founder.html'));
app.get('/sip-calculator', (req, res) => sendView(req, res, 'sip-calculator.html'));
app.get('/risk-quiz', (req, res) => sendView(req, res, 'risk-quiz.html'));
app.get('/articles', (req, res) => sendView(req, res, 'articles.html'));
app.get('/videos', (req, res) => sendView(req, res, 'videos.html'));
app.get('/downloads', (req, res) => sendView(req, res, 'downloads.html'));
app.get('/certificate', (req, res) => sendView(req, res, 'certificate.html'));
app.get('/class', (req, res) => sendView(req, res, 'class.html'));
app.get('/weekly-digest', (req, res) => sendView(req, res, 'weekly-digest.html'));
app.get('/subscriptions', (req, res) => sendView(req, res, 'subscriptions.html'));
app.get('/subscription-request', requireAuth, (req, res) => sendView(req, res, 'subscription-request.html'));
app.get('/403', (req, res) => sendView(req, res, '403.html'));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, '..', 'robots.txt')));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, '..', 'sitemap.xml')));

app.get('/login', (req, res) => sendView(req, res, 'login.html'));
app.get('/register', (req, res) => sendView(req, res, 'register.html'));
app.get('/forgot-password', (req, res) => sendView(req, res, 'forgot-password.html'));

app.get('/admin', requireAdmin, (req, res) => sendView(req, res, 'admin.html'));
app.get('/user', requireAuth, (req, res) => sendView(req, res, 'user.html'));

// Helper: slugify
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

// Helper: disallow stock-like words
function violatesContentRules(text) {
  const banned = /(buy|sell|target|call|tip|nse|bse|cmp|entry|exit|intraday|swing)/i;
  return banned.test(text || '');
}

// Plan configuration (server-only pricing)
const PLANS = {
  Starter: { key: 'Starter', amount: 40000, currency: 'INR', durationDays: 30 }, // amounts in paise
  Pro: { key: 'Pro', amount: 90000, currency: 'INR', durationDays: 90 },
  Institution: { key: 'Institution', amount: 250000, currency: 'INR', durationDays: 365 },
};

const promoCodes = (process.env.PROMO_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);

function isPromoValid(code) {
  if (!code) return false;
  return promoCodes.includes(code);
}

// Simple in-memory rate limiter (per-process). Good enough for single-node deployments.
const rateBuckets = {};
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets[key] || { count: 0, start: now };
  if (now - bucket.start > windowMs) {
    bucket.count = 0;
    bucket.start = now;
  }
  bucket.count += 1;
  rateBuckets[key] = bucket;
  return bucket.count <= limit;
}

// Razorpay client
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

async function activateSubscription(userId, planKey) {
  const plan = PLANS[planKey] || PLANS.Starter;
  const expires = new Date();
  expires.setDate(expires.getDate() + (plan.durationDays || 30));
  await run('UPDATE users SET subscription_active = 1, subscription_expires_at = ? WHERE id = ?', [
    expires.toISOString(),
    userId,
  ]);
}

async function ensureSubscriptionFresh(userId) {
  try {
    const row = await get('SELECT subscription_active, subscription_expires_at FROM users WHERE id = ?', [userId]);
    if (!row) return { active: false };
    let active = row.subscription_active === 1;
    if (row.subscription_expires_at) {
      const exp = new Date(row.subscription_expires_at);
      if (Date.now() > exp.getTime()) {
        active = false;
        await run('UPDATE users SET subscription_active = 0 WHERE id = ?', [userId]);
      }
    }
    return { active, expires_at: row.subscription_expires_at };
  } catch (e) {
    return { active: false };
  }
}

// Helper: reading time in minutes (200 wpm)
function calcReadMinutes(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

// Helper: find latest review date from changelog for a given content id/type
async function latestReview(contentType, contentId) {
  try {
    const row = await get(
      `SELECT created_at FROM changelog WHERE title LIKE ? ORDER BY created_at DESC LIMIT 1`,
      [`${contentType}:${contentId}%`]
    );
    return row ? row.created_at : null;
  } catch (e) {
    return null;
  }
}

function isStale(dateStr) {
  if (!dateStr) return true;
  const then = new Date(dateStr);
  const now = new Date();
  const diff = (now - then) / (1000 * 60 * 60 * 24);
  return diff > 180;
}

async function getSetting(key, fallback = null) {
  const row = await get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

// Stock cache
let stockCache = [];
async function loadStockCache() {
  stockCache = await all('SELECT stock_id, stock_name, symbol, exchange, sector, isin FROM stock_master WHERE active = 1');
}

function filterStocks(q, limit = 15, exchangesEnabled = { nse: true, bse: true }) {
  const term = (q || '').toLowerCase();
  const res = stockCache.filter((s) => {
    if (s.exchange === 'NSE' && !exchangesEnabled.nse) return false;
    if (s.exchange === 'BSE' && !exchangesEnabled.bse) return false;
    return s.symbol.toLowerCase().includes(term) || s.stock_name.toLowerCase().includes(term);
  });
  return res.slice(0, limit);
}

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    let data = '';
    https
      .get(url, (res) => {
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

async function refreshStockMaster() {
  const nseUrl = process.env.NSE_EQ_CSV || 'https://archives.nseindia.com/content/equities/EQUITY_L.csv';
  const bseUrl = process.env.BSE_EQ_CSV || 'https://api.bseindia.com/BseIndiaAPI/api/DownloadCSV?strType=EQ';
  const enableNse = (await getSetting('enable_nse', 'true')) === 'true';
  const enableBse = (await getSetting('enable_bse', 'true')) === 'true';

  let rows = [];
  if (enableNse) {
    try {
      const csv = await fetchCSV(nseUrl);
      rows = rows.concat(
        csv
          .split('\n')
          .slice(1)
          .map((line) => line.split(','))
          .filter((cols) => cols.length >= 2 && cols[0])
          .map((cols) => ({
            name: cols[0].replace(/\"/g, '').trim(),
            symbol: cols[1].replace(/\"/g, '').trim(),
            exchange: 'NSE',
            isin: cols[2]?.replace(/\"/g, '').trim() || null,
            sector: null,
          }))
      );
    } catch (e) {
      console.error('NSE fetch failed', e);
    }
  }

  if (enableBse) {
    try {
      const csv = await fetchCSV(bseUrl);
      rows = rows.concat(
        csv
          .split('\n')
          .slice(1)
          .map((line) => line.split(','))
          .filter((cols) => cols.length >= 2 && cols[0])
          .map((cols) => ({
            name: cols[0].replace(/\"/g, '').trim(),
            symbol: cols[1].replace(/\"/g, '').trim(),
            exchange: 'BSE',
            isin: cols[2]?.replace(/\"/g, '').trim() || null,
            sector: null,
          }))
      );
    } catch (e) {
      console.error('BSE fetch failed', e);
    }
  }

  if (!rows.length) return;
  await run('BEGIN');
  try {
    for (const r of rows) {
      if (!r.symbol || !r.name) continue;
      await run(
        `INSERT INTO stock_master (stock_name, symbol, exchange, sector, isin, active)
         VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(symbol, exchange) DO UPDATE SET stock_name=excluded.stock_name, sector=excluded.sector, isin=excluded.isin, active=1`,
        [r.name, r.symbol, r.exchange, r.sector, r.isin]
      );
    }
    await setSetting('stocks_last_refresh', new Date().toISOString());
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK');
    console.error('stock refresh error', err);
  }
  await loadStockCache();
}

async function ensureStockCache() {
  if (!stockCache.length) await loadStockCache();
}

function basicStockInfo(symbol) {
  const match = stockCache.find((s) => s.symbol.toLowerCase() === symbol.toLowerCase());
  if (!match) {
    return {
      company: symbol,
      symbol,
      sector: 'N/A',
      industry: 'N/A',
      description: `${symbol} is listed on Indian exchanges.`,
      price_delayed: 'N/A',
    };
  }
  return {
    company: match.stock_name,
    symbol: match.symbol,
    sector: match.sector || 'N/A',
    industry: 'N/A',
    description: `${match.stock_name} operates in the ${match.sector || 'Indian markets'} space.`,
    price_delayed: 'N/A',
  };
}

// Build weekly digest HTML from last 7 days of news/quotes and latest weekly summary
async function buildDigestHtml() {
  const disclaimer =
    (await getSetting('disclaimer')) ||
    'Equity Investor Club is not a SEBI registered advisor. All content is for educational purposes only. Do your own analysis before investing.';
  const news = await all(
    `SELECT content, updated_at FROM daily_news WHERE is_published = 1 AND datetime(updated_at) >= datetime('now','-7 days') ORDER BY updated_at DESC`
  );
  const quotes = await all(
    `SELECT content, publish_at FROM daily_quote WHERE is_active = 1 AND datetime(publish_at) >= datetime('now','-7 days') ORDER BY publish_at DESC`
  );
  const weekly = await get(
    `SELECT content, publish_at FROM weekly_summary WHERE is_active = 1 AND datetime(publish_at) >= datetime('now','-14 days') ORDER BY publish_at DESC LIMIT 1`
  );

  function section(title, body) {
    if (!body) return '';
    return `<section style="margin:16px 0;padding:14px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);">
      <h3 style="margin:0 0 8px;">${title}</h3>
      ${body}
    </section>`;
  }

  const newsHtml =
    news.length === 0
      ? '<p>No daily news posted in the last 7 days.</p>'
      : '<ul>' +
        news
          .map((n) => `<li>${n.content} <span style="color:#9bb3d6;font-size:12px;">(${new Date(n.updated_at).toDateString()})</span></li>`)
          .join('') +
        '</ul>';

  const quoteHtml =
    quotes.length === 0
      ? '<p>No quotes this week.</p>'
      : '<ul>' +
        quotes
          .map((q) => `<li>“${q.content}” <span style="color:#9bb3d6;font-size:12px;">(${new Date(q.publish_at).toDateString()})</span></li>`)
          .join('') +
        '</ul>';

  const weeklyHtml = weekly ? `<div>${formatUpdateToHtml(weekly.content)}</div>` : '<p>No weekly summary posted.</p>';

  const content = `
    <div class="digest">
      <div class="disclaimer">Disclaimer: ${disclaimer}</div>
      ${section("This Week's Daily News", newsHtml)}
      ${section('Weekly Summary', weeklyHtml)}
      ${section('Learning Quotes', quoteHtml)}
      <div class="disclaimer" style="margin-top:16px;">Disclaimer: ${disclaimer}</div>
    </div>
  `;
  return content;
}

// Periodic weekly refresh (checks once a day)
setInterval(async () => {
  try {
    const last = await getSetting('stocks_last_refresh', null);
    const enableNse = (await getSetting('enable_nse', 'true')) === 'true';
    const enableBse = (await getSetting('enable_bse', 'true')) === 'true';
    if (!enableNse && !enableBse) return;
    let stale = true;
    if (last) {
      const diff = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
      stale = diff > 6.5; // about weekly
    }
    if (stale) {
      console.log('Auto refreshing stock master...');
      await refreshStockMaster();
    }
  } catch (e) {
    console.error('auto refresh stocks', e);
  }
}, 24 * 60 * 60 * 1000);

// Active user tracking
const activeSessions = new Map(); // sessionID -> timestamp
setInterval(() => {
  const now = Date.now();
  for (const [sid, t] of activeSessions.entries()) {
    if (now - t > 1000 * 60 * 5) activeSessions.delete(sid); // 5 min window
  }
}, 60 * 1000);

app.use((req, res, next) => {
  if (req.session && req.session.id) {
    activeSessions.set(req.session.id, Date.now());
  }
  next();
});

// Page analytics middleware (html GET only)
app.use((req, res, next) => {
  if (req.method === 'GET' && req.headers.accept && req.headers.accept.includes('text/html')) {
    run('INSERT INTO analytics (path, user_id, ip) VALUES (?, ?, ?)', [
      req.path,
      req.session.user ? req.session.user.id : null,
      req.ip,
    ]).catch(() => {});
  }
  next();
});

// --- Validation helper
const handleValidation = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }
};

// --- Auth routes
app.post(
  '/api/register',
  [
    body('name').isLength({ min: 2 }).withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be 8+ chars'),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const key = `register:${req.ip}`;
    if (!rateLimit(key, AUTH_LIMIT_REGISTER.limit, AUTH_LIMIT_REGISTER.windowMs)) {
      return res.status(429).json({ success: false, message: 'Too many sign-up attempts. Please try again later.' });
    }
    const { name, email, password } = req.body;
    try {
      const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) return res.status(409).json({ success: false, message: 'Email already registered' });
      const password_hash = await hashPassword(password);
      await run('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)', [
        name,
        email,
        password_hash,
        'user',
        'active',
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Register error', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

app.post(
  '/api/login',
  [body('email').isEmail(), body('password').isLength({ min: 1 })],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const key = `login:${req.ip}`;
    if (!rateLimit(key, AUTH_LIMIT_LOGIN.limit, AUTH_LIMIT_LOGIN.windowMs)) {
      return res
        .status(429)
        .json({ success: false, message: 'Too many login attempts. Please wait a few minutes and try again.' });
    }
    const { email, password } = req.body;
    try {
      const user = await get('SELECT * FROM users WHERE email = ?', [email]);
      if (!user) return res.status(401).json({ success: false, message: 'Invalid credentials' });
      if (user.status !== 'active') return res.status(403).json({ success: false, message: 'Account inactive' });
      const result = await compareWithUpgrade(password, user, run);
      if (!result.ok) return res.status(401).json({ success: false, message: 'Invalid credentials' });
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        subscription_active: user.subscription_active === 1,
        subscription_expires_at: user.subscription_expires_at || null,
      };
      await run('INSERT INTO logs (user_id, action, ip, role) VALUES (?, ?, ?, ?)', [
        user.id,
        'login',
        req.ip,
        user.role,
      ]);
      return res.json({ success: true, user: req.session.user });
    } catch (err) {
      console.error('Login error', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.get('/api/me', (req, res) => {
  (async () => {
    if (!req.session.user) return res.status(401).json({ success: false });
    // update streaks (simple login/day activity tracker)
    try {
      const today = new Date();
      const row = await get('SELECT current, longest, updated_at FROM streaks WHERE user_id = ?', [req.session.user.id]);
      let current = 1;
      let longest = 1;
      if (row) {
        const last = new Date(row.updated_at);
        const diffDays = Math.floor((today - last) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) {
          current = row.current;
          longest = row.longest;
        } else if (diffDays === 1) {
          current = row.current + 1;
          longest = Math.max(longest, current, row.longest);
        } else {
          current = 1;
          longest = Math.max(row.longest, 1);
        }
        await run('UPDATE streaks SET current = ?, longest = ?, updated_at = datetime("now") WHERE user_id = ?', [
          current,
          longest,
          req.session.user.id,
        ]);
      } else {
        await run('INSERT INTO streaks (user_id, current, longest, updated_at) VALUES (?, 1, 1, datetime("now"))', [
          req.session.user.id,
        ]);
      }
      req.session.user.streak = { current, longest };
    } catch (e) {
      console.error('streak update', e);
    }
    // ensure subscription flag present and not expired
    try {
      const sub = await ensureSubscriptionFresh(req.session.user.id);
      req.session.user.subscription_active = sub.active;
      req.session.user.subscription_expires_at = sub.expires_at;
    } catch (e) {}
    return res.json({ success: true, user: req.session.user });
  })();
});

app.post(
  '/api/user/password',
  requireAuth,
  [body('password').isLength({ min: 8 }).withMessage('Password must be 8+ chars')],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { password } = req.body;
    try {
      const hash = await hashPassword(password);
      await run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.session.user.id]);
      await run('INSERT INTO logs (user_id, action, ip, role) VALUES (?, ?, ?, ?)', [
        req.session.user.id,
        'password_change',
        req.ip,
        req.session.user.role,
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Password change error', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// --- Admin routes
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await all('SELECT id, name, email, role, status, created_at FROM users ORDER BY id DESC');
    return res.json({ success: true, users });
  } catch (err) {
    console.error('List users', err);
    return res.status(500).json({ success: false });
  }
});

app.post(
  '/api/admin/users',
  requireAdmin,
  [
    body('name').isLength({ min: 2 }),
    body('email').isEmail(),
    body('password').isLength({ min: 8 }),
    body('role').isIn(['admin', 'user']).optional({ nullable: true }),
    body('status').isIn(['active', 'inactive']).optional({ nullable: true }),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { name, email, password, role = 'user', status = 'active' } = req.body;
    try {
      const exists = await get('SELECT id FROM users WHERE email = ?', [email]);
      if (exists) return res.status(409).json({ success: false, message: 'Email exists' });
      const hash = await hashPassword(password);
      await run('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)', [
        name,
        email,
        hash,
        role,
        status,
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Add user', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

app.patch(
  '/api/admin/users/:id/status',
  requireAdmin,
  [body('status').isIn(['active', 'inactive'])],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    try {
      await run('UPDATE users SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Status update', err);
      return res.status(500).json({ success: false });
    }
  }
);

app.patch(
  '/api/admin/users/:id/password',
  requireAdmin,
  [body('password').isLength({ min: 8 })],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    try {
      const hash = await hashPassword(req.body.password);
      await run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Admin reset password', err);
      return res.status(500).json({ success: false });
    }
  }
);

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await run('DELETE FROM users WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Delete user', err);
    return res.status(500).json({ success: false });
  }
});

app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  try {
    const logs = await all(
      `SELECT logs.id, logs.action, logs.ip, logs.timestamp, logs.role, users.email as user_email
       FROM logs
       LEFT JOIN users ON users.id = logs.user_id
       ORDER BY logs.id DESC
       LIMIT 200`
    );
    return res.json({ success: true, logs });
  } catch (err) {
    console.error('Logs', err);
    return res.status(500).json({ success: false });
  }
});

// --- Contact mail
app.post(
  '/api/contact',
  [
    body('name').isLength({ min: 2 }).withMessage('Name required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('message').isLength({ min: 10 }).withMessage('Message too short'),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const key = `contact:${req.ip}`;
    if (!rateLimit(key, 5, 60_000)) return res.status(429).json({ success: false, message: 'Too many attempts, please wait.' });
    if (!process.env.SMTP_HOST) {
      return res.status(500).json({ success: false, message: 'Mail not configured' });
    }
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      await transporter.sendMail({
        from: `"Equity Investor Club" <${process.env.SMTP_USER}>`,
        to: process.env.MAIL_TO || process.env.SMTP_USER,
        subject: 'New contact form message',
        text: `Name: ${req.body.name}\nEmail: ${req.body.email}\n\nMessage:\n${req.body.message}`,
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('Contact mail error', err);
      return res.status(500).json({ success: false, message: 'Mail send failed' });
    }
  }
);

// --- Daily market update routes
function formatUpdateToHtml(content) {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let html = '';
  let inList = false;
  lines.forEach((line) => {
    const bullet = /^[-•]/.test(line) || /^[0-9]+\./.test(line);
    if (bullet) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${line.replace(/^[-•0-9.\\s]+/, '').trim()}</li>`;
    } else {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += `<p>${line}</p>`;
    }
  });
  if (inList) html += '</ul>';
  return html || '<p>No update posted.</p>';
}

app.get('/api/daily/latest', async (req, res) => {
  try {
    const update = await get(
      `SELECT du.id, du.content, du.created_at, du.is_active, u.name as author_name
       FROM daily_updates du
       LEFT JOIN users u ON u.id = du.created_by
       WHERE du.is_active = 1 AND datetime(du.publish_at) <= datetime('now')
       ORDER BY du.publish_at DESC
       LIMIT 1`
    );
    if (!update) return res.json({ success: true, update: null });

    const isLoggedIn = !!req.session.user;
    const maxPreviewLength = 400;
    let preview = !isLoggedIn;
    let content = update.content;
    if (!isLoggedIn && content.length > maxPreviewLength) {
      content = `${content.slice(0, maxPreviewLength)}... (login to view full update)`;
    }
    const html = formatUpdateToHtml(content);

    return res.json({
      success: true,
      update: {
        id: update.id,
        content,
        html,
        created_at: update.created_at,
        author: update.author_name || 'Admin',
        preview,
      },
    });
  } catch (err) {
    console.error('Fetch daily update', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/admin/daily/latest', requireAdmin, async (req, res) => {
  try {
    const update = await get(
      `SELECT du.id, du.content, du.created_at, du.is_active, u.name as author_name
       FROM daily_updates du
       LEFT JOIN users u ON u.id = du.created_by
       WHERE du.is_active = 1
       ORDER BY du.publish_at DESC
       LIMIT 1`
    );
    return res.json({ success: true, update: update || null });
  } catch (err) {
    console.error('Admin fetch daily', err);
    return res.status(500).json({ success: false });
  }
});

app.post(
  '/api/admin/daily',
  requireAdmin,
  [
    body('content').isLength({ min: 10 }).withMessage('Content must be at least 10 characters'),
    body('publish_at').optional().isISO8601().toDate(),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { content, publish_at } = req.body;
    try {
      await run('UPDATE daily_updates SET is_active = 0 WHERE is_active = 1');
      const result = await run('INSERT INTO daily_updates (content, created_by, is_active, publish_at) VALUES (?, ?, 1, ?)', [
        content,
        req.session.user.id,
        publish_at || new Date().toISOString(),
      ]);
      return res.json({ success: true, id: result.lastID });
    } catch (err) {
      console.error('Create daily update', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

app.put(
  '/api/admin/daily/:id',
  requireAdmin,
  [
    body('content').isLength({ min: 10 }).withMessage('Content must be at least 10 characters'),
    body('publish_at').optional().isISO8601().toDate(),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { content, publish_at } = req.body;
    const { id } = req.params;
    try {
      await run('UPDATE daily_updates SET is_active = 0 WHERE id != ?', [id]);
      await run('UPDATE daily_updates SET content = ?, is_active = 1, publish_at = COALESCE(?, publish_at) WHERE id = ?', [
        content,
        publish_at ? publish_at : null,
        id,
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Update daily', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

app.delete('/api/admin/daily/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await run('DELETE FROM daily_updates WHERE id = ?', [id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Delete daily', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Polls
app.post(
  '/api/admin/polls',
  requireAdmin,
  [
    body('question').isLength({ min: 5 }),
    body('options').isArray({ min: 2, max: 5 }),
    body('publish_at').optional().isISO8601().toDate(),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { question, options, publish_at } = req.body;
    if (violatesContentRules(question)) return res.status(400).json({ success: false, message: 'Question not allowed' });
    try {
      const poll = await run(
        'INSERT INTO polls (question, publish_at, is_active) VALUES (?, ?, 1)',
        [question, publish_at || new Date().toISOString()]
      );
      for (const opt of options.slice(0, 5)) {
        await run('INSERT INTO poll_options (poll_id, option_text) VALUES (?, ?)', [poll.lastID, opt]);
      }
      return res.json({ success: true, id: poll.lastID });
    } catch (err) {
      console.error('Create poll', err);
      return res.status(500).json({ success: false });
    }
  }
);

app.get('/api/poll', async (req, res) => {
  try {
    const poll = await get(
      `SELECT * FROM polls WHERE is_active = 1 AND datetime(publish_at) <= datetime('now') ORDER BY publish_at DESC LIMIT 1`
    );
    if (!poll) return res.json({ success: true, poll: null });
    const options = await all('SELECT id, option_text FROM poll_options WHERE poll_id = ?', [poll.id]);
    const votes = await all(
      `SELECT option_id, COUNT(*) as c FROM poll_votes WHERE poll_id = ? GROUP BY option_id`,
      [poll.id]
    );
    const total = votes.reduce((a, v) => a + v.c, 0);
    const results = options.map((o) => {
      const v = votes.find((x) => x.option_id === o.id);
      const count = v ? v.c : 0;
      const pct = total ? Math.round((count / total) * 100) : 0;
      return { ...o, count, pct };
    });
    return res.json({ success: true, poll: { ...poll, options: results, total } });
  } catch (err) {
    console.error('Poll fetch', err);
    return res.status(500).json({ success: false });
  }
});

app.post(
  '/api/poll/:id/vote',
  requireAuth,
  [body('option_id').isInt()],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const key = `pollvote:${req.ip}`;
    if (!rateLimit(key, 5, 60_000)) return res.status(429).json({ success: false, message: 'Too many votes, try later.' });
    const { id } = req.params;
    const { option_id } = req.body;
    try {
      await run('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)', [
        id,
        option_id,
        req.session.user.id,
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Vote', err);
      return res.status(400).json({ success: false, message: 'Already voted or invalid' });
    }
  }
);

// Articles
app.post(
  '/api/admin/articles',
  requireAdmin,
  [
    body('title').isLength({ min: 5 }),
    body('content').isLength({ min: 50 }),
    body('publish_at').optional().isISO8601().toDate(),
    body('sources').optional(),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { title, content, publish_at, sources } = req.body;
    if (violatesContentRules(content)) return res.status(400).json({ success: false, message: 'Content not allowed' });
    const slug = slugify(title);
    let sources_json = null;
    if (sources) {
      try { sources_json = JSON.stringify(sources.tags || sources.names ? sources : []); } catch (e) { sources_json = null; }
    }
    try {
      const result = await run(
        'INSERT INTO articles (title, slug, content, publish_at, is_active, sources_json) VALUES (?, ?, ?, ?, 1, ?)',
        [title, slug, content, publish_at || new Date().toISOString(), sources_json]
      );
      return res.json({ success: true, id: result.lastID, slug });
    } catch (err) {
      console.error('Article create', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// Daily news
app.post(
  '/api/admin/news',
  requireAdmin,
  [body('content').isLength({ min: 5 })],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    try {
      await run('UPDATE daily_news SET is_published = 0');
      await run(
        'INSERT INTO daily_news (content, is_published, admin_id, created_at, updated_at) VALUES (?, 1, ?, datetime(\"now\"), datetime(\"now\"))',
        [req.body.content, req.session.user.id]
      );
      return res.json({ success: true });
    } catch (err) {
      console.error('News post', err);
      return res.status(500).json({ success: false });
    }
  }
);

app.get('/api/news/latest', async (req, res) => {
  try {
    const news = await get(
      `SELECT id, content, updated_at FROM daily_news WHERE is_published = 1 ORDER BY updated_at DESC LIMIT 1`
    );
    return res.json({ success: true, news });
  } catch (err) {
    console.error('News fetch', err);
    return res.status(500).json({ success: false });
  }
});

// Weekly digest
app.post('/api/admin/digest/generate', requireAdmin, async (req, res) => {
  try {
    const content = await buildDigestHtml();
    return res.json({ success: true, content });
  } catch (err) {
    console.error('digest generate', err);
    return res.status(500).json({ success: false });
  }
});

app.post('/api/admin/digest/publish', requireAdmin, async (req, res) => {
  try {
    const content = req.body.content || (await buildDigestHtml());
    await run('INSERT INTO weekly_digest (content, published, created_at) VALUES (?, 1, datetime("now"))', [content]);
    // optional email blast
    const enabled = (await getSetting('digest_email_enabled', 'false')) === 'true';
    if (enabled && process.env.SMTP_HOST) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      const subs = await all('SELECT email FROM newsletter_emails');
      const emails = subs.map((s) => s.email).filter(Boolean);
      if (emails.length) {
        await transporter.sendMail({
          from: `"Equity Investor Club" <${process.env.SMTP_USER}>`,
          bcc: emails,
          subject: 'Weekly Learning Digest',
          html: content,
        });
      }
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('digest publish', err);
    return res.status(500).json({ success: false });
  }
});

app.get('/api/digest/latest', async (req, res) => {
  try {
    const latest = await get(
      `SELECT id, content, created_at FROM weekly_digest WHERE published = 1 ORDER BY created_at DESC LIMIT 1`
    );
    const archive = await all(
      `SELECT id, created_at FROM weekly_digest WHERE published = 1 ORDER BY created_at DESC LIMIT 20 OFFSET 1`
    );
    return res.json({ success: true, latest, archive });
  } catch (err) {
    console.error('digest latest', err);
    return res.status(500).json({ success: false });
  }
});

// Stock search
app.get('/api/stocks/search', async (req, res) => {
  await ensureStockCache();
  const enableNse = (await getSetting('enable_nse', 'true')) === 'true';
  const enableBse = (await getSetting('enable_bse', 'true')) === 'true';
  const results = filterStocks(req.query.q || '', 15, { nse: enableNse, bse: enableBse });
  return res.json({ success: true, results });
});

// Admin: refresh stock master
app.post('/api/admin/stocks/refresh', requireAdmin, async (req, res) => {
  try {
    await refreshStockMaster();
    return res.json({ success: true });
  } catch (err) {
    console.error('stocks refresh', err);
    return res.status(500).json({ success: false });
  }
});

app.get('/api/admin/stocks/stats', requireAdmin, async (req, res) => {
  try {
    const total = await get('SELECT COUNT(*) as c FROM stock_master WHERE active = 1');
    const nse = await get(`SELECT COUNT(*) as c FROM stock_master WHERE active = 1 AND exchange = 'NSE'`);
    const bse = await get(`SELECT COUNT(*) as c FROM stock_master WHERE active = 1 AND exchange = 'BSE'`);
    const last = await getSetting('stocks_last_refresh', 'Not refreshed yet');
    return res.json({ success: true, total: total.c, nse: nse.c, bse: bse.c, last });
  } catch (err) {
    console.error('stock stats', err);
    return res.status(500).json({ success: false });
  }
});

// Educational stock report (uses master validation, no prices)
app.post(
  '/api/report/stock',
  requireAuth,
  [body('symbol').isString(), body('exchange').isString()],
  async (req, res) => {
    await ensureStockCache();
    const { symbol, exchange } = req.body;
    const match = stockCache.find(
      (s) => s.symbol.toLowerCase() === symbol.toLowerCase() && s.exchange.toUpperCase() === exchange.toUpperCase()
    );
    if (!match) return res.status(400).json({ success: false, message: 'Invalid stock selection' });
    // Access control: subscription or promo
    const sub = await ensureSubscriptionFresh(req.session.user.id);
    const promoCode = (req.body.promo || '').trim();
    const promoValid = isPromoValid(promoCode);
    if (!sub.active && !promoValid) {
      const basic = basicStockInfo(symbol);
      if (promoCode) {
        return res.status(403).json({ success: false, message: 'Invalid or expired promo code.', basic });
      }
      return res.status(403).json({
        success: false,
        message: 'Premium feature. To unlock advanced analysis, please contact:\n📩 equityinvestorclub@gmail.com',
        basic,
      });
    }
    const sector = match.sector || 'Not available';
    return res.json({
      success: true,
      stock: {
        name: match.stock_name,
        symbol: match.symbol,
        exchange: match.exchange,
        sector,
        disclaimer:
          'Equity Investor Club is not a SEBI registered advisor. All content is for educational purposes only. Do your own analysis before investing.',
      },
      summary: {
        what_it_does:
          'This stock is part of the Indian listed universe. Learn about its business model, sector role, and typical risk factors using publicly available information.',
        note: 'This is an educational report. No prices, signals, or recommendations are provided.',
      },
    });
  }
);

app.get('/api/articles', async (req, res) => {
  try {
    const list = await all(
      `SELECT id, title, slug, substr(content,1,200) as excerpt, publish_at FROM articles
       WHERE is_active = 1 AND datetime(publish_at) <= datetime('now')
       ORDER BY publish_at DESC`
    );
    return res.json({ success: true, articles: list });
  } catch (err) {
    console.error('Articles list', err);
    return res.status(500).json({ success: false });
  }
});

// Continue learning: return next unread article respecting prereqs
app.get('/api/user/continue-learning', requireAuth, async (req, res) => {
  try {
    // last read article for user
    const last = await get(
      `SELECT content_id FROM reading_history 
       WHERE user_id = ? AND content_type = 'article' 
       ORDER BY last_read_at DESC LIMIT 1`,
      [req.session.user.id]
    );

    // list of completed/read article ids
    const readRows = await all(
      `SELECT content_id FROM reading_history WHERE user_id = ? AND content_type = 'article'`,
      [req.session.user.id]
    );
    const readIds = new Set(readRows.map((r) => r.content_id));

    // find a candidate article whose prereqs are satisfied and not read
    const candidates = await all(
      `SELECT id, title, slug, substr(content,1,180) AS excerpt 
       FROM articles 
       WHERE is_active = 1 AND datetime(publish_at) <= datetime('now')
       ORDER BY publish_at ASC`
    );

    const prereqs = await all(`SELECT article_id, prereq_slug FROM article_prereq`);
    const prereqMap = prereqs.reduce((m, row) => {
      m[row.article_id] = m[row.article_id] || [];
      m[row.article_id].push(row.prereq_slug);
      return m;
    }, {});

    function prereqsMet(article) {
      const reqs = prereqMap[article.id] || [];
      if (!reqs.length) return true;
      return reqs.every((slug) => {
        const found = candidates.find((c) => c.slug === slug);
        return found && readIds.has(found.id);
      });
    }

    let nextArticle = null;
    for (const art of candidates) {
      if (readIds.has(art.id)) continue;
      if (!prereqsMet(art)) continue;
      nextArticle = art;
      break;
    }

    if (!nextArticle) {
      return res.json({ success: true, status: 'completed' });
    }

    return res.json({
      success: true,
      status: 'pending',
      last_read_id: last ? last.content_id : null,
      next: {
        id: nextArticle.id,
        title: nextArticle.title,
        description: nextArticle.excerpt,
        slug: nextArticle.slug,
      },
    });
  } catch (err) {
    console.error('Continue learning', err);
    return res.status(500).json({ success: false });
  }
});

app.get('/articles/:slug', async (req, res) => {
  try {
    const art = await get(
      `SELECT * FROM articles WHERE slug = ? AND is_active = 1 AND datetime(publish_at) <= datetime('now')`,
      [req.params.slug]
    );
    if (!art) return res.status(404).send('Not found');
    const showForm = !!req.session.user;
    // compute read time if missing
    if (!art.read_time_minutes) {
      const plain = art.content.replace(/<[^>]+>/g, ' ');
      const minutes = calcReadMinutes(plain);
      art.read_time_minutes = minutes;
      run('UPDATE articles SET read_time_minutes = ? WHERE id = ?', [minutes, art.id]).catch(() => {});
    }
    // freshness
    const reviewedAt = await latestReview('article', art.id);
    const stale = isStale(reviewedAt);
    // sources parsing and quality
    let sources = [];
    if (art.sources_json) {
      try { sources = JSON.parse(art.sources_json); } catch (e) { sources = []; }
    }
    const sourceCount = sources.length;
    let quality = 'Low';
    if (sourceCount >= 4) quality = 'High';
    else if (sourceCount >= 2) quality = 'Medium';
    return res.send(`<html><head><title>${art.title}</title><link rel="stylesheet" href="/public/css/style.css"></head>
    <body class="content-layer">
    <main class="container section">
      <a href="/articles" class="btn btn-outline">← Back</a>
      <h1 style="margin:12px 0;">${art.title}</h1>
      <div class="badge-inline">Educational</div>
      <label class="toggle small"><input type="checkbox" id="explainToggle" /> Explain Like I'm New</label>
      <div class="small" style="margin:6px 0 12px;">⏱️ ${art.read_time_minutes} min read</div>
      <div class="read-meta">Last reviewed on: ${reviewedAt ? new Date(reviewedAt).toDateString() : 'Not recorded'}</div>
      ${stale ? '<div class="read-meta stale">This content may be outdated. Please refer to newer updates.</div>' : ''}
      <div class="read-meta">Source quality: ${quality}</div>
      ${sources.length ? `<div class="read-meta">Sources: ${sources.map((s) => `<span class="source-tag">${s}</span>`).join(' ')}</div>` : '<div class="read-meta">Sources: not specified</div>'}
      <div class="update-card" style="margin-top:12px;">${formatUpdateToHtml(art.content)}</div>
      <p class="small" style="margin-top:8px;">Sources: Moneycontrol · Bloomberg · RBI · NSE</p>
      <section class="section">
        <h3>Comments (moderated)</h3>
        <div id="articleComments" class="list"></div>
        ${showForm ? `<form id="commentForm" class="form-card" style="margin-top:10px;">
          <label>Add your learning takeaway</label>
          <textarea id="commentInput" rows="3" required></textarea>
          <button class="btn" type="submit">Submit for approval</button>
          <div id="commentAlert" class="alert" style="display:none;"></div>
        </form>` : '<p class="small">Login to share a moderated comment.</p>'}
      </section>
      <div class="disclaimer">Disclaimer:<br>
        Equity Investor Club is not a SEBI registered advisor.<br>
        All content shared on this website is for educational and learning purposes only.<br>
        Market updates are derived from publicly available news and media sources.<br>
        Users are advised to do their own analysis before making any investment decisions.<br>
        Equity Investor Club does not provide investment, trading, or financial advice.</div>
    </main>
    <script>
      const articleId = ${art.id};
      async function loadComments() {
        const res = await fetch('/api/articles/' + articleId + '/comments');
        const data = await res.json();
        const box = document.querySelector('#articleComments');
        if (!box) return;
        if (!data.comments || !data.comments.length) { box.innerHTML = '<p class=\"small\">No comments yet.</p>'; return; }
        box.innerHTML = data.comments.map(c => '<li>' + c.content + ' — ' + (c.name || 'User') + '</li>').join('');
      }
      loadComments();
      const form = document.querySelector('#commentForm');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const res = await fetch('/api/articles/' + articleId + '/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: document.querySelector('#commentInput').value })
          });
          const data = await res.json();
          const alert = document.querySelector('#commentAlert');
          if (data.success) { alert.textContent = 'Submitted for approval'; alert.className='alert success'; alert.style.display='block'; form.reset(); loadComments(); }
          else { alert.textContent = data.message || 'Failed'; alert.className='alert error'; alert.style.display='block'; }
        });
      }
    </script>
    </body></html>`);
  } catch (err) {
    console.error('Article view', err);
    return res.status(500).send('Server error');
  }
});

// Comments
app.post(
  '/api/articles/:id/comments',
  requireAuth,
  [body('content').isLength({ min: 5 })],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { content } = req.body;
    if (violatesContentRules(content)) return res.status(400).json({ success: false, message: 'Content violates rules' });
    try {
      await run('INSERT INTO comments (article_id, user_id, content, status) VALUES (?, ?, ?, ?)', [
        req.params.id,
        req.session.user.id,
        content,
        'pending',
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('Comment create', err);
      return res.status(500).json({ success: false });
    }
  }
);

app.get('/api/admin/comments/pending', requireAdmin, async (req, res) => {
  try {
    const rows = await all(
      `SELECT comments.id, comments.content, comments.created_at, comments.article_id, users.email
       FROM comments
       LEFT JOIN users ON users.id = comments.user_id
       WHERE comments.status = 'pending'
       ORDER BY comments.created_at DESC`
    );
    return res.json({ success: true, comments: rows });
  } catch (err) {
    console.error('Comments pending', err);
    return res.status(500).json({ success: false });
  }
});

app.post('/api/admin/comments/:id/approve', requireAdmin, async (req, res) => {
  try {
    await run('UPDATE comments SET status = ? WHERE id = ?', ['approved', req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Approve comment', err);
    return res.status(500).json({ success: false });
  }
});

app.post('/api/admin/comments/:id/reject', requireAdmin, async (req, res) => {
  try {
    await run('UPDATE comments SET status = ? WHERE id = ?', ['rejected', req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Reject comment', err);
    return res.status(500).json({ success: false });
  }
});

// Admin settings
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings');
    const map = {};
    rows.forEach((r) => (map[r.key] = r.value));
    return res.json({ success: true, settings: map });
  } catch (err) {
    console.error('settings fetch', err);
    return res.status(500).json({ success: false });
  }
});

app.post(
  '/api/admin/settings',
  requireAdmin,
  [
    body('news_enabled').optional().isBoolean(),
    body('disclaimer').optional().isString(),
    body('instagram').optional().isString(),
    body('inquiries_enabled').optional().isBoolean(),
    body('digest_email_enabled').optional().isBoolean(),
    body('enable_nse').optional().isBoolean(),
    body('enable_bse').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const payload = req.body;
      for (const key of ['news_enabled', 'disclaimer', 'instagram', 'inquiries_enabled', 'digest_email_enabled', 'enable_nse', 'enable_bse']) {
        if (payload[key] !== undefined) {
          await setSetting(key, String(payload[key]));
        }
      }
      // refresh cache if exchanges toggled
      stockCache = [];
      return res.json({ success: true });
    } catch (err) {
      console.error('settings save', err);
      return res.status(500).json({ success: false });
    }
  }
);

app.get('/api/articles/:id/comments', async (req, res) => {
  try {
    const rows = await all(
      `SELECT comments.id, comments.content, comments.created_at, users.name
       FROM comments
       LEFT JOIN users ON users.id = comments.user_id
       WHERE comments.article_id = ? AND comments.status = 'approved'
       ORDER BY comments.created_at DESC`,
      [req.params.id]
    );
    return res.json({ success: true, comments: rows });
  } catch (err) {
    console.error('List comments', err);
    return res.status(500).json({ success: false });
  }
});

// Subscription requests
app.post(
  '/api/subscription-request',
  requireAuth,
  [body('plan').isLength({ min: 3, max: 50 })],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { plan } = req.body;
    try {
      await run('INSERT INTO subscription_requests (user_id, plan_name, status) VALUES (?, ?, ?)', [
        req.session.user.id,
        plan,
        'pending',
      ]);
      return res.json({ success: true });
    } catch (err) {
      console.error('subscription request', err);
      return res.status(500).json({ success: false, message: 'Could not submit request' });
    }
  }
);

app.get('/api/admin/subscriptions', requireAdmin, async (req, res) => {
  try {
    const rows = await all(
      `SELECT sr.id, sr.plan_name, sr.status, sr.requested_at, u.name, u.email
       FROM subscription_requests sr
       LEFT JOIN users u ON u.id = sr.user_id
       ORDER BY sr.requested_at DESC`
    );
    return res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('sub list', err);
    return res.status(500).json({ success: false });
  }
});

app.post('/api/admin/subscriptions/:id/approve', requireAdmin, async (req, res) => {
  try {
    const reqRow = await get('SELECT user_id FROM subscription_requests WHERE id = ?', [req.params.id]);
    if (!reqRow) return res.status(404).json({ success: false });
    await run('UPDATE subscription_requests SET status = ? WHERE id = ?', ['approved', req.params.id]);
    await run('UPDATE users SET subscription_active = 1 WHERE id = ?', [reqRow.user_id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('approve sub', err);
    return res.status(500).json({ success: false });
  }
});

app.post('/api/admin/subscriptions/:id/reject', requireAdmin, async (req, res) => {
  try {
    await run('UPDATE subscription_requests SET status = ? WHERE id = ?', ['rejected', req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('reject sub', err);
    return res.status(500).json({ success: false });
  }
});

// Newsletter
app.post('/api/newsletter', [body('email').isEmail()], async (req, res) => {
  const validationError = handleValidation(req, res);
  if (validationError) return;
  const key = `newsletter:${req.ip}`;
  if (!rateLimit(key, 5, 60_000)) return res.status(429).json({ success: false, message: 'Too many attempts, please wait.' });
  try {
    await run('INSERT INTO newsletter_emails (email) VALUES (?)', [req.body.email]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Newsletter', err);
    return res.status(400).json({ success: false, message: 'Already subscribed?' });
  }
});

// Analytics stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const totalUsers = await get('SELECT COUNT(*) as c FROM users');
    const activeUsers = await get(
      `SELECT COUNT(DISTINCT user_id) as c FROM logs WHERE action = 'login' AND datetime(timestamp) >= datetime('now','-7 days')`
    );
    const pages = await all(
      `SELECT path, COUNT(*) as c FROM analytics WHERE datetime(created_at) >= datetime('now','-30 days') GROUP BY path ORDER BY c DESC LIMIT 5`
    );
    return res.json({
      success: true,
      stats: {
        totalUsers: totalUsers.c,
        activeUsers: activeUsers.c,
        topPages: pages,
      },
    });
  } catch (err) {
    console.error('Stats', err);
    return res.status(500).json({ success: false });
  }
});

// Active users live
app.get('/api/active-users', (req, res) => {
  return res.json({ success: true, count: activeSessions.size });
});

// Certificate generation
app.get('/api/certificate', requireAuth, async (req, res) => {
  const name = req.session.user.name || 'Learner';
  const moduleName = req.query.module || 'Basics of Stock Market';
  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 396]);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const normal = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText('Equity Investor Club', { x: 40, y: 330, size: 18, font, color: rgb(0.49, 0.94, 1) });
    page.drawText('Completion Certificate', { x: 40, y: 300, size: 16, font, color: rgb(1, 0.48, 0.82) });
    page.drawText(`This certifies that ${name}`, { x: 40, y: 260, size: 14, font: normal, color: rgb(1,1,1) });
    page.drawText(`has completed the module: ${moduleName}`, { x: 40, y: 235, size: 12, font: normal, color: rgb(1,1,1) });
    page.drawText('Educational purpose only. No investment advice is provided.', { x: 40, y: 200, size: 10, font: normal, color: rgb(0.7,0.78,0.92) });
    page.drawText('Date: ' + new Date().toLocaleDateString(), { x: 40, y: 175, size: 10, font: normal, color: rgb(0.7,0.78,0.92) });
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=\"certificate.pdf\"');
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Certificate', err);
    return res.status(500).json({ success: false });
  }
});
// Daily quote
app.get('/api/quote/latest', async (req, res) => {
  try {
    const row = await get(
      `SELECT dq.id, dq.content, dq.publish_at, dq.created_at, u.name as author_name
       FROM daily_quote dq
       LEFT JOIN users u ON u.id = dq.created_by
       WHERE dq.is_active = 1 AND datetime(dq.publish_at) <= datetime('now')
       ORDER BY dq.publish_at DESC
       LIMIT 1`
    );
    return res.json({ success: true, quote: row || null });
  } catch (err) {
    console.error('Quote fetch', err);
    return res.status(500).json({ success: false });
  }
});

app.post(
  '/api/admin/quote',
  requireAdmin,
  [
    body('content').isLength({ min: 3 }),
    body('publish_at').optional().isISO8601().toDate(),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { content, publish_at } = req.body;
    try {
      await run('UPDATE daily_quote SET is_active = 0 WHERE is_active = 1');
      const result = await run(
        'INSERT INTO daily_quote (content, created_by, publish_at, is_active) VALUES (?, ?, ?, 1)',
        [content, req.session.user.id, publish_at || new Date().toISOString()]
      );
      return res.json({ success: true, id: result.lastID });
    } catch (err) {
      console.error('Quote save', err);
      return res.status(500).json({ success: false });
    }
  }
);

// Weekly summary
app.get('/api/weekly/latest', async (req, res) => {
  try {
    const row = await get(
      `SELECT ws.id, ws.content, ws.publish_at, ws.created_at, u.name as author_name
       FROM weekly_summary ws
       LEFT JOIN users u ON u.id = ws.created_by
       WHERE ws.is_active = 1 AND datetime(ws.publish_at) <= datetime('now')
         AND datetime(ws.publish_at) >= datetime('now', '-7 days')
       ORDER BY ws.publish_at DESC
       LIMIT 1`
    );
    return res.json({ success: true, summary: row || null });
  } catch (err) {
    console.error('Weekly fetch', err);
    return res.status(500).json({ success: false });
  }
});

app.post(
  '/api/admin/weekly',
  requireAdmin,
  [
    body('content').isLength({ min: 20 }),
    body('publish_at').optional().isISO8601().toDate(),
  ],
  async (req, res) => {
    const validationError = handleValidation(req, res);
    if (validationError) return;
    const { content, publish_at } = req.body;
    try {
      await run('UPDATE weekly_summary SET is_active = 0 WHERE is_active = 1');
      const result = await run(
        'INSERT INTO weekly_summary (content, created_by, publish_at, is_active) VALUES (?, ?, ?, 1)',
        [content, req.session.user.id, publish_at || new Date().toISOString()]
      );
      return res.json({ success: true, id: result.lastID });
    } catch (err) {
      console.error('Weekly save', err);
      return res.status(500).json({ success: false });
    }
  }
);

// Content history
app.get('/api/admin/history', requireAdmin, async (req, res) => {
  try {
    const updates = await all(
      `SELECT id, content, publish_at, created_at FROM daily_updates WHERE datetime(publish_at) >= datetime('now','-7 days') ORDER BY publish_at DESC`
    );
    const summaries = await all(
      `SELECT id, content, publish_at, created_at FROM weekly_summary WHERE datetime(publish_at) >= datetime('now','-30 days') ORDER BY publish_at DESC`
    );
    return res.json({ success: true, updates, summaries });
  } catch (err) {
    console.error('History', err);
    return res.status(500).json({ success: false });
  }
});

// Payments: create order (auth required)
app.post('/api/payments/create', requireAuth, [body('plan_key').isString()], async (req, res) => {
  if (!razorpay) return res.status(500).json({ success: false, message: 'Payments not configured' });
  const { plan_key } = req.body;
  const plan = PLANS[plan_key];
  if (!plan) return res.status(400).json({ success: false, message: 'Invalid plan' });
  try {
    const order = await razorpay.orders.create({
      amount: plan.amount,
      currency: plan.currency,
      receipt: `sub_${req.session.user.id}_${Date.now()}`,
      notes: { plan_key },
    });
    await run(
      'INSERT INTO subscription_payments (user_id, plan_key, order_id, amount, currency, status) VALUES (?, ?, ?, ?, ?, ?)',
      [req.session.user.id, plan.key, order.id, plan.amount, plan.currency, 'created']
    );
    return res.json({
      success: true,
      order_id: order.id,
      plan_key: plan.key,
      key_id: process.env.RAZORPAY_KEY_ID,
      description: 'Educational access subscription',
      name: 'Equity Investor Club',
      currency: plan.currency,
    });
  } catch (err) {
    console.error('create payment', err);
    return res.status(500).json({ success: false, message: 'Could not start payment' });
  }
});

// Razorpay webhook (must be raw body)
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(500).send('Missing webhook secret');
  const signature = req.headers['x-razorpay-signature'];
  if (!signature || typeof signature !== 'string') return res.status(400).send('Missing signature');
  const body = req.body;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
    return res.status(400).send('Invalid signature');
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (e) {
    return res.status(400).send('Bad payload');
  }
  const event = payload.event;
  if (event !== 'payment.captured' && event !== 'order.paid') {
    return res.status(200).send('Ignored');
  }
  const payment = payload.payload?.payment?.entity || payload.payload?.order?.entity;
  const orderId = payment?.order_id || payment?.id;
  const paymentId = payment?.id;
  if (!orderId) return res.status(400).send('Missing order');
  try {
    const row = await get('SELECT id, user_id, plan_key FROM subscription_payments WHERE order_id = ?', [orderId]);
    if (!row) return res.status(404).send('Order not found');
    await run('UPDATE subscription_payments SET status = ?, payment_id = ? WHERE id = ?', ['paid', paymentId, row.id]);
    await activateSubscription(row.user_id, row.plan_key);
    return res.status(200).send('OK');
  } catch (err) {
    console.error('webhook process', err);
    return res.status(500).send('Server error');
  }
});
// Fallback 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'views', '404.html'));
});

async function ensureAdminUser() {
  const adminEmail = process.env.ADMIN_SEED_EMAIL;
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.warn(
      '[security] Admin seeding skipped. Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD to auto-create an admin account.'
    );
    return;
  }
  const existing = await get('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (existing) return;
  const password_hash = await hashPassword(adminPassword);
  await run('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)', [
    'Site Admin',
    adminEmail,
    password_hash,
    'admin',
    'active',
  ]);
  console.log('Seeded admin account:', adminEmail);
}

async function bootstrap() {
  await init();
  await ensureAdminUser();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Equity Investor Club server running on http://localhost:${PORT}`));
}

bootstrap();
// Complete article and suggest next
app.post('/api/user/complete-article', requireAuth, [body('article_id').isInt()], async (req, res) => {
  const validationError = handleValidation(req, res);
  if (validationError) return;
  const { article_id } = req.body;
  try {
    // mark as completed in reading_history
    await run(
      `INSERT INTO reading_history (user_id, content_type, content_id, last_read_at, progress)
       VALUES (?, 'article', ?, datetime('now'), 1)
       ON CONFLICT(user_id, content_type, content_id)
       DO UPDATE SET last_read_at = excluded.last_read_at, progress = 1`,
      [req.session.user.id, article_id]
    );

    // gather read set
    const readRows = await all(
      `SELECT content_id FROM reading_history WHERE user_id = ? AND content_type = 'article'`,
      [req.session.user.id]
    );
    const readIds = new Set(readRows.map((r) => r.content_id));

    // fetch articles ordered by publish
    const articles = await all(
      `SELECT id, title, slug, content, read_time_minutes FROM articles
       WHERE is_active = 1 AND datetime(publish_at) <= datetime('now')
       ORDER BY publish_at ASC`
    );

    const prereqs = await all(`SELECT article_id, prereq_slug FROM article_prereq`);
    const prereqMap = prereqs.reduce((m, row) => {
      m[row.article_id] = m[row.article_id] || [];
      m[row.article_id].push(row.prereq_slug);
      return m;
    }, {});

    function prereqsMet(article) {
      const reqs = prereqMap[article.id] || [];
      if (!reqs.length) return true;
      return reqs.every((slug) => {
        const found = articles.find((c) => c.slug === slug);
        return found && readIds.has(found.id);
      });
    }

    let next = null;
    for (const art of articles) {
      if (readIds.has(art.id)) continue;
      if (!prereqsMet(art)) continue;
      // compute read time if missing
      let minutes = art.read_time_minutes;
      if (!minutes) {
        const plain = (art.content || '').replace(/<[^>]+>/g, ' ');
        minutes = calcReadMinutes(plain);
        run('UPDATE articles SET read_time_minutes = ? WHERE id = ?', [minutes, art.id]).catch(() => {});
      }
      next = { id: art.id, title: art.title, slug: art.slug, read_time_minutes: minutes || 1 };
      break;
    }

    if (!next) return res.json({ success: true, status: 'path_completed' });
    return res.json({ success: true, next });
  } catch (err) {
    console.error('complete article', err);
    return res.status(500).json({ success: false });
  }
});
