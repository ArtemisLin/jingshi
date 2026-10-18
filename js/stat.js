// 静时 · 匿名使用统计（GoatCounter，不用 cookie、不记个人信息）。
// 只记「发生了几次」：打开了哪个页面、点了「开始静心」之类的动作。
// 不带任何静心记录、时长、备份钥匙。只在正式网址上统计，连不上就悄悄算了，不影响使用。

const ENDPOINT = 'https://artemislin.goatcounter.com/count';
const ON = location.hostname === 'artemislin.github.io';

function send(params) {
  if (!ON) return;
  try {
    const q = new URLSearchParams({
      ...params,
      s: `${screen.width},${screen.height},${window.devicePixelRatio || 1}`,
      rnd: Math.random().toString(36).slice(2),
    });
    const url = `${ENDPOINT}?${q}`;
    if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
    new Image().src = url;
  } catch {}
}

// 打开了一个页面（首页 / 指南）
export function pageview() {
  send({ p: location.pathname, t: document.title, r: document.referrer || '', q: location.search });
}

// 发生了一个动作，比如「开始静心」
export function event(name) {
  send({ p: name, t: name, e: 'true' });
}
