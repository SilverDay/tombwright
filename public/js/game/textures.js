// Procedural textures and pixel-art sprites, ported verbatim from Gloamhollow
// (reference/gloamhollow/Gloamhollow.html, "procedural textures" and "pixel-art sprites").
// Renderer only: seeded with mulberry32 so the tomb looks the same every time. Not part of the sim.
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- procedural textures ----------
function cv(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function grain(ctx, w, h, amt, rnd) {
  const d = ctx.getImageData(0, 0, w, h), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const v = (rnd() - 0.5) * amt; a[i] += v; a[i + 1] += v; a[i + 2] += v; }
  ctx.putImageData(d, 0, 0);
}
function makeBrick() {
  const r = mulberry32(911), N = 256, c = cv(N), g = c.getContext('2d'), b = cv(N), h = b.getContext('2d');
  g.fillStyle = '#302c2a'; g.fillRect(0, 0, N, N);
  h.fillStyle = '#1c1c1c'; h.fillRect(0, 0, N, N);
  const rows = 5, rh = N / rows;
  for (let row = 0; row < rows; row++) {
    const y = row * rh, widths = []; let acc = 0;
    while (acc < N) { let w = [60, 72, 88, 100, 120][Math.floor(r() * 5)]; if (N - acc - w < 44) w = N - acc; widths.push(w); acc += w; }
    let x = Math.floor(r() * N);
    for (const w of widths) {
      const L = 25 + r() * 12, s = 3 + r() * 8, hue = 20 + r() * 30, hv = 150 + Math.floor(r() * 70);
      for (const ox of [x - N, x, x + N]) {
        if (ox >= N || ox + w <= 0) continue;
        g.fillStyle = `hsl(${hue},${s}%,${L}%)`; g.fillRect(ox + 2, y + 2, w - 4, rh - 4);
        g.fillStyle = 'rgba(255,240,220,.05)'; g.fillRect(ox + 2, y + 2, w - 4, 3);
        g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(ox + 2, y + rh - 5, w - 4, 3);
        h.fillStyle = `rgb(${hv - 60},${hv - 60},${hv - 60})`; h.fillRect(ox + 2, y + 2, w - 4, rh - 4);
        h.fillStyle = `rgb(${hv},${hv},${hv})`; h.fillRect(ox + 5, y + 5, w - 10, rh - 10);
      }
      x = (x + w) % N;
    }
  }
  for (let k = 0; k < 18; k++) {
    const x = r() * N, y = r() * N, rad = 12 + r() * 40;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, r() < 0.75 ? 'rgba(0,0,0,.18)' : 'rgba(60,80,90,.1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  grain(g, N, N, 26, r); grain(h, N, N, 40, r);
  return { color: c, bump: b };
}
function makeFlag() {
  const r = mulberry32(4242), N = 256, c = cv(N), g = c.getContext('2d'), b = cv(N), h = b.getContext('2d');
  g.fillStyle = '#201d1c'; g.fillRect(0, 0, N, N);
  h.fillStyle = '#1e1e1e'; h.fillRect(0, 0, N, N);
  const slab = (x0, y0, x1, y1) => {
    const L = 22 + r() * 9, s = 3 + r() * 6, hue = 24 + r() * 20, hv = 150 + Math.floor(r() * 60);
    g.fillStyle = `hsl(${hue},${s}%,${L}%)`; g.fillRect(x0 + 3, y0 + 3, x1 - x0 - 6, y1 - y0 - 6);
    h.fillStyle = `rgb(${hv - 50},${hv - 50},${hv - 50})`; h.fillRect(x0 + 3, y0 + 3, x1 - x0 - 6, y1 - y0 - 6);
    h.fillStyle = `rgb(${hv},${hv},${hv})`; h.fillRect(x0 + 7, y0 + 7, x1 - x0 - 14, y1 - y0 - 14);
    if (r() < 0.6) {
      const pts = []; let px = x0 + 14 + r() * (x1 - x0 - 28), py = y0 + 14 + r() * (y1 - y0 - 28);
      pts.push([px, py]);
      for (let k = 0; k < 5; k++) { px = clamp(px + (r() - 0.5) * 44, x0 + 8, x1 - 8); py = clamp(py + (r() - 0.5) * 44, y0 + 8, y1 - 8); pts.push([px, py]); }
      for (const [ctx, col, lw] of [[g, 'rgba(8,6,4,.6)', 1.3], [h, 'rgba(40,40,40,.9)', 2]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
        ctx.stroke();
      }
    }
  };
  // One cell is one texture repeat: four slabs, so a trap tile looks exactly like its neighbours.
  const sy = Math.round(128 + (r() - 0.5) * 20);
  for (const [y0, y1] of [[0, sy], [sy, N]]) { const sx = Math.round(128 + (r() - 0.5) * 30); slab(0, y0, sx, y1); slab(sx, y0, N, y1); }
  grain(g, N, N, 22, r); grain(h, N, N, 30, r);
  return { color: c, bump: b };
}
function makeCobble() {
  const r = mulberry32(77), N = 256, G = 6, cs = N / G, pts = [], shade = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { pts.push([(i + 0.15 + r() * 0.7) * cs, (j + 0.15 + r() * 0.7) * cs]); shade.push(0.72 + r() * 0.5); }
  const c = cv(N), g = c.getContext('2d'), img = g.createImageData(N, N);
  const b = cv(N), h = b.getContext('2d'), himg = h.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gi = Math.floor(x / cs), gj = Math.floor(y / cs);
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (let oj = -1; oj <= 1; oj++) for (let oi = -1; oi <= 1; oi++) {
      let ci = gi + oi, cj = gj + oj, ox = 0, oy = 0;
      if (ci < 0) { ci += G; ox = -N; } else if (ci >= G) { ci -= G; ox = N; }
      if (cj < 0) { cj += G; oy = -N; } else if (cj >= G) { cj -= G; oy = N; }
      const p = pts[cj * G + ci], dx = p[0] + ox - x, dy = p[1] + oy - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; id = cj * G + ci; } else if (d < d2) d2 = d;
    }
    const e = d2 - d1, k = (y * N + x) * 4, edge = Math.min(1, e / 7), dome = 1 - Math.min(1, d1 / (cs * 0.75));
    const f = (e < 2.2 ? 0.32 : shade[id] * (0.7 + 0.3 * edge)) + (r() - 0.5) * 0.1;
    img.data[k] = 80 * f; img.data[k + 1] = 76 * f; img.data[k + 2] = 72 * f; img.data[k + 3] = 255;
    const hv = e < 2.2 ? 25 : 80 + 160 * edge * (0.6 + 0.4 * dome);
    himg.data[k] = himg.data[k + 1] = himg.data[k + 2] = hv; himg.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0); h.putImageData(himg, 0, 0);
  return { color: c, bump: b };
}
function makeCeil() {
  const r = mulberry32(31), N = 128, c = cv(N), g = c.getContext('2d');
  g.fillStyle = '#262222'; g.fillRect(0, 0, N, N);
  for (let k = 0; k < 70; k++) {
    const x = r() * N, y = r() * N, rx = 4 + r() * 22, ry = 3 + r() * 14, a = r() * Math.PI;
    g.fillStyle = r() < 0.6 ? `rgba(0,0,0,${0.06 + r() * 0.12})` : `rgba(120,108,100,${0.04 + r() * 0.06})`;
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.beginPath(); g.ellipse(x + ox, y + oy, rx, ry, a, 0, Math.PI * 2); g.fill(); }
  }
  grain(g, N, N, 30, r);
  return c;
}
function makeShelf() {
  // Book-stacked shelves for the Scriptorium walls.
  const r = mulberry32(5150), N = 256, c = cv(N), g = c.getContext('2d');
  g.fillStyle = '#1e1612'; g.fillRect(0, 0, N, N);
  const shelves = 4, sh = N / shelves;
  for (let s = 0; s < shelves; s++) {
    const y0 = s * sh;
    let x = 6;
    while (x < N - 6) {
      const w = 6 + Math.floor(r() * 10), hgt = sh * (0.55 + r() * 0.35), lean = r() < 0.08;
      const hue = [8, 20, 30, 120, 200, 280, 40][Math.floor(r() * 7)], L = 16 + r() * 18;
      g.fillStyle = `hsl(${hue},${20 + r() * 30}%,${L}%)`;
      if (lean) { g.save(); g.translate(x, y0 + sh - 8); g.rotate(-0.25); g.fillRect(0, -hgt, w, hgt); g.restore(); }
      else g.fillRect(x, y0 + sh - 8 - hgt, w, hgt);
      g.fillStyle = 'rgba(220,190,120,.25)'; if (r() < 0.6 && !lean) g.fillRect(x + 1, y0 + sh - 8 - hgt * 0.7, w - 2, 2);
      x += w + (r() < 0.12 ? 10 + r() * 20 : 1);
    }
    g.fillStyle = '#3a2618'; g.fillRect(0, y0 + sh - 8, N, 8);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, y0 + sh - 1, N, 1);
  }
  g.fillStyle = '#2e1e14'; g.fillRect(0, 0, 6, N); g.fillRect(N - 6, 0, 6, N);
  // cobwebs and dust
  for (let k = 0; k < 9; k++) { g.strokeStyle = 'rgba(220,220,220,.08)'; g.lineWidth = 1; g.beginPath(); const x = r() * N, y = r() * N; for (let a = 0; a < 6; a++) { g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 22, y + Math.sin(a) * 22); } g.stroke(); }
  grain(g, N, N, 20, r);
  return c;
}
function makeGrate() {
  const c = cv(128), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#2a2420'; for (let k = 0; k < 8; k++) g.fillRect(k * 16 + 2, 0, 7, 128);
  g.fillStyle = '#3a322a'; g.fillRect(0, 0, 128, 6); g.fillRect(0, 122, 128, 6); g.fillRect(0, 60, 128, 6);
  g.fillStyle = 'rgba(255,120,40,.12)'; for (let k = 0; k < 8; k++) g.fillRect(k * 16 + 9, 6, 7, 116);
  return c;
}
function makeGrateGlow() {
  const c = cv(128), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 8; k++) { const gr = g.createLinearGradient(k * 16 + 9, 0, k * 16 + 16, 0); gr.addColorStop(0, '#5a1a04'); gr.addColorStop(0.5, '#ffb050'); gr.addColorStop(1, '#5a1a04'); g.fillStyle = gr; g.fillRect(k * 16 + 9, 6, 7, 54); g.fillRect(k * 16 + 9, 66, 7, 56); }
  return c;
}
function makeGlow(stops) {
  const c = cv(64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 34, 0, 32, 32, 32);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}
