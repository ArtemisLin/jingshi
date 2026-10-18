// 静时 · 界面与静心流程

import * as L from './logic.js?v=0.7.1';
import * as store from './store.js?v=0.7.1';
import * as sync from './sync.js?v=0.7.1';
import * as sense from './sense.js?v=0.7.1';
import * as stat from './stat.js?v=0.7.1';

const VERSION = '0.7.1';
const GRACE = window.JINGSHI_GRACE_MS || L.GRACE_MS; // 测试时可调短
const ACTIVE = 'jingshi.active';
const ONBOARD = 'jingshi.onboarded';
const SEEN = 'jingshi.seen', LAST = 'jingshi.lastActive'; // 只存日期，用来数「不同的人」
const BG = '#F5F2EA', DIM = '#E0D9CB'; // 和 css 的 --bg / --dim 一致

const $ = (id) => document.getElementById(id);

let list = [];        // 全部记录（含已删除）
let viewYear = null;  // 记录页正在看的年份
let pickYear = null;  // 选年月面板里选中的年份
let sit = null;       // 正在静心：{ start, phase: 'grace'|'armed', timer, watch, motion }
let pending = null;   // 页面在后台时攒下的提示，回来再显示
let lastEnd = 0;      // 出定时那一下轻触，别让它落到底下的「开始静心」上又开一次
let drag = null;      // 正在左滑的那一行

// ---------- 数据 ----------

async function reload() {
  list = await store.all();
}

async function save(r) {
  await store.put(r);
  list = list.filter((x) => x.s !== r.s).concat(r);
  sync.markDirty(L.yearOf(r.s));
  sync.syncDirty().then(renderBackupStatus);
}

// 正在进行的静心记在 localStorage：锁屏久了页面可能被系统回收，解锁重开时据此补记
const active = {
  get() { try { return JSON.parse(localStorage.getItem(ACTIVE)); } catch { return null; } },
  set(v) { try { localStorage.setItem(ACTIVE, JSON.stringify(v)); } catch {} },
  clear() { try { localStorage.removeItem(ACTIVE); } catch {} },
};

// 打开时发现有一次没结束（锁屏久了页面被系统回收，或者中途关掉了页面）：
// 刚离开不久就按现在记；离开很久了分不清是一直锁屏静坐还是早走了，问本人。
async function recover() {
  const a = active.get();
  const plan = L.recoverPlan(a, Date.now());
  if (plan.kind === 'none') { if (a) active.clear(); return; }
  let end = plan.end;
  if (plan.kind === 'ask') {
    const choice = await askEnd(a.s, plan.left, plan.now);
    if (choice === 'drop') { active.clear(); toast('好的，上次那次不记'); return; }
    end = choice === 'left' ? plan.left : plan.now;
  }
  if (end - a.s < 1000) { active.clear(); return; }
  await finish({ s: a.s, e: end });
}

// 跨天时带上日期：今天的只写钟点
function clockOrDate(ts) {
  return L.dayKey(ts) === L.dayKey(Date.now()) ? L.fmtClock(ts) : `${new Date(ts).getMonth() + 1}月${new Date(ts).getDate()}日 ${L.fmtClock(ts)}`;
}

function askEnd(s, left, now) {
  const line = (end) => `${clockOrDate(end)} · 共 ${L.fmtDur(end - s)}${L.isValid({ s, e: end }) ? '' : '（不足五分半，不计）'}`;
  $('askText').textContent = `${clockOrDate(s)} 开始静心，${clockOrDate(left)} 离开了页面。一直锁屏静坐到刚才，就选「记到现在」；中途就起身了，就选「记到离开时」。`;
  $('askNow').innerHTML = `<span>记到现在</span><small>${line(now)}</small>`;
  $('askLeft').innerHTML = `<span>记到离开时</span><small>${line(left)}</small>`;
  openSheet('askSheet');
  return new Promise((resolve) => {
    const pick = (v) => () => { closeSheet('askSheet'); for (const id of ['askNow', 'askLeft', 'askDrop']) $(id).onclick = null; resolve(v); };
    $('askNow').onclick = pick('now');
    $('askLeft').onclick = pick('left');
    $('askDrop').onclick = pick('drop');
  });
}

