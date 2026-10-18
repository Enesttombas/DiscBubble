// Scan orb: transparent glass sphere + liquid with a 3D feel (surface ellipse seen from above, refraction, rim reflection).
// set(f): 0-1 fill level, null = unknown (sloshes like a tide).
const orb = (() => {
  const cv = document.getElementById('orbCv'), ctx = cv.getContext('2d');
  const S = 140, R = 60, dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = cv.height = S * dpr; ctx.scale(dpr, dpr);
  const cx = S / 2, cy = S / 2;
  let raf = 0, t0 = 0, last = 0, target = 0.35, lv = 0, unk = true, slosh = 0, bubs = [];
  for (let i = 0; i < 10; i++) bubs.push({ x: (Math.random() - 0.5) * R * 1.2, y: Math.random(), r: 1 + Math.random() * 2.2, s: 0.08 + Math.random() * 0.16, ph: Math.random() * 6.28 });

  function frame(now) {
    const t = (now - t0) / 1000;
    // time-based smoothing: frame-rate independent, no jump when the tab pauses and resumes
    const dt = Math.min(0.1, Math.max(0.001, (now - (last || now)) / 1000)); last = now;
    let goal = unk ? 0.5 + Math.sin(t * 0.7) * 0.14 : Math.max(0.05, Math.min(0.96, target));
    if (!Number.isFinite(goal)) goal = Number.isFinite(lv) ? lv : 0.3;
    if (!Number.isFinite(lv)) lv = goal;
    const vel = Math.abs(goal - lv);
    slosh += (Math.min(0.45, vel * 5) - slosh) * (1 - Math.exp(-dt * 2.5)); // slight on fast rise, calm when stopped
    lv += (goal - lv) * (1 - Math.exp(-dt * 3));
    const y0 = cy + R - lv * R * 2;                       // center of the liquid surface
    const half = Math.sqrt(Math.max(0, R * R - (y0 - cy) * (y0 - cy))) - 1; // half-width of the surface inside the sphere
    const tilt = Math.sin(t * 0.9) * (0.025 + slosh * 0.08); // liquid tilt
    const amp = 1.4 + slosh * 2.6 + (unk ? 0.6 : 0), ry = Math.max(2.5, half * 0.2);
    ctx.clearRect(0, 0, S, S);

    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.clip();
    // glass interior: nearly transparent, slightly blue
    const bg = ctx.createRadialGradient(cx - 14, cy - 18, 4, cx, cy, R);
    bg.addColorStop(0, 'rgba(170,205,255,.07)'); bg.addColorStop(1, 'rgba(40,80,170,.10)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);

    // liquid body (below the surface): tilted, wavy top edge; translucent
    const lg = ctx.createLinearGradient(0, y0 - 6, 0, cy + R);
    lg.addColorStop(0, 'rgba(120,180,255,.62)'); lg.addColorStop(0.5, 'rgba(60,115,240,.62)'); lg.addColorStop(1, 'rgba(25,50,170,.72)');
    ctx.beginPath(); ctx.moveTo(cx - R, cy + R + 4);
    for (let x = -R; x <= R; x += 3) ctx.lineTo(cx + x, y0 + x * tilt + Math.sin(x / 9 + t * 1.6) * amp * 0.6 + Math.sin(x / 4 - t * 2.1) * amp * 0.25);
    ctx.lineTo(cx + R, cy + R + 4); ctx.closePath(); ctx.fillStyle = lg; ctx.fill();
    // volume: liquid darkens toward the edges
    const body = ctx.createRadialGradient(cx - 8, cy + 4, R * 0.2, cx, cy, R);
    body.addColorStop(0, 'rgba(0,0,0,0)'); body.addColorStop(1, 'rgba(0,10,60,.55)');
    ctx.fillStyle = body; ctx.fillRect(0, y0 - 8, S, S);
    // bubbles
    for (const b of bubs) {
      b.y -= b.s * 0.012; if (b.y < 0) { b.y = 1; b.x = (Math.random() - 0.5) * R * 1.2; }
      const yy = cy + R - 4 - (cy + R - y0 - 6) * (1 - b.y);
      if (yy > y0 + 5) { ctx.beginPath(); ctx.arc(cx + b.x + Math.sin(t * 2 + b.ph) * 2.5, yy, b.r, 0, 6.2832); ctx.fillStyle = 'rgba(235,245,255,.6)'; ctx.fill(); }
    }
    // refraction: bright focus inside the liquid, opposite the light
    ctx.globalCompositeOperation = 'lighter';
    const ca = ctx.createRadialGradient(cx + 22, cy + R - 14, 2, cx + 22, cy + R - 14, 34);
    ca.addColorStop(0, 'rgba(150,235,255,.55)'); ca.addColorStop(1, 'rgba(150,235,255,0)');
    ctx.fillStyle = ca; ctx.fillRect(0, y0, S, S);
    ctx.globalCompositeOperation = 'source-over';

    // liquid surface: ellipse seen from above (3D depth) + ring ripples
    ctx.save(); ctx.translate(cx, y0); ctx.rotate(Math.atan(tilt));
    const sg = ctx.createRadialGradient(-half * 0.25, -ry * 0.4, 1, 0, 0, half);
    sg.addColorStop(0, 'rgba(215,235,255,.70)'); sg.addColorStop(0.7, 'rgba(120,175,255,.42)'); sg.addColorStop(1, 'rgba(70,120,230,.30)');
    ctx.beginPath(); ctx.ellipse(0, 0, half, ry, 0, 0, 6.2832); ctx.fillStyle = sg; ctx.fill();
    for (let k = 0; k < 3; k++) {
      const ph = ((t * 0.45 + k / 3) % 1), rr = ph * 0.92;
      ctx.beginPath(); ctx.ellipse(0, 0, half * rr, ry * rr, 0, 0, 6.2832);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(235,245,255,' + (0.5 * (1 - ph)) + ')'; ctx.stroke();
    }
    ctx.beginPath(); ctx.ellipse(0, 0, half, ry, 0, 0, 6.2832); ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(225,240,255,.85)'; ctx.stroke();
    ctx.restore();

    // Fresnel: bright at the rim, transparent in the middle
    const fr = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
    fr.addColorStop(0, 'rgba(190,220,255,0)'); fr.addColorStop(0.8, 'rgba(160,205,255,.16)'); fr.addColorStop(1, 'rgba(210,235,255,.5)');
    ctx.fillStyle = fr; ctx.fillRect(0, 0, S, S);
    // colored light reflected at the bottom edge
    const bl = ctx.createRadialGradient(cx + 10, cy + R + 14, R * 0.5, cx + 10, cy + R + 14, R * 0.95);
    bl.addColorStop(0, 'rgba(120,230,255,0)'); bl.addColorStop(0.75, 'rgba(120,230,255,0)'); bl.addColorStop(1, 'rgba(120,230,255,.35)');
    ctx.fillStyle = bl; ctx.fillRect(0, 0, S, S);
    ctx.restore();

    // glass rim
    const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rim.addColorStop(0, 'rgba(240,248,255,.95)'); rim.addColorStop(0.45, 'rgba(130,175,255,.22)'); rim.addColorStop(1, 'rgba(160,220,255,.75)');
    ctx.lineWidth = 1.8; ctx.strokeStyle = rim; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
    // window reflection (top left) + small sharp spot
    ctx.save(); ctx.translate(cx - 25, cy - 30); ctx.rotate(-0.62);
    const hl = ctx.createLinearGradient(0, -10, 0, 10); hl.addColorStop(0, 'rgba(255,255,255,.85)'); hl.addColorStop(1, 'rgba(255,255,255,.04)');
    ctx.beginPath(); ctx.ellipse(0, 0, 19, 8.5, 0, 0, 6.2832); ctx.fillStyle = hl; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.arc(cx + 28, cy + 32, 3, 0, 6.2832); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R - 4, 0.3, 1.2); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.stroke();
    if (typeof lens !== 'undefined') lens.draw(dt, cv); // magnifier in the same frame, after the orb is drawn
    raf = requestAnimationFrame(frame);
  }
  return {
    set(f) { if (f == null || !Number.isFinite(f)) unk = true; else { unk = false; target = f; } },
    start() { if (raf) return; lv = 0; slosh = 0; last = 0; t0 = performance.now(); if (typeof lens !== 'undefined') lens.reset(); raf = requestAnimationFrame(frame); },
    stop() { cancelAnimationFrame(raf); raf = 0; },
  };
})();
