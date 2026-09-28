const crypto = require('crypto');

const COOKIE_NAME = 'dp_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

const SECRET = process.env.APP_SECRET;
const PASSWORD = process.env.APP_PASSWORD;

if (!SECRET) {
  throw new Error('APP_SECRET não definido — veja .env.example.');
}
if (!PASSWORD) {
  throw new Error('APP_PASSWORD não definido — veja .env.example.');
}

function sign(value) {
  const hmac = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  return `${value}.${hmac}`;
}

function verify(signed) {
  if (!signed || typeof signed !== 'string') return false;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return false;
  const value = signed.slice(0, idx);
  const hmac = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  const a = Buffer.from(hmac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Comparação em tempo constante, tolerante a senha candidata de outro tamanho. */
function checkPassword(candidate) {
  const a = Buffer.from(String(candidate ?? ''), 'utf8');
  const b = Buffer.from(PASSWORD, 'utf8');
  const len = Math.max(a.length, b.length, 1);
  const aPadded = Buffer.concat([a, Buffer.alloc(len - a.length)]);
  const bPadded = Buffer.concat([b, Buffer.alloc(len - b.length)]);
  return a.length === b.length && crypto.timingSafeEqual(aPadded, bPadded);
}

function issueSessionCookie(res) {
  res.cookie(COOKIE_NAME, sign('ok'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function requireAuth(req, res, next) {
  if (verify(req.cookies && req.cookies[COOKIE_NAME])) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

module.exports = {
  COOKIE_NAME,
  checkPassword,
  issueSessionCookie,
  requireAuth,
  verifyToken: verify,
};
