const { randomBytes, createHash, scrypt: scryptCallback, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
const { id, now, fail, text } = require('./domain');
const scrypt = promisify(scryptCallback);
const COOKIE = 'literature_session';
const hashToken = value => createHash('sha256').update(value).digest('hex');

async function passwordHash(password) {
  text(password, 200, true);
  if (password.length < 10) fail('密码至少需要 10 个字符');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}
async function verify(password, stored) {
  const [salt, encoded] = stored.split(':');
  const derived = await scrypt(password, salt, 64);
  return timingSafeEqual(derived, Buffer.from(encoded, 'hex'));
}
function cookieToken(req) {
  const cookie = (req.headers.cookie || '').split(';').find(value => value.trim().startsWith(`${COOKIE}=`));
  return cookie ? cookie.trim().slice(COOKIE.length + 1) : '';
}
function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-literature-request'] !== '1') return res.status(403).json({ success: false, error: '请求校验失败' });
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      const allowed = (process.env.LITERATURE_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
      const sameHost = origin.host === req.get('host');
      const localDev = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(origin.hostname) && ['localhost', '127.0.0.1'].includes(req.hostname);
      if (!sameHost && !localDev && !allowed.includes(origin.origin)) return res.status(403).json({ success: false, error: '来源不被允许' });
    } catch { return res.status(403).json({ success: false, error: '来源格式错误' }); }
  }
  next();
}

function createAuth(store) {
  const publicUser = user => ({ id: user.id, username: user.username, role: user.role });
  const sessionCookie = (res, token, age = 7 * 86400) => res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.LITERATURE_SECURE_COOKIE === 'true', path: '/api/literature', maxAge: age * 1000 });
  async function session(req) {
    const token = cookieToken(req);
    if (!token || token.length !== 64) return null;
    return store.read(sql => sql.get('SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', [hashToken(token), Date.now()]));
  }
  async function requireUser(req, res, next) {
    try {
      const user = await session(req);
      if (!user) return res.status(401).json({ success: false, error: '请先登录小说工作区' });
      req.literatureUser = user;
      next();
    } catch (error) { next(error); }
  }
  async function register(req, res) {
    const username = text(req.body.username, 80, true);
    const password_hash = await passwordHash(req.body.password);
    const user = await store.write(async sql => {
      const count = (await sql.get('SELECT count(*) AS n FROM users')).n;
      if (count > 0) fail('账户初始化已完成，请由管理员创建账户', 403);
      if (process.env.NODE_ENV === 'production' && (!process.env.LITERATURE_SETUP_KEY || req.body.setupKey !== process.env.LITERATURE_SETUP_KEY)) fail('需要服务器配置的初始化口令', 403);
      const record = { id: id(), username, role: 'admin' };
      await sql.run('INSERT INTO users VALUES (?,?,?,?,?)', [record.id, username, password_hash, record.role, now()]);
      return record;
    });
    await loginSession(user, res);
    res.json({ success: true, data: publicUser(user) });
  }
  async function loginSession(user, res) {
    const token = randomBytes(32).toString('hex');
    await store.write(async sql => {
      await sql.run('DELETE FROM sessions WHERE expires_at<?', [Date.now()]);
      await sql.run('INSERT INTO sessions VALUES (?,?,?)', [hashToken(token), user.id, Date.now() + 7 * 86400 * 1000]);
    });
    sessionCookie(res, token);
  }
  async function login(req, res) {
    const username = text(req.body.username, 80, true);
    text(req.body.password, 200, true);
    const password = req.body.password;
    const user = await store.read(sql => sql.get('SELECT * FROM users WHERE username=?', [username]));
    // Use a real scrypt operation on misses, too, to limit username timing disclosure.
    const fallback = `00000000000000000000000000000000:${'0'.repeat(128)}`;
    const valid = await verify(password, user?.password_hash || fallback);
    if (!user || !valid) fail('用户名或密码不正确', 401);
    await loginSession(user, res);
    res.json({ success: true, data: publicUser(user) });
  }
  async function logout(req, res) {
    await store.write(sql => sql.run('DELETE FROM sessions WHERE token_hash=?', [hashToken(cookieToken(req))]));
    sessionCookie(res, '', 0);
    res.json({ success: true });
  }
  async function me(req, res) {
    const user = await session(req);
    const count = await store.read(sql => sql.get('SELECT count(*) AS n FROM users'));
    res.json({ success: true, data: { user, needsSetup: count.n === 0 } });
  }
  async function createUser(req, res) {
    if (req.literatureUser.role !== 'admin') fail('需要管理员权限', 403);
    const username = text(req.body.username, 80, true);
    const password_hash = await passwordHash(req.body.password);
    const user = { id: id(), username, role: 'author' };
    await store.write(sql => sql.run('INSERT INTO users VALUES (?,?,?,?,?)', [user.id, username, password_hash, user.role, now()]));
    res.json({ success: true, data: user });
  }
  return { requireUser, register, login, logout, me, createUser };
}
module.exports = { createAuth, originGuard };