async function finish(r) {
  const before = L.totals(list).ms;
  try {
    await save(r);
    active.clear();
  } catch {
    toast('这次记录没存上，下次打开会再试', 'bad', 8000);
    return;
  }
  renderHome();
  if (!$('records').hidden) renderRecords();
  showResult(r, before);
  stat.event(L.isValid(r) ? '完成有效静心' : '不足五分半');
}

// 出定结果就在圆环里：有效的让累计从旧值涨到新值，不计的盖一枚「不计」朱印。7 秒后淡出。
let resultTimers = [];
let countFrame = 0;

function setTotal(ms) {
  const t = L.hm(ms);
  $('totH').textContent = t.h;
  $('totM').textContent = t.m;
  $('total').classList.toggle('long', t.h >= 100);
}

function countUp(from, to) {
  const t0 = performance.now(), dur = 1800;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    setTotal(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) countFrame = requestAnimationFrame(step);
  };
  countFrame = requestAnimationFrame(step);
}

function showResult(r, before) {
  hideResult();
  const later = (ms, fn) => resultTimers.push(setTimeout(fn, ms));
  const dur = L.fmtDur(r.e - r.s);
  if (L.isValid(r)) {
    const after = L.totals(list).ms;
    $('gainV').textContent = `+${dur}`;
    setTotal(before);
    $('ring').classList.add('lit');
    $('gain').classList.add('show');
    later(500, () => countUp(before, after));
    later(2600, () => $('ring').classList.remove('lit'));
    later(7000, () => $('gain').classList.remove('show'));
  } else {
    $('missV').textContent = dur;
    $('miss').classList.add('show');
    later(7000, () => $('miss').classList.remove('show'));
  }
}

function hideResult() {
  resultTimers.forEach(clearTimeout);
  resultTimers = [];
  cancelAnimationFrame(countFrame);
  $('gain').classList.remove('show');
  $('miss').classList.remove('show');
  $('ring').classList.remove('lit');
  setTotal(L.totals(list).ms);
}

// ---------- 静心 ----------
// 缓冲期（5 秒）放好手机 → 之后：屏幕亮着时拿起手机即出定；锁屏后继续计时，解锁回来即出定。
// 不再让屏幕常亮：手机照常自动锁屏，坐几个小时也不费电。

function startSit() {
  if (sit || Date.now() - lastEnd < 1500) return;
  const motionAsk = sense.askMotion(); // 必须在点击的同一刻发起，iOS 才认是用户触发的
  stat.event('开始静心');
  const start = Date.now();
  sit = { start, phase: 'grace', motion: null };
  active.set({ s: start });
  sit.watch = sense.watchPickup(() => endSit('pickup'));

  const n = Math.ceil(GRACE / 1000);
  $('countN').textContent = n;
  $('sitTitle').textContent = '进入静心';
  $('sitHint').textContent = `${n} 秒后进入静心状态\n请不要离开此页面`;
  $('sit').classList.remove('armed');
  $('sitTime').hidden = true;
  $('sit').hidden = false;

  motionAsk.then((m) => {
    if (!sit || sit.start !== start) return;
    sit.motion = m;
    if (m !== 'ok') $('sitHint').textContent = '没有开启动作感应\n请不要离开此页面，解锁即停止计时';
  });

  sit.timer = setInterval(tickGrace, 200);
  sit.beatTimer = setInterval(beat, 5000); // 还在页面上的证据：万一页面被关，补记时用得上
}

function beat() {
  const a = active.get();
  if (sit && a && a.s === sit.start) active.set({ ...a, beat: Date.now() });
  showSitTime();
}

// 静心中底部的一行：「06:12 开始 · 已静心 12 分钟」，只到分钟，不跳秒，不足一分钟写 0
function showSitTime() {
  if (!sit || sit.phase !== 'armed') return;
  const min = Math.floor((Date.now() - sit.start) / 60000);
  $('sitTime').innerHTML = `<span class="num">${L.fmtClock(sit.start)}</span> 开始 · 已静心 <span class="num">${min}</span> 分钟`;
}

