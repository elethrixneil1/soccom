process.env.TZ = process.env.TZ || 'Asia/Manila'; // schedule times follow this timezone
const express = require('express'), session = require('cookie-session'), bcrypt = require('bcryptjs');
const crypto = require('crypto'), fs = require('fs'), path = require('path');

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'db.json');
fs.mkdirSync(path.dirname(FILE), { recursive: true });
const tempPw = () => Array.from(crypto.randomBytes(8), x => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join('');
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const order = s => ((s.day + 1) % 7) * 1440 + +s.time.slice(0, 2) * 60 + +s.time.slice(3);
const fmtT = t => { const [h, m] = t.split(':').map(Number); return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };
const weekKey = () => { const x = new Date(); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + (6 - x.getDay() + 7) % 7); return iso(x); };

let db;
if (fs.existsSync(FILE)) db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
else {
  const pw = process.env.ADMIN_PASSWORD || tempPw();
  db = { users: [{ username: 'admin', hash: bcrypt.hashSync(pw, 10), role: 'admin', available: true, mustChange: true }],
    settings: { genDay: 5, roles: ['PC & PTZ Control', 'PTZ Control', 'PPT'],
      slots: [{ day: 6, time: '17:30' }, { day: 0, time: '06:00' }, { day: 0, time: '08:00' }, { day: 0, time: '16:00' }, { day: 0, time: '17:30' }] },
    schedules: {} };
  console.log(`First run. Sign in as "admin" with password: ${pw}`);
}
db.cleared = db.cleared || {};
const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); };
save();

