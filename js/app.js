// 静时 · 界面与静心流程

import * as L from './logic.js';
import * as store from './store.js';
import * as sync from './sync.js';
import * as sense from './sense.js';

const VERSION = '0.1.0';
const GRACE = window.JINGSHI_GRACE_MS || L.GRACE_MS; // 测试时可调短
const ACTIVE = 'jingshi.active';
const BG = '#F5F2EA';

const $ = (id) => document.getElementById(id);

let list = [];        // 全部记录（含已删除）
let viewYear = null;  // 记录页正在看的年份
let pickYear = null;  // 选年月面板里选中的年份
let sit = null;       // 正在静心：{ start, phase: 'grace'|'dark', timer, watch, motion }
let pending = null;   // 页面在后台时攒下的提示，回来再显示
let lastEnd = 0;      // 出定时那一下轻触，别让它落到底下的「开始静心」上又开一次

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

// 正在进行的静心记在 localStorage：万一页面被系统杀掉，下次打开还能补记
const active = {
  get() { try { return JSON.parse(localStorage.getItem(ACTIVE)); } catch { return null; } },
  set(v) { try { localStorage.setItem(ACTIVE, JSON.stringify(v)); } catch {} },
  clear() { try { localStorage.removeItem(ACTIVE); } catch {} },
};

async function recover() {
  const a = active.get();
  if (!a) return;
  active.clear();
  if (a.phase !== 'dark') return;
  const end = a.end || a.beat;
  if (!end || end <= a.s) return;
  const r = { s: a.s, e: end };
  await save(r);
  toast(`上次静心中途断了，按 ${L.fmtClock(end)} 记为结束 · ${L.fmtDur(end - a.s)}${L.isValid(r) ? '' : '，不足五分半，不计'}`, L.isValid(r) ? '' : 'bad', 8000);
}

// ---------- 静心 ----------

function startSit() {
  if (sit || Date.now() - lastEnd < 1500) return;
  // 这两个必须在点击的同一刻发起，iOS 才认是用户触发的
  const motionAsk = sense.askMotion();
  const awake = sense.keepAwake();

  const start = Date.now();
  sit = { start, phase: 'grace', motion: null };
  active.set({ s: start, phase: 'grace' });
  sit.watch = sense.watchPickup(() => endSit('pickup'));

  $('sitHint').textContent = '20s 后屏幕转暗；拿起手机会停止计时';
  $('count').textContent = Math.ceil(GRACE / 1000);
  $('sit').classList.remove('dark');
  $('sit').hidden = false;

  motionAsk.then((m) => {
    if (!sit || sit.start !== start) return;
    sit.motion = m;
    if (m !== 'ok') $('sitHint').textContent = '没有开启动作感应：拿起手机不会自动停止，结束时请轻触屏幕';
  });
  awake.then((ok) => {
    if (!ok && sit && sit.start === start) toast('屏幕可能会自动锁定，锁屏会结束计时。可在「设置 › 显示与亮度 › 自动锁定」改成「永不」', '', 8000);
  });

  sit.timer = setInterval(tickGrace, 200);
}

function tickGrace() {
  const left = Math.ceil((sit.start + GRACE - Date.now()) / 1000);
  if (left > 0) {
    $('count').textContent = left;
    return;
  }
  clearInterval(sit.timer);
  sit.phase = 'dark';
  sit.watch.arm();
  $('sit').classList.add('dark');
  setThemeColor('#000000');
  beat();
  sit.timer = setInterval(beat, 5000);
}

function beat() {
  if (sit) active.set({ s: sit.start, phase: 'dark', beat: Date.now() });
}