// 离开页面（锁屏、切走、关掉）：记下时刻，计时照常继续
function markLeft() {
  const a = active.get();
  if (sit && a && a.s === sit.start && !a.h) active.set({ ...a, h: Date.now() });
}

function tickGrace() {
  if (!sit) return;
  const left = Math.ceil((sit.start + GRACE - Date.now()) / 1000);
  if (left > 0) {
    $('countN').textContent = left;
    return;
  }
  clearInterval(sit.timer);
  sit.phase = 'armed';
  sit.watch.arm();
  $('sitTitle').textContent = '静心中';
  if (sit.motion === 'ok') $('sitHint').textContent = '请不要离开此页面\n拿起手机或解锁即停止计时';
  $('sit').classList.add('armed');
  $('sitTime').hidden = false;
  showSitTime();
  setThemeColor(DIM);
}

async function endSit(reason) {
  if (!sit) return;
  const at = Date.now();
  const { start, timer, beatTimer, watch } = sit;
  sit = null;
  lastEnd = at;
  clearInterval(timer);
  clearInterval(beatTimer);
  watch.stop();
  $('sit').hidden = true;
  setThemeColor(BG);
  if (reason === 'cancel') {
    active.clear();
    stat.event('取消静心');
    return;
  }
  active.set({ s: start, end: at }); // 先同步记下结束时间，再慢慢存
  await finish({ s: start, e: at });
}

function setThemeColor(c) {
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = c;
}

// ---------- 首页 ----------

function renderHome() {
  const t = L.hm(L.totals(list).ms);
  $('totH').textContent = t.h;
  $('totM').textContent = t.m;
  $('total').classList.toggle('long', t.h >= 100);

  const td = L.today(list);
  let html = td.n ? `<div>今日 <span class="num">${L.fmtDur(td.ms)}</span></div>` : '<div>今日尚未静心</div>';
  if (td.bad.length === 1) {
    html += `<div class="bad">${td.n ? '另有' : '有'} 1 次 ${L.fmtDur(td.bad[0].e - td.bad[0].s)} 不足五分半，不计</div>`;
  } else if (td.bad.length > 1) {
    html += `<div class="bad">${td.n ? '另有' : '有'} ${td.bad.length} 次不足五分半，不计</div>`;
  }
  $('today').innerHTML = html;
}

// ---------- 静心记录 ----------

function renderRecords() {
  const tot = L.totals(list);
  const t = L.hm(tot.ms);
  const st = L.streaks(list);
  $('sH').textContent = t.h;
  $('sM').textContent = t.m;
  $('sN').textContent = tot.n;
  $('sCur').textContent = st.current;
  $('sLong').textContent = st.longest;

  const years = L.yearsWithData(list);
  if (!years.includes(viewYear)) viewYear = years[0] ?? new Date().getFullYear();
  $('yearBtn').hidden = !years.length;
  $('rowHint').hidden = !years.length;
  $('yearLabel').textContent = viewYear;

  const months = L.yearView(list, viewYear);
  const now = new Date();
  const curMonth = now.getFullYear() === viewYear ? now.getMonth() + 1 : 0;
  $('list').innerHTML = months.length
    ? months.map((mo) => monthHTML(mo, mo.m === curMonth)).join('')
    : '<p class="empty">还没有记录</p>';
}

function monthHTML(mo, isCurrent) {
  const t = L.hm(mo.ms);
  return `<section class="month" id="m-${viewYear}-${mo.m}">
    <div class="month-head">
      <span class="month-name"><span class="num">${mo.m}</span> 月</span>
      <span class="month-sum">${isCurrent ? '本月 ' : ''}${t.h} 时 ${t.m} 分 · ${mo.n} 次</span>
    </div>
    ${mo.days.map(dayHTML).join('')}
  </section>`;
}

function dayHTML(day) {
  return `<div class="day">
    <div class="day-side">
      <span class="day-num num">${day.d}</span>
      <span class="day-wk">${day.wk}</span>
      <span class="day-sum num">${day.ms ? L.fmtDur(day.ms) : ''}</span>
    </div>
    <div class="day-rows">${day.rows.map(rowHTML).join('')}</div>
  </div>`;
}

