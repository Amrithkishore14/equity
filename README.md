# Equity Investor Club

Static-first, multi-page finance education site with Express + SQLite auth and admin dashboard.

## Stack
- Node.js + Express
- SQLite (file-based)
- Session auth with `express-session` + `connect-sqlite3`
- Password hashing with `bcrypt`
- HTML/CSS/vanilla JS (no React/SPAs)

## Features
- Public pages: Home, About, Services, Contact
- Auth pages: Login, Register, Forgot Password
- User dashboard: view profile, change password
- Admin dashboard: manage users (CRUD, activate/deactivate, reset password) + view login logs
- Optional admin seeding via `ADMIN_SEED_EMAIL` + `ADMIN_SEED_PASSWORD`
- Dark/light toggle (front-end)
- Daily Market Update: single active admin-posted update displayed on homepage (preview for guests) and full view for logged-in users
- Animated neon background + responsive mobile nav
- Contact form emails via SMTP (configurable)
- Passwords hashed with bcrypt + app pepper, legacy hashes auto-upgrade on next login
- Learning hub (/learn), glossary (/glossary), founder page (/founder)
- Daily quote, weekly summary, polls, articles, newsletter capture
- SIP calculator, risk profile quiz, videos, downloads, certificate generation (PDF via pdf-lib)
- Admin: schedule publish dates, content history, stats (users/active/top pages), comment moderation, poll/article creation

## Setup
1. Install Node 18+: `npm install`
2. Run dev: `npm run dev` (nodemon) or prod: `npm start`
3. The app listens on `http://localhost:3000` by default.
4. Environment variables:
   - `SESSION_SECRET` **(required in production)** — session signing secret
   - `PEPPER` **(required in production)** — extra secret mixed into password hashes
   - `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` — seed an initial admin if none exists
   - `PORT=3000`
   - SMTP for contact form:
     - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
     - `MAIL_TO` (recipient, defaults to SMTP_USER)
   - Optional Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`

Database files (`database.sqlite`, `server/sessions.sqlite`) are created on first run.

### SQL schema (auto-created)
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  ip TEXT,
  role TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS daily_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY(created_by) REFERENCES users(id)
);
```

## File structure
```
public/
  css/style.css
  js/{main.js,auth.js,admin.js,user.js}
  images/logo.jpg
views/
  index.html, about.html, services.html, contact.html,
  login.html, register.html, forgot-password.html,
  admin.html, user.html
server/
  server.js, db.js, auth.js
```

## Notes
- This is a traditional multi-page app; no client-side routing.
- Contact form is front-end only (no email service wired).
- Logs capture login and password change events with IP when available.
