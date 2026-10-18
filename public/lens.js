// Magnifier: a 3D lens roaming over the glass orb (metal ring, dark handle, glass, shadow).
// orb.js calls lens.draw(dt, orbCv) every frame; the orb image under the lens
// is copied from orbCv magnified, so the magnification is real. No separate rAF: synced with orb.start/stop.
const lens = (() => {
  const cv = document.getElementById('lensCv');
  if (!cv) return { draw() {}, reset() {} };
  const ctx = cv.getContext('2d');
  const PAD = 24, ORB = 140, S = ORB + PAD * 2, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = cv.height = S * dpr;
  const RL = 21, RIM = 4.5, MAG = 1.42, LIGHT = -2.36; // light from top left
  const rm = matchMedia('(prefers-reduced-motion: reduce)');
  let ph = 0, px = 0, py = 0, vx = 0, vy = 0, has = false;

  function cylGrad(hw, stops) { // cylinder shading: linear gradient across the section
    const g = ctx.createLinearGradient(0, -hw, 0, hw);
    stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
    return g;
  }

  function draw(dt, src) {
    const still = rm.matches;
    if (!still) ph += dt * 0.65;
    // scan path (orb coords): slow Lissajous, fixed pose under reduced motion
    const tx = ORB / 2 + (still ? -9 : Math.sin(ph * 0.9) * 33);
    const ty = ORB / 2 + (still ? -7 : Math.sin(ph * 1.37 + 0.7) * 25);
    if (!has) { px = tx; py = ty; has = true; }
    const k = 1 - Math.exp(-dt * 4);
    vx += ((tx - px) / Math.max(dt, 0.001) - vx) * k; vy += ((ty - py) / Math.max(dt, 0.001) - vy) * k;
    px = tx; py = ty;
    const sp = Math.hypot(vx, vy);
    const ha = 0.8 + Math.max(-0.16, Math.min(0.16, -vx * 0.006)); // handle angle, slightly lagging sway with motion
    const cx = PAD + px, cy = PAD + py;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);

    // 1) shadow: lens is held slightly above the orb, shadow falls bottom right
    const hx0 = Math.cos(ha), hy0 = Math.sin(ha), FAR = 1000;
    ctx.save();
    ctx.shadowColor = 'rgba(2,8,30,.55)'; ctx.shadowBlur = 7 * dpr;
    ctx.shadowOffsetX = (FAR + 6) * dpr; ctx.shadowOffsetY = 9 * dpr;
    ctx.strokeStyle = '#000'; ctx.lineCap = 'round';
    ctx.lineWidth = RIM; ctx.beginPath(); ctx.arc(cx - FAR, cy, RL + RIM / 2, 0, 6.2832); ctx.stroke();
    ctx.lineWidth = 8.5; ctx.beginPath();
    ctx.moveTo(cx - FAR + hx0 * (RL + RIM), cy + hy0 * (RL + RIM));
    ctx.lineTo(cx - FAR + hx0 * (RL + RIM + 36), cy + hy0 * (RL + RIM + 36)); ctx.stroke();
    ctx.restore();

    // slight perspective: a little squash along the motion direction (tilt feel)
    ctx.save(); ctx.translate(cx, cy);
    if (sp > 0.5) {
      const a = Math.atan2(vy, vx), sq = 1 - Math.min(0.08, sp * 0.0016);
      ctx.rotate(a); ctx.scale(sq, 1); ctx.rotate(-a);
    }

    // 2) handle: metal neck + dark grip
    ctx.save(); ctx.rotate(ha);
    const x0 = RL + RIM - 1;
    ctx.fillStyle = cylGrad(4.2, ['#3a4457', '#dfe8f6', '#97a5bb', '#5b687e', '#232a37']);
    ctx.beginPath(); ctx.roundRect(x0, -4.2, 8, 8.4, 1.2); ctx.fill();
    ctx.fillStyle = cylGrad(4.9, ['#2b3343', '#c8d4e6', '#6f7d94', '#1b212c']);
    ctx.beginPath(); ctx.roundRect(x0 + 7, -4.9, 2.6, 9.8, 1); ctx.fill(); // collar
    ctx.fillStyle = cylGrad(4.6, ['#0b0f17', '#3c475b', '#222a39', '#141a25', '#05070c']);
    ctx.beginPath(); ctx.roundRect(x0 + 9.4, -4.6, 28, 9.2, [1.5, 4.6, 4.6, 1.5]); ctx.fill();
    ctx.strokeStyle = 'rgba(210,225,250,.16)'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0 + 11, -2.2); ctx.lineTo(x0 + 34, -2.2); ctx.stroke(); // grip highlight
    ctx.restore();

    // 3) glass: the orb underneath appears magnified
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, RL, 0, 6.2832); ctx.clip();
    if (src && src.width) {
      const sc = src.width / ORB, half = (RL / MAG) * sc;
      ctx.drawImage(src, px * sc - half, py * sc - half, half * 2, half * 2, -RL, -RL, RL * 2, RL * 2);
    }
    ctx.fillStyle = 'rgba(150,190,255,.07)'; ctx.fillRect(-RL, -RL, RL * 2, RL * 2); // glass tint
    const fr = ctx.createRadialGradient(0, 0, RL * 0.6, 0, 0, RL); // Fresnel: reflection grows toward the edge
    fr.addColorStop(0, 'rgba(200,225,255,0)'); fr.addColorStop(0.85, 'rgba(190,215,255,.14)'); fr.addColorStop(1, 'rgba(220,236,255,.42)');
    ctx.fillStyle = fr; ctx.fillRect(-RL, -RL, RL * 2, RL * 2);
    const th = ctx.createLinearGradient(-RL, -RL, RL, RL); // glass thickness: side opposite the light is a bit darker
    th.addColorStop(0, 'rgba(0,0,0,0)'); th.addColorStop(0.6, 'rgba(0,0,0,0)'); th.addColorStop(1, 'rgba(4,12,40,.32)');
    ctx.fillStyle = th; ctx.fillRect(-RL, -RL, RL * 2, RL * 2);
    // window reflection: thin crescent + soft blob
    ctx.beginPath(); ctx.arc(0, 0, RL - 2, 3.5, 4.95); ctx.arc(1.6, 1.8, RL - 2.2, 4.95, 3.5, true); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill();
    ctx.save(); ctx.translate(-RL * 0.3, -RL * 0.36); ctx.rotate(-0.75);
    const hl = ctx.createRadialGradient(0, 0, 0, 0, 0, 7);
    hl.addColorStop(0, 'rgba(255,255,255,.38)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.scale(1, 0.45); ctx.beginPath(); ctx.arc(0, 0, 7, 0, 6.2832); ctx.fillStyle = hl; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(RL * 0.5, RL * 0.55, 1.6, 0, 6.2832); ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.fill();
    ctx.restore();

    // 4) metal ring: conic gradient, light from top left
    const cg = ctx.createConicGradient(LIGHT, 0, 0);
    cg.addColorStop(0, '#eef4ff'); cg.addColorStop(0.12, '#a9b6cb'); cg.addColorStop(0.27, '#5d6a80');
    cg.addColorStop(0.5, '#1c2230'); cg.addColorStop(0.66, '#3b465a'); cg.addColorStop(0.8, '#7f8ca3');
    cg.addColorStop(0.92, '#c9d4e6'); cg.addColorStop(1, '#eef4ff');
    ctx.beginPath(); ctx.arc(0, 0, RL + RIM, 0, 6.2832); ctx.arc(0, 0, RL, 0, 6.2832, true);
    ctx.fillStyle = cg; ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(8,12,24,.75)'; ctx.beginPath(); ctx.arc(0, 0, RL + 0.3, 0, 6.2832); ctx.stroke(); // inner bevel
    ctx.strokeStyle = 'rgba(225,235,255,.28)'; ctx.beginPath(); ctx.arc(0, 0, RL + RIM - 0.4, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, RL + RIM * 0.5, 3.45, 4.35); ctx.stroke(); // ring top-face highlight
    ctx.restore();
  }

  return {
    draw,
    reset() { ph = 0; vx = vy = 0; has = false; },
  };
})();