function makePlanks(w, h, seed, gilded) {
  const r = mulberry32(seed), c = cv(w, h), g = c.getContext('2d'), n = 5;
  for (let i = 0; i < n; i++) {
    g.fillStyle = gilded ? `hsl(${38 + r() * 6},${50 + r() * 14}%,${30 + r() * 10}%)` : `hsl(${30 + r() * 10},${6 + r() * 6}%,${30 + r() * 8}%)`;
    g.fillRect(0, i * h / n, w, h / n);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, i * h / n, w, 2);
    for (let k = 0; k < 10; k++) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`; g.fillRect(r() * w, i * h / n + 3 + r() * (h / n - 6), 18 + r() * 60, 1); }
  }
  if (gilded) {
    g.strokeStyle = '#e8c868'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8);
    g.strokeStyle = 'rgba(255,240,180,.5)'; g.lineWidth = 1.5;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(w * (0.15 + k * 0.14), h * 0.5, 7, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#3a2a10'; g.fillRect(w * 0.44, h * 0.3, w * 0.12, h * 0.4);
    g.fillStyle = '#ffe08a'; g.fillRect(w * 0.47, h * 0.38, w * 0.06, h * 0.2);
    g.fillStyle = '#100a04'; for (let a = 0; a < 10; a++) { const t = a / 10 * Math.PI * 2; g.fillRect(w * 0.5 + Math.cos(t) * w * 0.1 - 1, h * 0.5 + Math.sin(t) * h * 0.3 - 1, 2, 2); }
  } else {
    g.fillStyle = '#2b2a2c'; for (const x of [w * 0.1, w * 0.84]) g.fillRect(x, 0, w * 0.06, h);
    g.fillStyle = '#2e2e34'; g.fillRect(w * 0.44, h * 0.3, w * 0.12, h * 0.4);
  }
  grain(g, w, h, 18, r);
  return c;
}
function makeStoneDoor(seed) {
  const r = mulberry32(seed), c = cv(128, 192), g = c.getContext('2d');
  g.fillStyle = '#34302c'; g.fillRect(0, 0, 128, 192);
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 3; g.strokeRect(8, 8, 112, 176); g.strokeRect(18, 18, 92, 156);
  g.strokeStyle = 'rgba(255,240,220,.07)'; g.lineWidth = 2; g.strokeRect(10, 10, 112, 176);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(64, 96, 18, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,240,220,.08)'; g.beginPath(); g.arc(64, 96, 18, Math.PI, Math.PI * 2); g.stroke();
  grain(g, 128, 192, 26, r);
  return c;
}
function makeGrateDoor() {
  const c = cv(128, 192), g = c.getContext('2d');
  g.clearRect(0, 0, 128, 192);
  g.fillStyle = '#5a4630';
  for (let k = 0; k < 6; k++) g.fillRect(8 + k * 22, 0, 7, 192);
  for (const y of [30, 96, 162]) g.fillRect(0, y, 128, 7);
  g.fillStyle = 'rgba(255,230,170,.18)'; for (let k = 0; k < 6; k++) g.fillRect(9 + k * 22, 0, 2, 192);
  return c;
}
function makeMask(face) {
  // A carved stone face on each of the three doors. Original drawings: tragedy, comedy and sleep.
  const c = makeStoneDoor(face === 'weep' ? 71 : face === 'laugh' ? 72 : 73), g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillStyle = '#4a443e'; g.beginPath(); g.ellipse(64, 84, 34, 44, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#141110'; g.strokeStyle = '#141110'; g.lineWidth = 4; g.lineCap = 'round';
  if (face === 'weep') {
    for (const x of [48, 80]) { g.beginPath(); g.ellipse(x, 74, 8, 5, x < 64 ? 0.35 : -0.35, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.arc(64, 116, 14, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    g.strokeStyle = '#1e2a34'; g.lineWidth = 3; for (const x of [46, 82]) { g.beginPath(); g.moveTo(x, 82); g.quadraticCurveTo(x + (x < 64 ? -3 : 3), 104, x, 124); g.stroke(); }
    g.strokeStyle = '#141110'; g.lineWidth = 3; for (const x of [48, 80]) { g.beginPath(); g.moveTo(x - 10, 62 + (x < 64 ? 4 : -4)); g.lineTo(x + 10, 62 + (x < 64 ? -4 : 4)); g.stroke(); }
  } else if (face === 'laugh') {
    for (const x of [48, 80]) { g.beginPath(); g.arc(x, 76, 8, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    g.beginPath(); g.moveTo(42, 100); g.quadraticCurveTo(64, 132, 86, 100); g.closePath(); g.fill();
    g.fillStyle = '#4a443e'; g.fillRect(46, 100, 36, 4);
    g.lineWidth = 3; for (const x of [48, 80]) { g.beginPath(); g.moveTo(x - 9, 64); g.quadraticCurveTo(x, 58, x + 9, 64); g.stroke(); }
  } else {
    for (const x of [48, 80]) { g.beginPath(); g.arc(x, 74, 8, Math.PI * 0.1, Math.PI * 0.9); g.stroke(); }
    g.lineWidth = 3; g.beginPath(); g.moveTo(56, 112); g.lineTo(72, 112); g.stroke();
    g.fillStyle = '#0a0808'; g.beginPath(); g.moveTo(58, 140); g.lineTo(70, 140); g.lineTo(64, 152); g.closePath(); g.fill();
    g.fillRect(62, 132, 4, 10);
    g.strokeStyle = 'rgba(200,210,230,.2)'; g.lineWidth = 2; g.beginPath(); g.arc(64, 146, 12, -Math.PI * 0.7, Math.PI * 0.7, true); g.stroke();
  }
  return c;
}
function makeEye(open) {
  // A carved eye in a stone panel. open: 0 shut, 1 half, 2 wide
  const c = cv(128, 64), g = c.getContext('2d');
  g.fillStyle = '#2e2a28'; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 3; g.strokeRect(3, 3, 122, 58);
  g.strokeStyle = 'rgba(255,240,220,.06)'; g.lineWidth = 2; g.strokeRect(6, 6, 116, 52);
  const lid = [2, 11, 22][open];
  g.fillStyle = '#100c0a'; g.beginPath(); g.moveTo(22, 32); g.quadraticCurveTo(64, 32 - lid * 2, 106, 32); g.quadraticCurveTo(64, 32 + lid * 2, 22, 32); g.fill();
  if (open > 0) {
    g.fillStyle = open === 2 ? '#ffd27a' : '#c8582a'; g.beginPath(); g.arc(64, 32, lid * 0.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#100c0a'; g.beginPath(); g.ellipse(64, 32, 3, lid * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = '#151110'; g.lineWidth = 3; g.beginPath(); g.moveTo(18, 32); g.quadraticCurveTo(64, 32 - lid * 2 - 6, 110, 32); g.stroke();
  for (let k = 0; k < 7; k++) { g.beginPath(); const x = 30 + k * 11.5; g.moveTo(x, 32 - lid * 1.7 - 4 + Math.abs(k - 3) * 1.5); g.lineTo(x + (k - 3) * 1.5, 32 - lid * 1.7 - 10 + Math.abs(k - 3) * 1.5); g.stroke(); }
  return c;
}
function makeCarving(lines, w = 256, h = 160, seed = 3, bronze = false) {
  // Rows of carved, unreadable glyphs. The real words appear when you read it.
  const r = mulberry32(seed), c = cv(w, h), g = c.getContext('2d');
  g.fillStyle = bronze ? '#5a4024' : '#38332e'; g.fillRect(0, 0, w, h);
  g.strokeStyle = bronze ? '#a07844' : 'rgba(0,0,0,.45)'; g.lineWidth = 4; g.strokeRect(5, 5, w - 10, h - 10);
  const lh = (h - 30) / lines;
  for (let L = 0; L < lines; L++) {
    let x = 18; const y = 18 + L * lh + lh * 0.25;
    while (x < w - 22) {
      const gw = 5 + r() * 8; g.strokeStyle = bronze ? 'rgba(20,12,4,.85)' : 'rgba(10,8,6,.8)'; g.lineWidth = 2;
      g.beginPath(); const s = Math.floor(r() * 5);
      if (s === 0) { g.moveTo(x, y); g.lineTo(x + gw, y + lh * 0.5); } else if (s === 1) { g.moveTo(x, y + lh * 0.5); g.lineTo(x + gw / 2, y); g.lineTo(x + gw, y + lh * 0.5); }
      else if (s === 2) { g.arc(x + gw / 2, y + lh * 0.25, gw / 2.4, 0, Math.PI * 2); } else if (s === 3) { g.moveTo(x, y); g.lineTo(x, y + lh * 0.5); g.moveTo(x, y + lh * 0.25); g.lineTo(x + gw, y + lh * 0.25); }
      else { g.moveTo(x, y + lh * 0.5); g.lineTo(x + gw, y); }
      g.stroke(); x += gw + 3 + (r() < 0.15 ? 9 : 0);
    }
  }
  grain(g, w, h, 18, r);
  return c;
}
function makeScrawl() {
  const c = cv(256, 96), g = c.getContext('2d'), r = mulberry32(88);
  g.clearRect(0, 0, 256, 96);
  g.strokeStyle = 'rgba(230,226,212,.75)'; g.lineWidth = 2.4; g.lineCap = 'round';
  let x = 14;
  for (let k = 0; k < 17; k++) { g.beginPath(); const y = 36 + (r() - 0.5) * 8; g.moveTo(x, y + 14); g.lineTo(x + 4 + r() * 6, y - 10 + r() * 6); g.lineTo(x + 9 + r() * 4, y + 14); if (r() < 0.5) { g.moveTo(x + 2, y + 2); g.lineTo(x + 11, y + 2); } g.stroke(); x += 14; }
  g.beginPath(); g.moveTo(170, 74); g.lineTo(196, 74); g.stroke();
  g.beginPath(); g.moveTo(204, 64); g.lineTo(206, 82); g.moveTo(206, 64); g.quadraticCurveTo(218, 68, 206, 73); g.quadraticCurveTo(220, 77, 206, 82); g.stroke();
  return c;
}
function makeMark() {
  // Masons' phosphor chalk: a small ring and dot.
  const c = cv(64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  gr.addColorStop(0, 'rgba(180,255,210,.9)'); gr.addColorStop(0.25, 'rgba(120,230,170,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(210,255,225,.95)'; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 13, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(230,255,240,1)'; g.beginPath(); g.arc(32, 32, 3.5, 0, Math.PI * 2); g.fill();
  return c;
}
function makeX() {
  const c = cv(128), g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,150,90,.85)'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(26, 26); g.lineTo(102, 102); g.moveTo(102, 26); g.lineTo(26, 102); g.stroke();
  g.strokeStyle = 'rgba(255,150,90,.4)'; g.lineWidth = 3; g.strokeRect(10, 10, 108, 108);
  return c;
}
function makeGhost() {
  // The unlit road: faint carved runes on a slab of nothing.
  const c = cv(128), g = c.getContext('2d'), r = mulberry32(19);
  g.fillStyle = 'rgba(80,170,230,.18)'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(150,220,255,.9)'; g.lineWidth = 3; g.strokeRect(4, 4, 120, 120);
  g.lineWidth = 2; g.strokeStyle = 'rgba(150,220,255,.55)';
  for (let k = 0; k < 6; k++) { g.beginPath(); const x = 20 + r() * 88, y = 20 + r() * 88; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30); g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30); g.stroke(); }
  return c;
}
function makeWater() {
  const c = cv(64), g = c.getContext('2d'), r = mulberry32(5);
  g.fillStyle = '#0e1c26'; g.fillRect(0, 0, 64, 64);
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(120,180,220,${0.05 + r() * 0.12})`; g.fillRect(r() * 64, r() * 64, 6 + r() * 14, 1); }
  return c;
}

