// 静时 · 手机感应：屏幕亮着时，拿起即出定。
// 网页锁屏后收不到传感器；锁屏期间改由「解锁回到页面」判定出定（见 app.js）。

// 必须在点「开始静心」的那一下里直接调用（iOS 要求由点击触发授权）
export function askMotion() {
  if (typeof DeviceMotionEvent === 'undefined') return Promise.resolve('none');
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    return DeviceMotionEvent.requestPermission().then((p) => (p === 'granted' ? 'ok' : 'denied'), () => 'denied');
  }
  return Promise.resolve('ok');
}

// 判断「拿起」：看手机朝向变了多少，不看抖动。
// 重力方向做了低通滤波，消息震动这种高频小抖动过不去；拿起来几乎一定会倾斜。
// 缓冲期结束后，要等手机先静止下来（约半秒朝向基本不变），才把那时的朝向当作「放好的样子」，
// 免得 5 秒到时手还在调位置，放稳那一下就被当成拿起。
const TILT_DEG = 15;   // 偏离放好的朝向超过这么多度 = 拿起
const STILL_DEG = 3;   // 朝向变化在这以内算没动
const STILL_N = 30;    // 连续这么多个读数（约半秒）没动 = 放稳了
const ALPHA = 0.15;

export function watchPickup(onPickup) {
  let g = null, base = null, anchor = null, still = 0, armed = false, fired = false;

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const v = [a.x, a.y, a.z];
    g = g ? g.map((x, i) => x + ALPHA * (v[i] - x)) : v;
    if (!armed || fired) return;
    if (!base) {
      if (anchor && angle(g, anchor) <= STILL_DEG) {
        if (++still >= STILL_N) base = [...anchor];
      } else {
        anchor = [...g];
        still = 0;
      }
      return;
    }
    if (angle(g, base) > TILT_DEG) {
      fired = true;
      onPickup();
    }
  }

  addEventListener('devicemotion', onMotion);
  return {
    // 缓冲期结束时调用：从这时起等手机放稳，再开始感应拿起
    arm() { armed = true; },
    // 是否已经放稳、开始感应
    ready: () => !!base,
    // 有没有收到过传感器数据（没收到 = 这台设备/这次没授权，只能靠轻触屏幕或解锁结束）
    alive: () => !!g,
    stop() { removeEventListener('devicemotion', onMotion); },
  };
}

function angle(p, q) {
  const dot = p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const n = Math.hypot(...p) * Math.hypot(...q);
  if (!n) return 0;
  return (Math.acos(Math.min(1, Math.max(-1, dot / n))) * 180) / Math.PI;
}