// Rotation: fewest slots this week, then fewest times in this role (last 8 weeks), then least overall; random tie-break.
function generate(key) {
  const S = db.settings, slots = [...S.slots].sort((a, b) => order(a) - order(b));
  const members = db.users.filter(u => u.role === 'user' && u.available).map(u => u.username);
  // Rest rule: anyone scheduled the previous week sits this week out (unless 'allowRepeat' is on and there are not enough members).
  const pd = new Date(key + 'T00:00'); pd.setDate(pd.getDate() - 7);
  const last = new Set(); ((db.schedules[iso(pd)] || {}).slots || []).forEach(s => Object.values(s.assign).forEach(u => u && last.add(u)));
  const past = Object.keys(db.schedules).filter(k => k < key).sort().slice(-8), tot = {}, rc = {}, prev = {};
  past.forEach((k, i) => db.schedules[k].slots.forEach(s => Object.entries(s.assign).forEach(([r, u]) => {
    if (!u) return; tot[u] = (tot[u] || 0) + 1; (rc[u] = rc[u] || {})[r] = (rc[u][r] || 0) + 1;
    if (i === past.length - 1) prev[s.time + '|' + r] = u; })));
  const wk = {};
  db.schedules[key] = { created: iso(new Date()), slots: slots.map(s => {
    const taken = new Set(), assign = {};
    S.roles.forEach(r => {
      let best = null, bs = 1e9;
      members.filter(u => !taken.has(u) && (S.allowRepeat || !last.has(u))).forEach(u => {
        const sc = (wk[u] || 0) * 10 + ((rc[u] || {})[r] || 0) * 3 + (tot[u] || 0) * .5 + (prev[s.time + '|' + r] === u ? 5 : 0) + (last.has(u) ? 50 : 0) + Math.random();
        if (sc < bs) { bs = sc; best = u; } });
      assign[r] = best; if (best) { taken.add(best); wk[best] = (wk[best] || 0) + 1; } });
    return { day: s.day, time: s.time, assign }; }) };
  delete db.cleared[key]; save();
  return db.schedules[key].slots.reduce((n, s) => n + Object.values(s.assign).filter(u => !u).length, 0);
}
// Runs hourly: creates the coming weekend's schedule once the configured day (default Friday) arrives.
function auto() {
  const k = weekKey(), left = (6 - new Date().getDay() + 7) % 7;
  if (!db.schedules[k] && !db.cleared[k] && left <= (6 - db.settings.genDay + 7) % 7) { generate(k); console.log('Auto-generated schedule for', k); }
}
auto(); setInterval(auto, 3600e3);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(session({ name: 'socom', keys: [process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')],
  maxAge: 7 * 864e5, httpOnly: true, sameSite: 'lax' }));
app.use(express.static(path.join(__dirname, 'public')));

const api = express.Router();
const wrap = f => (req, res, next) => Promise.resolve(f(req, res, next)).catch(e => { console.error(e); res.status(500).json({ error: 'Server error.' }); });
const bad = (res, m, c = 400) => res.status(c).json({ error: m });
const tries = new Map();

api.post('/login', wrap(async (req, res) => {
  const t = tries.get(req.ip) || { n: 0, at: Date.now() };
  if (Date.now() - t.at > 9e5) { t.n = 0; t.at = Date.now(); }
  if (t.n >= 10) return bad(res, 'Too many attempts. Try again in 15 minutes.', 429);
  const { username, password } = req.body || {};
  const u = db.users.find(x => x.username.toLowerCase() === String(username || '').toLowerCase());
  if (!u || !(await bcrypt.compare(String(password || ''), u.hash))) { t.n++; tries.set(req.ip, t); return bad(res, 'Wrong username or password.', 401); }
  tries.delete(req.ip); req.session = { u: u.username }; res.json({ ok: true });
}));

api.use((req, res, next) => {
  const u = db.users.find(x => x.username === (req.session && req.session.u));
  if (!u) return bad(res, 'Please sign in.', 401);
  if (u.mustChange && !['/password', '/state', '/logout'].includes(req.path)) return bad(res, 'Change your password first.', 403);
  req.me = u; next();
});
const admin = (req, res, next) => req.me.role === 'admin' ? next() : bad(res, 'Admins only.', 403);
const pub = ({ hash, ...u }) => u;

api.post('/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
api.get('/state', (req, res) => res.json({ me: pub(req.me), settings: db.settings, schedules: db.schedules,
  users: req.me.role === 'admin' ? db.users.map(pub) : [] }));

api.post('/password', wrap(async (req, res) => {
  const p = String((req.body || {}).password || '');
  if (p.length < 6 || p.length > 100) return bad(res, 'Password must be 6 to 100 characters.');
  req.me.hash = await bcrypt.hash(p, 10); req.me.mustChange = false; save(); res.json({ ok: true });
}));
api.post('/availability', (req, res) => { req.me.available = !!(req.body || {}).available; save(); res.json({ ok: true }); });

api.post('/users', admin, wrap(async (req, res) => {
  const { username, role } = req.body || {};
  if (!/^[A-Za-z0-9._-]{2,30}$/.test(username || '')) return bad(res, 'Username: 2 to 30 letters, numbers, dot, dash or underscore.');
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return bad(res, 'That username already exists.');
  const password = tempPw();
  db.users.push({ username, hash: await bcrypt.hash(password, 10), role: role === 'admin' ? 'admin' : 'user', available: true, mustChange: true });
  save(); res.json({ password });
}));
api.post('/users/:u/reset', admin, wrap(async (req, res) => {
  const u = db.users.find(x => x.username === req.params.u); if (!u) return bad(res, 'Member not found.', 404);
  const password = tempPw(); u.hash = await bcrypt.hash(password, 10); u.mustChange = true; save(); res.json({ password });
}));
api.delete('/users/:u', admin, (req, res) => {
  if (req.params.u === req.me.username) return bad(res, 'You cannot remove yourself.');
  db.users = db.users.filter(x => x.username !== req.params.u); save(); res.json({ ok: true });
});

api.put('/settings', admin, (req, res) => {
  const { genDay, roles, slots, allowRepeat } = req.body || {};
  if (!Number.isInteger(genDay) || genDay < 0 || genDay > 6) return bad(res, 'Invalid day.');
  if (!Array.isArray(roles) || !roles.length || roles.length > 10 || roles.some(r => typeof r !== 'string' || !r.trim() || r.length > 40)) return bad(res, 'Add 1 to 10 roles.');
  if (!Array.isArray(slots) || !slots.length || slots.length > 20 || slots.some(s => !Number.isInteger(s.day) || s.day < 0 || s.day > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time))) return bad(res, 'Check the time slots.');
  db.settings = { genDay, allowRepeat: !!allowRepeat, roles: roles.map(r => r.trim()), slots: slots.map(s => ({ day: s.day, time: s.time })) }; save(); res.json({ ok: true });
});
api.post('/schedule/generate', admin, (req, res) => {
  const key = (req.body || {}).key; if (!/^\d{4}-\d\d-\d\d$/.test(key || '')) return bad(res, 'Invalid week.');
  res.json({ ok: true, unfilled: generate(key) });
});
api.put('/schedule/:key/cell', admin, (req, res) => {
  const s = db.schedules[req.params.key], { i, role, user } = req.body || {};
  if (!s || !s.slots[i] || !db.settings.roles.includes(role)) return bad(res, 'Invalid cell.');
  if (user && !db.users.some(u => u.username === user)) return bad(res, 'Unknown member.');
  s.slots[i].assign[role] = user || null; save(); res.json({ ok: true });
});

api.delete('/schedule/:key', admin, (req, res) => {
  delete db.schedules[req.params.key]; db.cleared[req.params.key] = true; save(); res.json({ ok: true });
});
api.get('/schedule/:key/docx', wrap(async (req, res) => {
  const s = db.schedules[req.params.key]; if (!s) return bad(res, 'No schedule for that week.', 404);
  const D = require('docx'), roles = db.settings.roles, W = Math.floor(9360 / (roles.length + 1)), sat = new Date(req.params.key + 'T00:00');
  const cell = (t, o = {}) => new D.TableCell({ width: { size: W, type: D.WidthType.DXA }, margins: { top: 80, bottom: 80, left: 100, right: 100 },
    shading: o.fill ? { type: D.ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
    children: [new D.Paragraph({ children: [new D.TextRun({ text: t, bold: !!o.bold, color: o.color })] })] });
  const rows = [new D.TableRow({ tableHeader: true, children: ['Time', ...roles].map(t => cell(t, { fill: '1F6F6A', color: 'FFFFFF', bold: true })) }),
    ...s.slots.map(sl => { const d = new Date(sat); d.setDate(d.getDate() + (sl.day + 1) % 7);
      return new D.TableRow({ children: [cell(d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ', ' + fmtT(sl.time), { bold: true }),
        ...roles.map(r => cell(sl.assign[r] || 'Unfilled', sl.assign[r] ? {} : { color: 'B4472F' }))] }); })];
  const doc = new D.Document({ sections: [{ children: [
    new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('SOCOM Weekend Schedule')] }),
    new D.Paragraph({ spacing: { after: 200 }, children: [new D.TextRun({ text: 'Weekend of ' + sat.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), color: '5B6B72' })] }),
    new D.Table({ width: { size: W * (roles.length + 1), type: D.WidthType.DXA }, columnWidths: Array(roles.length + 1).fill(W), rows })] }] });
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': `attachment; filename="SOCOM-schedule-${req.params.key}.docx"` }).send(await D.Packer.toBuffer(doc));
}));

app.use('/api', api);
app.listen(process.env.PORT || 3000, () => console.log('SOCOM Scheduler running on port ' + (process.env.PORT || 3000)));