function rowHTML(r) {
  return `<div class="swipe" data-s="${r.s}">
    <button class="del" type="button" aria-label="删除 ${L.fmtClock(r.s)} 开始的这条记录">删除</button>
    <div class="row${r.ok ? '' : ' bad'}">
      <span class="num">${L.fmtClock(r.s)} – ${L.fmtClock(r.e)}</span>
      <span class="row-dur">${r.ok ? '' : '<span class="tag">不计</span>'}<span class="num">${L.fmtDur(r.e - r.s)}</span></span>
    </div>
  </div>`;
}

// ---------- 左滑删除 ----------
// 向左滑一行露出「删除」，点它就删；碰别处或再点这一行就收回去。

const DEL_W = 76;

function closeSwipes(except) {
  for (const el of document.querySelectorAll('.swipe.open')) if (el !== except) el.classList.remove('open');
}

function onTouchStart(e) {
  const sw = e.target.closest('.swipe');
  closeSwipes(sw);
  if (!sw || e.target.closest('.del')) { drag = null; return; }
  const t = e.touches[0];
  drag = { sw, row: sw.querySelector('.row'), x0: t.clientX, y0: t.clientY, base: sw.classList.contains('open') ? -DEL_W : 0, dx: 0, mode: null };
}

function onTouchMove(e) {
  if (!drag) return;
  const t = e.touches[0];
  const dx = t.clientX - drag.x0, dy = t.clientY - drag.y0;
  if (!drag.mode) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    drag.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'; // 竖着滑是在翻记录，不管
  }
  if (drag.mode !== 'h') return;
  e.preventDefault();
  drag.dx = dx;
  drag.row.style.transition = 'none';
  drag.row.style.transform = `translateX(${Math.max(-DEL_W - 24, Math.min(0, drag.base + dx))}px)`;
}

function onTouchEnd() {
  if (!drag) return;
  const { sw, row, base, dx, mode } = drag;
  drag = null;
  if (mode !== 'h') {
    if (!mode && base) sw.classList.remove('open'); // 轻点已打开的一行 = 收回
    return;
  }
  row.style.transition = '';
  row.style.transform = '';
  sw.classList.toggle('open', base + dx < -DEL_W / 2);
}

async function onDelete(e) {
  const b = e.target.closest('.del');
  if (!b) return;
  const r = list.find((x) => x.s === Number(b.closest('.swipe').dataset.s));
  if (!r) return;
  await save({ s: r.s, e: r.e, x: 1 });
  renderRecords();
  renderHome();
  toast(`已删除 ${L.fmtClock(r.s)} – ${L.fmtClock(r.e)} 这条记录`);
}

// ---------- 选年月 ----------

function renderPicker() {
  const years = L.yearsWithData(list);
  $('pickYears').innerHTML = years
    .map((y) => `<button class="chip${y === pickYear ? ' on' : ''}" type="button" data-y="${y}">${y}</button>`)
    .join('');
  const yt = L.totals(list.filter((r) => L.yearOf(r.s) === pickYear));
  const t = L.hm(yt.ms);
  $('pickSum').textContent = `${pickYear} 年 · ${t.h} 时 ${t.m} 分 · ${yt.n} 次`;

  const now = new Date();
  $('pickMonths').innerHTML = L.monthTotals(list, pickYear)
    .map((m, i) => {
      const label = `<span><span class="num">${i + 1}</span> 月</span>`;
      if (!m.has) return `<div class="mcell off">${label}</div>`;
      const mt = L.hm(m.ms);
      const isNow = pickYear === now.getFullYear() && i === now.getMonth();
      return `<button class="mcell${isNow ? ' now' : ''}" type="button" data-m="${i + 1}">${label}<span class="msum">${mt.h}时${mt.m}分</span></button>`;
    })
    .join('');
}

function onPick(e) {
  const chip = e.target.closest('[data-y]');
  if (chip) {
    pickYear = Number(chip.dataset.y);
    renderPicker();
    return;
  }
  const cell = e.target.closest('[data-m]');
  if (!cell) return;
  viewYear = pickYear;
  closeSheet('picker');
  renderRecords();
  const el = $(`m-${viewYear}-${cell.dataset.m}`);
  if (el) el.scrollIntoView({ block: 'start' });
}

