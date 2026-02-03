const bcrypt = require('bcrypt');

const SALT_ROUNDS = 11;
const rawPepper = process.env.PEPPER || 'eic_pepper_fallback';
if (process.env.NODE_ENV === 'production' && rawPepper === 'eic_pepper_fallback') {
  throw new Error('PEPPER environment variable is required in production.');
}
if (rawPepper === 'eic_pepper_fallback') {
  console.warn('[security] PEPPER not set; using fallback value. Set PEPPER for stronger password hashing.');
}
const PEPPER = rawPepper;

// Secure hashing with pepper; bcrypt already salts uniquely per hash.
async function hashPassword(password) {
  return bcrypt.hash(password + PEPPER, SALT_ROUNDS);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password + PEPPER, hash);
}

async function compareWithUpgrade(password, user, run) {
  // Try new peppered hash first
  const modern = await comparePassword(password, user.password_hash);
  if (modern) return { ok: true, upgraded: false };

  // Fallback: legacy hash without pepper -> if matches, rehash+upgrade
  const legacyMatch = await bcrypt.compare(password, user.password_hash);
  if (legacyMatch) {
    const newHash = await hashPassword(password);
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
    return { ok: true, upgraded: true };
  }
  return { ok: false, upgraded: false };
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ success: false, message: 'Authentication required' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).json({ success: false, message: 'Admin only' });
}

module.exports = { hashPassword, comparePassword, compareWithUpgrade, requireAuth, requireAdmin };