// ---------- pixel-art sprites ----------
function pix(rows, pal, sym) {
  const R = sym ? rows.map(r => r + [...r].reverse().join('')) : rows.slice();
  const w = Math.max(...R.map(r => r.length)), h = R.length, c = cv(w, h), g = c.getContext('2d');
  R.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch === '.') continue; g.fillStyle = pal[ch] || '#ff00ff'; g.fillRect(x, y, 1, 1); } });
  return c;
}
const ART = {
  warden: pix(['.....www', '....wwww', '....wkkw', '....wwww', '.....wkw', '......ww', '...wwwww', '..w.wbwb', '..w.wbwb', '.w..wbww', '.w...wbw',
    '.c...www', '.c...w.w', '.c...w..', '.....w..', '.....w..', '....ww..'], { w: '#d8d0bc', k: '#1a1410', b: '#8a8070', c: '#a89870' }, true),
  crawler: pix(['.....kkk', '...kkKKK', '..kKKKKK', '.kKKyKKK', 'kKKKKKKK', 'k.KKKKKK', 'k.k.k.kK', '.k.k.k.k'], { k: '#1c1420', K: '#3a2c44', y: '#ffd860' }, true),
  eater: pix(['..c...c..c', '..f...f..f', '..c..cc..c', '..cKKKKKKK', '..KKkkkkkK', '...KkokkkK', '...KkkkkKK', '....KkkkKK', '....KkooKK', '.....KoooK', '......KkkK',
    '....KKKKKK', '..KKKkKKkK', '.KKk.KKKkK', '.Kk..KkKKK', 'Kk...KKkKK', 'k....KKKKk', '.....KkKKK', '.....KKKkK', '....KKkKKK', '....KkKKkK', '...KKKKkKK', '...KkKK.KK', '..KK.Kk.kK', '..k..K..K.', '.....k...k'],
    { c: '#e8dcc0', f: '#ffcf6a', K: '#2a2428', k: '#0e0c0e', o: '#ff9a3a' }, true),
  bones: pix(['..........ww..', '.ww......wkkw.', 'wwww.....wwww.', '.ww.wwwww.ww..', '....w.w.w.....', '..wwwwwwwww...', '....w.w.w..www', '....wwwww.ww..', '...w.....w....', '..w.......w...'],
    { w: '#c8c0ac', k: '#1a1410' }),
  burnt: pix(['..........ww..', '.ww......wkkw.', 'wwww.....wwww.', '.ww.wwwww.ww..', '....w.w.w..ll.', '..wwwwwwwwwLl.', '....w.w.w..ll.', '....wwwww.ww..', '...w.....w....', '..w.......w...'],
    { w: '#4a3e36', k: '#0a0806', l: '#b8b8c0', L: '#ffe080' }),
  hand: pix(['..w.w.w', '..w.w.w.w', '.wwwwwwww', '.wwwwwwww', '..wwwwww', '...wwww', '...ww'], { w: '#c8c0ac' }),
  candles: pix(['.c.......c....', '.c...c...c..c.', 'cc..cc..ccc.cc', 'ccc.cc..ccc.cc', 'ccc.ccc.ccc.cc', 'dddddddddddddd'], { c: '#d8ccb0', d: '#3a3230' }),
  rubble: pix(['.....aa.....', '...abba.a...', '..abbbbaab..', '.abbabbbbba.', 'abbbbbabbbba'], { a: '#8a8278', b: '#5a544c' }),
};
const ICON = {
  coins: pix(['...yy..yy.', '..yYYyyYYy', '..yyyyyyyy', 'yy.yyyyyy.', 'YYy.yyyy..', 'yyyy......'], { y: '#c8a040', Y: '#ffe08a' }),
  chain: pix(['.ss.ss.ss.', 's..s..s..s', '.ss.ss.ss.', '.......s..', '......sSs.', '.......s..'], { s: '#b8bcc8', S: '#ffffff' }),
  censer: pix(['....y.....', '...y.y....', '....y.....', '..yyyyy...', '.yYYYYYy..', '.yyyyyyy..', '..yyyyy...', '...yyy....', '..yyyyy...'], { y: '#c89a30', Y: '#ffe48a' }),
  gem: pix(['..aaaa..', '.aAAAAa.', 'aAAwAAAa', '.aAAAAa.', '..aAAa..', '...aa...'], { a: '#e07a20', A: '#ffc860', w: '#fff8e0' }),
  rubies: pix(['.rr...rr..', 'rRRr.rRRr.', '.rr...rr..', '...rr.....', '..rRRr.rr.', '...rr.rRRr', '.......rr.'], { r: '#9a1020', R: '#ff5060' }),
  ring: pix(['...ww...', '..wWWw..', '...ww...', '.yyyyyy.', 'y......y', 'y......y', '.yyyyyy.'], { y: '#d0b060', w: '#c8d8ff', W: '#ffffff' }),
  key: pix(['.kk......', 'k..k.....', 'k..kkkkkk', 'k..k..k.k', '.kk......'], { k: '#3a3a44' }),
  flask: pix(['...cc...', '...cc...', '..gggg..', '.goooog.', '.goOoog.', '.goooog.', '..gggg..'], { c: '#8a6a40', g: '#7a8a8a', o: '#c98a2c', O: '#ffd070' }),
  heart: pix(['..rr.rr..', '.rRRrRRr.', '.rRYYYRr.', '.rRYWYRr.', '..rRYRr..', '...rRr...', '....r....'], { r: '#8a2010', R: '#ff6a2a', Y: '#ffc040', W: '#fff4c0' }),
};


