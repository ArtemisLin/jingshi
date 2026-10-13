// 静时 · 纯逻辑：不碰 DOM，node 里可直接测试。
// 一条记录 = { s: 开始毫秒, e: 结束毫秒, x?: 1 }；s 兼作 id，x=1 表示已删除（软删除，好让备份合并时删除能传过去）。

export const MIN_VALID_MS = 330 * 1000; // 满 5′30″ 才计入总时
export const GRACE_MS = 10 * 1000;      // 开始后 10 秒内动手机不算（留给放手机）

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

// 两份记录合并：按开始时间对齐，取并集；任何一边删过的就算删了
export function merge(a, b) {
  const map = new Map();
  for (const r of [...a, ...b]) {
    const cur = map.get(r.s);
    if (!cur) map.set(r.s, r.x ? { s: r.s, e: r.e, x: 1 } : { s: r.s, e: r.e });
    else if (r.x && !cur.x) cur.x = 1;
  }
  return [...map.values()].sort((p, q) => p.s - q.s);
}

const clean = (r) => (r.x ? `{"s":${r.s},"e":${r.e},"x":1}` : `{"s":${r.s},"e":${r.e}}`);

// 备份文件：一年一个，一行一条，方便在 GitHub 上看历史
export function encodeYear(year, list) {
  const rows = list.filter((r) => yearOf(r.s) === year).sort((p, q) => p.s - q.s).map(clean);
  return `{"app":"jingshi","v":1,"year":${year},"sessions":[\n${rows.join(',\n')}\n]}\n`;
}

// 导出文件：全部记录
export function encodeAll(list) {
  const rows = [...list].sort((p, q) => p.s - q.s).map(clean);
  return `{"app":"jingshi","v":1,"sessions":[\n${rows.join(',\n')}\n]}\n`;
}

// 读备份 / 导入文件；不认识的格式抛错，坏掉的单条直接丢掉
export function decode(text) {
  const j = JSON.parse(text);
  if (!j || j.app !== 'jingshi' || !Array.isArray(j.sessions)) throw new Error('不是静时的备份文件');
  return j.sessions
    .filter((r) => r && Number.isFinite(r.s) && Number.isFinite(r.e) && r.e > r.s)
    .map((r) => (r.x ? { s: r.s, e: r.e, x: 1 } : { s: r.s, e: r.e }));
}