// ---------- 备份 ----------

function when(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${L.fmtClock(ts)}`;
}

// 备份出问题时，「记录」「备份」按钮上亮小红点，记录页顶上写明原因
function updateAlert() {
  const st = sync.getStatus();
  const on = L.backupAlert(!!sync.getConfig(), st, Date.now());
  $('recDot').hidden = !on;
  $('bakDot').hidden = !on;
  $('bakWarn').hidden = !on;
  if (on) $('bakWarn').textContent = `备份没成功：${st.msg}。点这里处理 ›`;
}

function renderBackupStatus() {
  updateAlert();
  const cfg = sync.getConfig();
  const st = sync.getStatus();
  const el = $('syncStatus');
  el.className = 'status';
  if (!cfg) {
    el.textContent = '还没设置。设置好以后，每次静心结束都会自动备份到你的 GitHub 私有仓库。';
  } else if (!st) {
    el.textContent = '已设置，还没同步过';
  } else if (st.ok) {
    el.textContent = `已开启自动备份 · 上次同步 ${when(st.at)}`;
    el.classList.add('ok');
  } else {
    el.textContent = `备份没成功：${st.msg}`;
    el.classList.add('bad');
  }
}

function openBackup() {
  const cfg = sync.getConfig();
  $('repo').value = cfg ? cfg.repo : '';
  $('token').value = cfg ? cfg.token : '';
  $('ver').textContent = `静时 v${VERSION}`;
  renderBackupStatus();
  openSheet('backup');
}

async function onSaveSync() {
  const repo = $('repo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const token = $('token').value.trim();
  const el = $('syncStatus');
  if (!token) {
    sync.setConfig(null);
    renderBackupStatus();
    updateAlert();
    toast('已关闭自动备份');
    return;
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    el.className = 'status bad';
    el.textContent = '仓库请写成「用户名/仓库名」';
    return;
  }
  const btn = $('saveSync');
  btn.disabled = true;
  el.className = 'status';
  el.textContent = '正在连接 GitHub…';
  try {
    await sync.check({ repo, token });
    sync.setConfig({ repo, token });
    el.textContent = '正在同步…';
    await sync.syncAll();
    await reload();
    renderAll();
    renderBackupStatus();
    toast('备份已开启，记录已同步');
    stat.event('开启备份');
  } catch (e) {
    el.className = 'status bad';
    el.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

async function onExport() {
  stat.event('导出备份');
  const name = `静时备份-${L.dayKey(Date.now())}.json`;
  const file = new File([L.encodeAll(list)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch {}
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function onImport(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const incoming = L.decode(await f.text());
    const before = new Map(list.map((r) => [r.s, r]));
    const changed = L.merge(list, incoming).filter((r) => { const b = before.get(r.s); return !b || !!b.x !== !!r.x; });
    if (changed.length) await store.putMany(changed);
    for (const y of new Set(changed.map((r) => L.yearOf(r.s)))) sync.markDirty(y);
    await reload();
    renderAll();
    toast(changed.length ? `导入了 ${changed.length} 条新记录` : '没有新记录，都已经在了');
    stat.event('导入备份');
    sync.syncDirty().then(renderBackupStatus);
  } catch (err) {
    toast(`导入失败：${err.message}`, 'bad');
  }
}

// ---------- 第一次打开的引导 ----------
// 只在微信里出现（别的浏览器没有浮窗），看过一次就不再弹；以后从首页「指南」随时能看

function maybeOnboard() {
  let seen = false;
  try { seen = !!localStorage.getItem(ONBOARD); } catch {}
  if (seen || !/MicroMessenger/i.test(navigator.userAgent)) return;
  $('onboard').hidden = false;
  stat.event('看到浮窗引导');
}

function doneOnboard() {
  try { localStorage.setItem(ONBOARD, '1'); } catch {}
  $('onboard').hidden = true;
}

// ---------- 数「不同的人」（只发生一次的匿名事件，见 logic.peopleEvents） ----------

function countPeople() {
  let state;
  try { state = { seen: localStorage.getItem(SEEN), last: localStorage.getItem(LAST) }; } catch { return; } // 存不了就不数，免得每次都算新人
  const old = list.length > 0 || !!sync.getConfig() || (() => { try { return !!localStorage.getItem(ONBOARD); } catch { return false; } })();
  const r = L.peopleEvents(state, L.dayKey(Date.now()), old);
  if (!r.events.length) return;
  try {
    localStorage.setItem(SEEN, r.seen);
    localStorage.setItem(LAST, r.last);
  } catch { return; }
  for (const e of r.events) stat.event(e);
}

// ---------- 通用 ----------

function show(name) {
  $('home').hidden = name !== 'home';
  $('records').hidden = name !== 'records';
  window.scrollTo(0, 0);
}

// 记录页压一条浏览历史：微信 / Safari 的「返回」也能回到首页，而不是离开 app
function openRecords() {
  hideResult();
  renderRecords();
  show('records');
  if (!(history.state && history.state.v === 'records')) history.pushState({ v: 'records' }, '');
}

function backHome() {
  if (history.state && history.state.v === 'records') history.back(); // 交给 popstate 回首页
  else { renderHome(); show('home'); }
}

function onPopState() {
  if (history.state && history.state.v === 'records') {
    renderRecords();
    show('records');
    return;
  }
  closeSheet('picker');
  closeSheet('backup');
  renderHome();
  show('home');
}

function openSheet(id) { $(id).hidden = false; }
function closeSheet(id) { $(id).hidden = true; }

function renderAll() {
  renderHome();
  if (!$('records').hidden) renderRecords();
}

let toastTimer = null;
function toast(msg, kind = '', ms = 5000) {
  if (document.visibilityState === 'hidden') {
    pending = [msg, kind, ms];
    return;
  }
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function bind() {
  $('start').addEventListener('click', startSit);
  $('count').addEventListener('click', () => { if (sit && sit.phase === 'grace') endSit('cancel'); });
  // 缓冲期过后，碰一下屏幕也算出定
  $('sit').addEventListener('pointerdown', () => { if (sit && sit.phase === 'armed') endSit('touch'); });

  $('toRecords').addEventListener('click', openRecords);
  $('back').addEventListener('click', backHome);
  addEventListener('popstate', onPopState);
  $('list').addEventListener('click', onDelete);
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  $('list').addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('touchcancel', onTouchEnd);

  $('yearBtn').addEventListener('click', () => { pickYear = viewYear; renderPicker(); openSheet('picker'); });
  $('pickYears').addEventListener('click', onPick);
  $('pickMonths').addEventListener('click', onPick);

  $('toBackup').addEventListener('click', openBackup);
  $('obOk').addEventListener('click', doneOnboard);
  $('obMore').addEventListener('click', doneOnboard);
  $('bakWarn').addEventListener('click', openBackup);
  $('saveSync').addEventListener('click', onSaveSync);
  $('exportBtn').addEventListener('click', onExport);
  $('importFile').addEventListener('change', onImport);

  for (const el of document.querySelectorAll('[data-close]')) {
    el.addEventListener('click', () => { el.closest('.sheet-wrap').hidden = true; });
  }

  // 锁屏、切走：继续计时（记下离开的时刻）；解锁回来：出定
  addEventListener('pagehide', markLeft);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { markLeft(); return; }
    if (sit) {
      endSit('unlock');
      return;
    }
    renderAll(); // 可能跨了一天
    countPeople(); // 从浮窗回来、跨了一天的，也算今日活跃
    if (pending) { const p = pending; pending = null; toast(...p); }
    sync.syncDirty().then(renderBackupStatus);
  });
}

async function init() {
  if (history.state && history.state.v === 'records') history.replaceState(null, ''); // 刷新后从首页开始
  stat.pageview();
  bind();
  store.persist();
  try {
    await reload();
  } catch {
    toast('读不到本机记录，请确认没有开启无痕浏览', 'bad', 8000);
  }
  renderHome();
  updateAlert();
  countPeople();
  try {
    await recover(); // 补记那一次会自己播「累计往上涨」，所以放在首页画好之后
  } catch {}
  maybeOnboard();
  sync.syncDirty().then(renderBackupStatus);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
