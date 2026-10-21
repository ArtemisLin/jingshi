// 静时 · 纯逻辑：不碰 DOM，node 里可直接测试。
// 一条记录 = { s: 开始毫秒, e: 结束毫秒, x?: 1 }；s 兼作 id，x=1 表示已删除（软删除，好让备份合并时删除能传过去）。

export const MIN_VALID_MS = 330 * 1000; // 满 5′30″ 才计入总时
export const GRACE_MS = 5 * 1000;       // 开始后 5 秒内动手机不算（留给放手机）

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n) => String(n).padStart(2, '0');

export const isValid = (r) => r.e - r.s >= MIN_VALID_MS;
export const live = (list) => list.filter((r) => !r.x);

// 46′08″ / 1时00′12″
export function fmtDur(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0 ? `${h}时${pad(m)}′${pad(s)}″` : `${m}′${pad(s)}″`;
}

// 总时只到分钟：{ h: 37, m: '42' }
export function hm(ms) {
  const t = Math.max(0, Math.floor(ms / 60000));
  return { h: Math.floor(t / 60), m: pad(t % 60) };
}

export function fmtClock(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 10月13日 周二
export function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK[d.getDay()]}`;
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 按日历日前后挪，取正午避开夏令时边界
export function shiftDay(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + delta, 12).getTime());
}

export const yearOf = (ts) => new Date(ts).getFullYear();

export function totals(list) {
  let ms = 0, n = 0;
  for (const r of live(list)) if (isValid(r)) { ms += r.e - r.s; n++; }
  return { ms, n };
}

// 今天的有效时长 + 不计的那几条
export function today(list, now = Date.now()) {
  const k = dayKey(now);
  const rows = live(list).filter((r) => dayKey(r.s) === k);
  const ok = rows.filter(isValid);
  return {
    ms: ok.reduce((a, r) => a + r.e - r.s, 0),
    n: ok.length,
    bad: rows.filter((r) => !isValid(r)),
  };
}

// 连续天数：某天有至少一次有效静心就算这天坐了。
// 当前连续从今天往回数；今天还没坐，就从昨天往回数（今天还没过完，不算断）。
export function streaks(list, now = Date.now()) {
  const days = new Set(live(list).filter(isValid).map((r) => dayKey(r.s)));
  let longest = 0, run = 0, prev = null;
  for (const k of [...days].sort()) {
    run = prev && shiftDay(prev, 1) === k ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = k;
  }
  let k = dayKey(now);
  if (!days.has(k)) k = shiftDay(k, -1);
  let current = 0;
  while (days.has(k)) { current++; k = shiftDay(k, -1); }
  return { current, longest };
}

export function yearsWithData(list) {
  return [...new Set(live(list).map((r) => yearOf(r.s)))].sort((a, b) => b - a);
}

// 某一年的 12 个月合计（选年月面板用）
export function monthTotals(list, year) {
  const out = Array.from({ length: 12 }, () => ({ ms: 0, n: 0, has: false }));
  for (const r of live(list)) {
    const d = new Date(r.s);
    if (d.getFullYear() !== year) continue;
    const m = out[d.getMonth()];
    m.has = true;
    if (isValid(r)) { m.ms += r.e - r.s; m.n++; }
  }
  return out;
}

// 记录页：某一年，月倒序 → 日倒序 → 当天按时间正序
export function yearView(list, year) {
  const months = new Map();
  for (const r of live(list)) {
    const d = new Date(r.s);
    if (d.getFullYear() !== year) continue;
    const mi = d.getMonth() + 1, di = d.getDate();
    if (!months.has(mi)) months.set(mi, { m: mi, ms: 0, n: 0, days: new Map() });
    const mo = months.get(mi);
    if (!mo.days.has(di)) mo.days.set(di, { d: di, wk: WEEK[d.getDay()], ms: 0, rows: [] });
    const day = mo.days.get(di);
    const ok = isValid(r);
    day.rows.push({ ...r, ok });
    if (ok) { day.ms += r.e - r.s; mo.ms += r.e - r.s; mo.n++; }
  }
  return [...months.values()]
    .sort((a, b) => b.m - a.m)
    .map((mo) => ({
      ...mo,
      days: [...mo.days.values()]
        .sort((a, b) => b.d - a.d)
        .map((day) => ({ ...day, rows: day.rows.sort((a, b) => a.s - b.s) })),
    }));
}

// 一条记录只留认识的字段：s 开始、e 结束、x 已删除、p 来自哪个定时（定时「计入」的才有）
const PLAN_ID = /^[\w-]{1,32}$/;
function norm(r) {
  const o = { s: r.s, e: r.e };
  if (r.x) o.x = 1;
  if (typeof r.p === 'string' && PLAN_ID.test(r.p)) o.p = r.p;
  return o;
}

// 两份记录合并：按开始时间对齐，取并集；任何一边删过的就算删了
export function merge(a, b) {
  const map = new Map();
  for (const r of [...a, ...b]) {
    const cur = map.get(r.s);
    if (!cur) { map.set(r.s, norm(r)); continue; }
    if (r.x && !cur.x) cur.x = 1;
    if (!cur.p && norm(r).p) cur.p = r.p;
  }
  return [...map.values()].sort((p, q) => p.s - q.s);
}

const clean = (r) => JSON.stringify(norm(r));

// 备份文件：一年一个，一行一条，方便在 GitHub 上看历史
export function encodeYear(year, list) {
  const rows = list.filter((r) => yearOf(r.s) === year).sort((p, q) => p.s - q.s).map(clean);
  return `{"app":"jingshi","v":1,"year":${year},"sessions":[\n${rows.join(',\n')}\n]}\n`;
}

// 导出文件：全部记录 + 定时设置
export function encodeAll(list, plans) {
  const rows = [...list].sort((p, q) => p.s - q.s).map(clean);
  const extra = plans ? `,\n"plans":${JSON.stringify(mergePlans(plans, {}))}` : '';
  return `{"app":"jingshi","v":1,"sessions":[\n${rows.join(',\n')}\n]${extra}}\n`;
}

// 读备份 / 导入文件；不认识的格式抛错，坏掉的单条直接丢掉
export function decode(text) {
  const j = JSON.parse(text);
  if (!j || j.app !== 'jingshi' || !Array.isArray(j.sessions)) throw new Error('不是静时的备份文件');
  return j.sessions
    .filter((r) => r && Number.isFinite(r.s) && Number.isFinite(r.e) && r.e > r.s)
    .map(norm);
}

// ---------- 上次静心没正常结束，打开时怎么补记 ----------
// a = { s: 开始, end?: 已记下的结束, h?: 离开页面（锁屏/切走/关掉）的时刻, beat?: 最后一次还在页面上的时刻 }
// 离开到现在不超过两分钟：就是锁屏后刚解锁回来、页面被系统重载了，按现在记。
// 超过两分钟：分不清是锁屏静坐了很久，还是早就关掉走了，要问本人。
export const ASK_GAP_MS = 2 * 60 * 1000;

export function recoverPlan(a, now) {
  if (!a || !Number.isFinite(a.s)) return { kind: 'none' };
  if (a.end) return { kind: 'end', end: a.end };
  const left = Math.max(a.h || 0, a.beat || 0, a.s);
  if (now - left <= ASK_GAP_MS) return { kind: 'end', end: now };
  return { kind: 'ask', left, now };
}

// ---------- 备份要不要提醒 ----------
// st = { ok, at, net?: 是不是没网, since?: 这一串失败从何时开始 }
// 没设置备份不提醒；没网偶尔失败不提醒，连续一天都没网才提醒；其他失败（钥匙过期等）马上提醒。
export const NET_GRACE_MS = 24 * 3600 * 1000;

export function backupAlert(hasConfig, st, now) {
  if (!hasConfig || !st || st.ok) return false;
  if (st.net) return now - (st.since || st.at) > NET_GRACE_MS;
  return true;
}

// ---------- 数「不同的人」 ----------
// 手机上只存两个标记：第一次来的日期、最近一次活跃的日期，不生成也不上传任何编号。
// 第一次打开：发「新用户」；更新到这一版前就用过的（有记录/看过引导/设过备份），发「老用户」，不算新来的。
// 每天第一次打开：发「今日活跃」。
export function peopleEvents(state, today, hasHistory) {
  const events = [];
  let { seen, last } = state || {};
  if (!seen) { events.push(hasHistory ? '老用户' : '新用户'); seen = today; }
  if (last !== today) { events.push('今日活跃'); last = today; }
  return { events, seen, last };
}

// ---------- 定时静心（像闹钟：每个定时有开始、结束、重复的星期几、开关） ----------
// 一个定时 = { id, start: '05:55', end: '06:55', days: [1..7]（周一=1 … 周日=7）, on, c: 建立时刻, u: 最后修改时刻 }
// 删掉的留一条 { id, x: 1, u }，好让删除也能同步到别的手机。
// plans = { items: [...], skip: { 'id@2026-10-20': 点「不计」的时刻 } }
export const MAX_PLANS = 10;
export const PLAN_WINDOW_DAYS = 7; // 只看最近 7 天；更早还没确认的自动作废
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CN_DAY = ['', '一', '二', '三', '四', '五', '六', '日'];

export const isoDay = (ts) => new Date(ts).getDay() || 7;

function validPlan(p) {
  return p && typeof p.id === 'string' && PLAN_ID.test(p.id) && HM.test(p.start) && HM.test(p.end) && p.start !== p.end &&
    Array.isArray(p.days) && p.days.length > 0 && p.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
}

function normPlan(p) {
  if (p.x) return { id: p.id, x: 1, u: p.u || 0 };
  return { id: p.id, start: p.start, end: p.end, days: [...new Set(p.days)].sort((a, b) => a - b), on: !!p.on, c: p.c || 0, u: p.u || 0 };
}

export const livePlans = (plans) => ((plans && plans.items) || []).filter((p) => !p.x);

// 某一天这个定时的起止（结束早于开始 = 跨到第二天）
export function planSpan(p, dayTs) {
  const d = new Date(dayTs);
  const [sh, sm] = p.start.split(':').map(Number), [eh, em] = p.end.split(':').map(Number);
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm).getTime();
  let e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em).getTime();
  if (e <= s) e = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, eh, em).getTime();
  return { s, e };
}

export const planMinutes = (p) => { const { s, e } = planSpan(p, Date.UTC(2026, 0, 5, 12)); return Math.round((e - s) / 60000); };

// 重复显示成人话：每天 / 工作日 / 周末 / 周一至周六 / 周一、周三、周五
export function daysLabel(days) {
  const d = [...new Set(days || [])].filter((n) => n >= 1 && n <= 7).sort((a, b) => a - b);
  if (d.length === 7) return '每天';
  if (d.join() === '1,2,3,4,5') return '工作日';
  if (d.join() === '6,7') return '周末';
  if (d.length >= 3 && d[d.length - 1] - d[0] === d.length - 1) return `周${CN_DAY[d[0]]}至周${CN_DAY[d[d.length - 1]]}`;
  return d.map((n) => `周${CN_DAY[n]}`).join('、');
}

// 现在该出现哪些「待确认」：最近 7 天里、已经结束、建这个定时之后才开始的时段；
// 已计入的（有 p 记录，删了也算处理过）、点过不计的、那段时间本来就亲手计过时的，都不再出现。
export function pendingPlans(plans, records, now) {
  const out = [];
  const decided = new Set(records.filter((r) => r.p).map((r) => `${r.p}@${dayKey(r.s)}`));
  const skip = (plans && plans.skip) || {};
  const real = live(records);
  for (const p of livePlans(plans)) {
    if (!p.on || !validPlan(p)) continue;
    const today = new Date(now);
    for (let i = 0; i < PLAN_WINDOW_DAYS; i++) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12).getTime();
      if (!p.days.includes(isoDay(day))) continue;
      const span = planSpan(p, day);
      if (span.e > now || span.s < (p.c || 0)) continue;
      const key = `${p.id}@${dayKey(span.s)}`;
      if (decided.has(key) || skip[key]) continue;
      if (real.some((r) => r.s < span.e && r.e > span.s)) continue;
      out.push({ key, id: p.id, s: span.s, e: span.e });
    }
  }
  return out.sort((a, b) => b.s - a.s);
}

// 两份定时设置合并（本机 + 备份）：同一个定时取最后改过的；「不计」取并集，只留最近 30 天
export function mergePlans(a, b, now = Date.now()) {
  const items = new Map();
  for (const p of [...((a && a.items) || []), ...((b && b.items) || [])]) {
    if (!p || typeof p.id !== 'string' || !PLAN_ID.test(p.id)) continue;
    if (!p.x && !validPlan(p)) continue;
    const cur = items.get(p.id);
    if (!cur || (p.u || 0) > (cur.u || 0)) items.set(p.id, normPlan(p));
  }
  const skip = {};
  const cutoff = now - 30 * 86400000;
  for (const src of [a && a.skip, b && b.skip]) {
    for (const [k, t] of Object.entries(src || {})) {
      if (Number.isFinite(t) && t >= cutoff && /^[\w-]{1,32}@\d{4}-\d\d-\d\d$/.test(k)) skip[k] = Math.max(skip[k] || 0, t);
    }
  }
  const list = [...items.values()].sort((p, q) => (p.c || 0) - (q.c || 0) || (p.id < q.id ? -1 : 1));
  return { items: list, skip: Object.fromEntries(Object.entries(skip).sort()) };
}

// 备份里的定时设置文件：data/plans.json
export function encodePlans(plans) {
  const m = mergePlans(plans, {});
  return `{"app":"jingshi","v":1,"kind":"plans",\n"items":[\n${m.items.map((p) => JSON.stringify(p)).join(',\n')}\n],\n"skip":${JSON.stringify(m.skip)}}\n`;
}

// 从定时设置文件或导出文件里读出定时设置；没有就返回 null
export function decodePlans(text) {
  const j = JSON.parse(text);
  if (!j || j.app !== 'jingshi') throw new Error('不是静时的备份文件');
  const src = j.kind === 'plans' ? j : j.plans;
  return src ? mergePlans(src, {}) : null;
}