// ---------- button glyphs (decision #95): sixteen runes, drawn as strokes on a dark stone face ----------
const GLYPH_DRAW = {
  moon: (g) => { g.beginPath(); g.arc(64, 64, 38, 0.55 * Math.PI, 1.45 * Math.PI, true); g.arc(78, 64, 30, 1.35 * Math.PI, 0.65 * Math.PI, false); g.stroke(); },
  sun: (g) => { g.beginPath(); g.arc(64, 64, 18, 0, 6.3); g.stroke(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.beginPath(); g.moveTo(64 + Math.cos(a) * 28, 64 + Math.sin(a) * 28); g.lineTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44); g.stroke(); } },
  eye: (g) => { g.beginPath(); g.moveTo(14, 64); g.quadraticCurveTo(64, 14, 114, 64); g.quadraticCurveTo(64, 114, 14, 64); g.stroke(); g.beginPath(); g.arc(64, 64, 14, 0, 6.3); g.stroke(); },
  key: (g) => { g.beginPath(); g.arc(40, 64, 16, 0, 6.3); g.moveTo(56, 64); g.lineTo(112, 64); g.moveTo(96, 64); g.lineTo(96, 82); g.moveTo(108, 64); g.lineTo(108, 78); g.stroke(); },
  hand: (g) => { g.beginPath(); g.moveTo(40, 110); g.lineTo(40, 70); g.lineTo(30, 52); g.moveTo(40, 70); g.lineTo(52, 30); g.moveTo(52, 70); g.lineTo(64, 22); g.moveTo(64, 70); g.lineTo(78, 28); g.moveTo(76, 74); g.lineTo(98, 44); g.moveTo(40, 110); g.lineTo(84, 110); g.lineTo(84, 70); g.stroke(); },
  flame: (g) => { g.beginPath(); g.moveTo(64, 14); g.quadraticCurveTo(100, 54, 88, 90); g.quadraticCurveTo(64, 120, 40, 90); g.quadraticCurveTo(30, 62, 56, 44); g.quadraticCurveTo(54, 66, 66, 72); g.quadraticCurveTo(76, 46, 64, 14); g.stroke(); },
  drop: (g) => { g.beginPath(); g.moveTo(64, 14); g.quadraticCurveTo(100, 64, 94, 84); g.arc(64, 84, 30, 0, Math.PI, false); g.quadraticCurveTo(28, 64, 64, 14); g.stroke(); },
  leaf: (g) => { g.beginPath(); g.moveTo(24, 104); g.quadraticCurveTo(24, 24, 104, 24); g.quadraticCurveTo(104, 104, 24, 104); g.moveTo(24, 104); g.lineTo(78, 50); g.stroke(); },
  star: (g) => { g.beginPath(); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 4 * Math.PI / 5; g[k ? 'lineTo' : 'moveTo'](64 + Math.cos(a) * 46, 66 + Math.sin(a) * 46); } g.closePath(); g.stroke(); },
  skull: (g) => { g.beginPath(); g.arc(64, 54, 34, Math.PI, 0); g.lineTo(98, 82); g.lineTo(80, 82); g.lineTo(80, 100); g.lineTo(48, 100); g.lineTo(48, 82); g.lineTo(30, 82); g.closePath(); g.moveTo(58, 62); g.arc(50, 62, 8, 0, 6.3); g.moveTo(86, 62); g.arc(78, 62, 8, 0, 6.3); g.stroke(); },
  crown: (g) => { g.beginPath(); g.moveTo(20, 96); g.lineTo(20, 44); g.lineTo(44, 70); g.lineTo(64, 32); g.lineTo(84, 70); g.lineTo(108, 44); g.lineTo(108, 96); g.closePath(); g.stroke(); },
  bell: (g) => { g.beginPath(); g.moveTo(24, 92); g.quadraticCurveTo(30, 90, 34, 60); g.quadraticCurveTo(40, 22, 64, 22); g.quadraticCurveTo(88, 22, 94, 60); g.quadraticCurveTo(98, 90, 104, 92); g.closePath(); g.moveTo(56, 100); g.arc(64, 100, 8, Math.PI, 0, true); g.stroke(); },
  tower: (g) => { g.beginPath(); g.moveTo(40, 112); g.lineTo(40, 36); g.lineTo(34, 36); g.lineTo(34, 22); g.lineTo(46, 22); g.lineTo(46, 30); g.lineTo(58, 30); g.lineTo(58, 22); g.lineTo(70, 22); g.lineTo(70, 30); g.lineTo(82, 30); g.lineTo(82, 22); g.lineTo(94, 22); g.lineTo(94, 36); g.lineTo(88, 36); g.lineTo(88, 112); g.stroke(); g.beginPath(); g.moveTo(56, 112); g.lineTo(56, 88); g.arc(64, 88, 8, Math.PI, 0); g.lineTo(72, 112); g.stroke(); },
  wave: (g) => { for (const y of [48, 74]) { g.beginPath(); g.moveTo(12, y); for (let k = 0; k < 4; k++) g.quadraticCurveTo(12 + 26 * k + 13, y - 22, 12 + 26 * (k + 1), y); g.stroke(); } },
  bird: (g) => { g.beginPath(); g.moveTo(14, 70); g.quadraticCurveTo(40, 20, 64, 64); g.quadraticCurveTo(88, 20, 114, 70); g.stroke(); g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 100); g.stroke(); },
  serpent: (g) => { g.beginPath(); g.moveTo(24, 100); g.bezierCurveTo(24, 70, 64, 90, 64, 64); g.bezierCurveTo(64, 38, 104, 58, 104, 28); g.stroke(); g.beginPath(); g.arc(104, 22, 6, 0, 6.3); g.stroke(); },
};
/** A button's glyph (one of 16 runes, R-BTN-1) as a square canvas: pale strokes on dark stone. */
function makeGlyph(name) {
  const c = cv(128), g = c.getContext('2d');
  g.fillStyle = '#2a2622'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#d8cfae'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
  (GLYPH_DRAW[name] ?? GLYPH_DRAW.star)(g);
  return c;
}

export { makeGlyph, cv, makeBrick, makeFlag, makeCobble, makeCeil, makeShelf, makeGrate, makeGrateGlow, makeGlow, makePlanks,
  makeStoneDoor, makeGrateDoor, makeMask, makeEye, makeCarving, makeScrawl, makeMark, makeX, makeGhost, makeWater, ART, ICON, mulberry32, clamp };