async function endSit(reason) {
  if (!sit) return;
  const at = Date.now();
  const { start, phase, timer, watch } = sit;
  sit = null;
  lastEnd = at;
  clearInterval(timer);
  watch.stop();
  sense.releaseAwake();
  setThemeColor(BG);
  $('sit').hidden = true;
  $('sit').classList.remove('dark');

  if (phase === 'grace') {
    active.clear();
    if (reason === 'hidden') toast('锁屏或切到别的应用，已取消这次静心');
    return;
  }

  // 先同步记下结束时间，再慢慢存；中途被杀也丢不了
  active.set({ s: start, phase: 'dark', end: at });
  const r = { s: start, e: at };
  try {
    await save(r);
    active.clear();
  } catch {
    toast('这次记录没存上，下次打开会再试', 'bad', 8000);
  }
  renderHome();
  if (!$('records').hidden) renderRecords();
  toast(L.isValid(r) ? `本次静心 ${L.fmtDur(r.e - r.s)}` : `本次 ${L.fmtDur(r.e - r.s)}，不足五分半，不计`, L.isValid(r) ? '' : 'bad', 6000);
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
  return `<button class="row${r.ok ? '' : ' bad'}" type="button" data-s="${r.s}">
    <span class="num">${L.fmtClock(r.s)} – ${L.fmtClock(r.e)}</span>
    <span class="row-dur">${r.ok ? '' : '<span class="tag">不计</span>'}<span class="num">${L.fmtDur(r.e - r.s)}</span></span>
  </button>`;
}

async function onRowTap(e) {
  const b = e.target.closest('.row');
  if (!b) return;
  const r = list.find((x) => x.s === Number(b.dataset.s));
  if (!r) return;
  if (!confirm(`删除这条记录？\n${L.fmtClock(r.s)} – ${L.fmtClock(r.e)}　${L.fmtDur(r.e - r.s)}`)) return;
  await save({ s: r.s, e: r.e, x: 1 });
  renderRecords();
  renderHome();
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

function renderBackupStatus() {
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
  $('repo').value = cfg ? cfg.repo : 'artemislin/jingshi-data';
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
  } catch (e) {
    el.className = 'status bad';
    el.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

async function onExport() {
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
    sync.syncDirty().then(renderBackupStatus);
  } catch (err) {
    toast(`导入失败：${err.message}`, 'bad');
  }
}

// ---------- 通用 ----------

function show(name) {
  $('home').hidden = name !== 'home';
  $('records').hidden = name !== 'records';
  window.scrollTo(0, 0);
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
  $('cancel').addEventListener('click', () => endSit('cancel'));
  // 转暗之后，碰一下屏幕也算出定
  $('sit').addEventListener('pointerdown', () => { if (sit && sit.phase === 'dark') endSit('touch'); });

  $('toRecords').addEventListener('click', () => { renderRecords(); show('records'); });
  $('back').addEventListener('click', () => { renderHome(); show('home'); });
  $('list').addEventListener('click', onRowTap);

  $('yearBtn').addEventListener('click', () => { pickYear = viewYear; renderPicker(); openSheet('picker'); });
  $('pickYears').addEventListener('click', onPick);
  $('pickMonths').addEventListener('click', onPick);

  $('toBackup').addEventListener('click', openBackup);
  $('saveSync').addEventListener('click', onSaveSync);
  $('exportBtn').addEventListener('click', onExport);
  $('importFile').addEventListener('change', onImport);

  for (const el of document.querySelectorAll('[data-close]')) {
    el.addEventListener('click', () => { el.closest('.sheet-wrap').hidden = true; });
  }

  // 锁屏、切应用、关掉页面：静心中就当出定（转暗前则取消）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (sit) endSit('hidden');
      return;
    }
    renderAll(); // 可能跨了一天
    if (pending) { const p = pending; pending = null; toast(...p); }
    sync.syncDirty().then(renderBackupStatus);
  });
  addEventListener('pagehide', () => { if (sit) endSit('hidden'); });
}

async function init() {
  bind();
  store.persist();
  try {
    await reload();
    await recover();
  } catch {
    toast('读不到本机记录，请确认没有开启无痕浏览', 'bad', 8000);
  }
  renderHome();
  sync.syncDirty().then(renderBackupStatus);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
