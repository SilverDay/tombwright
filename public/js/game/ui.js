// Panels, cards, toasts, the map, touch controls, sound cues and saving (M0 step 6b).
// Ported from Gloamhollow (reference/gloamhollow/Gloamhollow.html: messages, panels, save, flow, input, map).
// Client side only: it reads the sim state and the events, and feeds input back through the Game.
// Text goes in with textContent; nodes are built with createElement (spec §11).
import * as Sim from '../sim/sim.js';
import { AUD, audioInit, sfx } from './audio.js';
import { DEATHS, EPITAPHS, FLASK_NAME, cap, itemName } from './text.js';

const $ = (id) => document.getElementById(id);
const S = 2400, CELL = { WALL: 0, CORR: 2, PLATE: 3, HPIT: 4, VOID: 5, BRIDGE: 6, VENT: 7 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const fmtTime = (ticks) => { const s = Math.floor(ticks / Sim.TICK_HZ), m = Math.floor(s / 60); return `${m} min ${s % 60} s`; };
const SAVE_V = 1;

export class UI {
  constructor(game, opts) {
    this.g = game; this.reduced = opts.reduced; this.coarse = opts.coarse;
    const T = game.T, ents = T.gdf.entities;
    this.saveKey = `tombwright:${T.name}:v${SAVE_V}`;
    this.treasureTotal = ents.filter((e) => e.type === 'item' && e.kind === 'treasure').reduce((a, e) => a + e.value, 0);
    this.panel = null; this.readT = null; this.readPage = 0; this.notes = [];
    this.seen = new Uint8Array(T.w * T.h); this.sightT = 0; this.miniT = 0; this.saveT = 0;
    this.touchedOnce = false; this.stick = { active: false, id: -1, ox: 0, oy: 0, vx: 0, vy: 0 }; this.lookP = { active: false, id: -1, x: 0, y: 0 };
    this.restartArm = false; this.newArm = false; this.beamHit = false; this.bossWas = null; this.stepBob = 0;
    this.mini = $('mini'); this.miniCtx = this.mini.getContext('2d'); this.big = $('big'); this.bigCtx = this.big.getContext('2d');
    this.bind();
  }

  // ---------------------------------------------------------------- messages
  toast(t, sub) {
    const e = $('toast'); e.replaceChildren(t); if (sub) e.append(el('small', sub));
    e.classList.add('on'); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => e.classList.remove('on'), 1700);
  }
  flash(color, ms = 120) {
    const f = $('flash'); f.style.background = color; f.classList.add('on'); f.style.opacity = '1';
    setTimeout(() => { f.classList.remove('on'); f.style.opacity = '0'; }, ms);
  }
  vig(on) { $('vig').style.opacity = on ? '1' : '0'; }

  // ---------------------------------------------------------------- sim events -> sound, toasts, cards
  afterTick(events, input, prev) {
    const g = this.g, st = g.st, T = g.T, ents = T.gdf.entities;
    let doorEv = false;
    for (const ev of events) {
      switch (ev.e) {
        case 'swing': sfx.swing(); break;
        case 'hit': sfx.hit(); break;
        case 'foeDead': sfx.kill(); break;
        case 'hurt': sfx.hurt(); this.vig(true); setTimeout(() => { if (st.dead === null) this.vig(false); }, 260); break;
        case 'item': {
          const it = ents.find((e) => e.id === ev.id);
          if (ev.kind === 'treasure') { sfx.gold(); if (it.cell || it.value) this.toast(cap(itemName(T, it, 'treasure')), `+${it.value} treasure`); if (it.id === 'heart') sfx.win(); }
          else if (ev.kind === 'key') { sfx.pickup(); this.toast(cap(itemName(T, it, 'a key'))); }
          else sfx.pickup();
          break;
        }
        case 'door': doorEv = true; if (ev.open) { if (ents.find((e) => e.id === ev.id)?.style === 'grate') sfx.grate(); else sfx.door(); } break;
        case 'chest': if (ev.look) { sfx.read(); const t = ents.find((e) => e.type === 'inscription' && e.on === ev.id); if (t) this.openRead(t); } else sfx.chest(); break;
        case 'probe': sfx.probe(); if (ev.k === 'plate' || ev.k === 'pit') sfx.hollow(); else if (ev.k === 'bridge') sfx.clink(); else if (ev.k === 'needles') sfx.dart(); else if (ev.k === 'tip') sfx.laugh(); break;
        case 'land': if (ev.k === 'plate') { sfx.thud(); } else if (ev.k === 'pit') sfx.hollow(); else if (ev.k === 'bridge') sfx.clink(); else if (ev.k === 'floor' || ev.k === 'slab') sfx.pebble(); break;
        case 'hood': case 'hook': case 'busy': sfx.hood(); break;
        case 'oil': sfx.pour(); break;
        case 'bell': { const b = ents.find((e) => e.id === ev.id); sfx.bell(b.note); break; }
        case 'bellsWrong': setTimeout(() => { sfx.clash(); sfx.dart(); }, 650); break;
        case 'bellsSolved': setTimeout(() => sfx.solve(), 900); break;
        case 'mirror': sfx.mirror(); break;
        case 'button': sfx.click(); break;                  // R-BTN-2
        case 'lever': sfx.lever(); break;                   // R-LEVER-2
        case 'find': sfx.find(); this.toast('A hidden button', 'The pole finds something set in the stone.'); break; // R-BTN-4
        case 'eyes': sfx.wake(); break;
        case 'alcove': { const a = ents.find((e) => e.id === ev.id); if (a.kind === 'drown') sfx.water(); else sfx.laugh(); break; }
        case 'brazier': if (ev.lit) sfx.ignite(); else sfx.gulp(); break;
        case 'boss': if (ev.smoke) sfx.smoke(); else if (ev.phase === 2) sfx.shriek(); else if (ev.st === 'feed') sfx.gulp(); else if (ev.summon) sfx.boss(); break;
        case 'shot': if (ev.k === 'fire') sfx.fire(); else sfx.dart(); break; // R-SHOT-3
        case 'bossDead': sfx.shriek(); sfx.win(); break;
        case 'checkpoint': sfx.checkpoint(); this.toast('Checkpoint', 'You will rise here if you die'); this.save(); break;
        case 'death': this.onDeath(ev.cause); break;
        case 'rise': $('death').hidden = true; this.vig(false); this.save(); break;
        case 'won': this.onWin(); break;
        case 'power': ({ douse: () => sfx.smoke(), freeze: () => sfx.frost(), seize: () => sfx.thud(), confuse: () => sfx.blink(), poison: () => sfx.dart(), drain: () => sfx.steal() })[ev.k]?.(); break;
        case 'relit': sfx.ignite(); break;
        case 'steal': sfx.steal(); break;
        case 'loot': sfx.gold(); break;
        case 'forget': sfx.blink(); break;
        case 'reveal': sfx.boss(); break;
        case 'free': sfx.hood(); break;
        default: break;
      }
    }
    // Gloamhollow's locked-door click: you tried a door and it didn't move.
    if (input.target && (input.buttons & Sim.BTN.interact) && !(prev.buttons & Sim.BTN.interact) && !doorEv) {
      const e = ents[input.target - 1];
      if (e && e.type === 'door' && e.opens !== 'interact' && !st.doors[ents.filter((x) => x.type === 'door').indexOf(e)].open) sfx.locked();
    }
    // The mirror puzzle's moment; the boss waking.
    const hit = !!g.info().beam?.hits;
    if (hit && !this.beamHit) sfx.solve();
    this.beamHit = hit;
    const bst = st.boss?.st ?? null;
    if (this.bossWas === 'asleep' && bst && bst !== 'asleep' && bst !== 'dead') sfx.roar();
    this.bossWas = bst;
    // footsteps
    const v = Math.hypot(st.player.vx, st.player.vz) / 1000, nb = this.stepBob + v * (1 / 30) * 2.3;
    if (Math.floor(this.stepBob / Math.PI) !== Math.floor(nb / Math.PI) && v > 1) sfx.step();
    this.stepBob = nb;
  }

  onDeath(cause) {
    const g = this.g;
    if (cause === 'pit' || cause === 'chasm' || cause === 'tip') sfx.fall();
    else if (cause === 'slab') { sfx.crunch(); this.flash('rgba(20,16,12,.95)', 900); }
    else if (cause === 'eyes') { sfx.sear(); this.flash('rgba(255,230,170,.95)', 600); }
    else if (cause === 'vent') { sfx.sear(); this.flash('rgba(255,140,40,.85)', 500); }
    else if (cause === 'needles') { this.flash('rgba(80,140,60,.6)', 700); sfx.die(); }
    else if (cause === 'drown') { sfx.water(); this.flash('rgba(20,50,80,.9)', 1200); }
    else { sfx.die(); this.vig(true); }
    this.releaseStick(); this.save();
    const at = g.st.deaths;
    setTimeout(() => { if (g.st.dead !== null && g.st.deaths === at) this.showDeath(cause); }, this.reduced ? 300 : 1700);
  }
  showDeath(cause) {
    const g = this.g, st = g.st, D = DEATHS[cause] ?? DEATHS.beast;
    const ep = EPITAPHS[(st.deaths - 1) % EPITAPHS.length];
    const fit = (s) => { s = s.slice(0, 17); const pad = 17 - s.length, l = Math.floor(pad / 2); return ' '.repeat(l) + s + ' '.repeat(pad - l); };
    let s = '        _____________\n       /             \\\n      /   REST  IN    \\\n     /     PEACE       \\\n    /                   \\\n';
    for (const l of [ep, '', `death no. ${st.deaths}`]) s += `   |  ${fit(l)}  |\n`;
    s += '   |                     |\n  _|_____________________|_';
    $('rip').textContent = s;
    $('deathCause').textContent = $('msg').textContent;
    $('deathLesson').textContent = D.lesson;
    const cpZone = st.checkpoints[st.cp].zone;
    $('riseBtn').textContent = cpZone >= 0 ? `Rise in ${g.T.gdf.zones[cpZone].name}` : 'Rise again';
    this.summary($('deathSum'), [['Deaths', st.deaths], ['Treasure', `${this.treasure()} of ${this.treasureTotal}`], ['Time', fmtTime(st.tick)]]);
    $('death').hidden = false; $('riseBtn').focus({ preventScroll: true });
  }
  summary(dl, rows) { dl.replaceChildren(); for (const [a, b] of rows) dl.append(el('dt', a), el('dd', String(b))); }
  treasure() { const st = this.g.st, ents = this.g.T.gdf.entities; return st.taken.reduce((a, n) => a + (ents[n - 1].value ?? 0), 0); }

  onWin() {
    const g = this.g, st = g.st, ents = g.T.gdf.entities;
    sfx.win(); this.clearSave(); this.toast('Into daylight');
    const fade = $('fade'); fade.classList.add('day', 'on');
    const d = st.deaths;
    const rating = d === 0 ? 'Not one death. The tomb will tell stories about you.' : d <= 3 ? 'Light on your feet, and only a little dead.' : d <= 10 ? 'Stubborn. The tomb tried, and kept trying.' : 'The tomb’s most faithful visitor.';
    setTimeout(() => {
      $('winLede').textContent = rating;
      const names = st.taken.map((n) => ents[n - 1]).filter((e) => e.kind === 'treasure').map((e) => itemName(g.T, e, e.id));
      this.summary($('winSum'), [['Treasure', `${this.treasure()} of ${this.treasureTotal}`], ['Carried out', names.join(', ') || 'nothing'], ['Deaths', d], ['Time', fmtTime(st.tick)]]);
      $('win').hidden = false; $('winNew').focus({ preventScroll: true }); fade.classList.remove('on'); setTimeout(() => fade.classList.remove('day'), 600);
    }, this.reduced ? 200 : 1400);
  }

  // ---------------------------------------------------------------- panels (Gloamhollow pauseFor / closePanel)
  pauseFor(name) {
    const g = this.g;
    if (g.mode === 'play') g.mode = 'paused';
    this.panel = name; g.keys.clear(); g.held = 0; this.releaseStick();
    if (document.pointerLockElement) document.exitPointerLock();
    g.setHints();
  }
  closePanel() {
    if (!this.panel) return;
    $({ read: 'read', notes: 'notes', map: 'map', menu: 'menu' }[this.panel]).hidden = true; this.panel = null;
    const g = this.g; if (g.mode === 'paused') g.mode = 'play';
    $('restartNote').hidden = true; this.restartArm = false;
    g.setHints(); if (!this.coarse && g.mode === 'play') g.tryLock();
  }
  openRead(t) {
    if (!this.notes.includes(t.id)) { this.notes.push(t.id); $('notesBtn').classList.add('new'); }
    sfx.read();
    this.readT = t; this.readPage = 0; this.pauseFor('read');
    $('readKind').textContent = t.caption ?? ''; $('readTitle').textContent = t.title;
    $('readText').classList.toggle('plain', t.style === 'look' || t.style === 'scrawl');
    this.renderRead(); $('read').hidden = false; $('readClose').focus({ preventScroll: true });
  }
  renderRead() {
    const t = this.readT, n = t.pages.length;
    $('readText').textContent = t.pages[this.readPage];
    $('readSig').hidden = !t.sig || this.readPage !== n - 1; $('readSig').textContent = t.sig ? '— ' + t.sig : '';
    $('readPager').hidden = n < 2; $('readPage').textContent = `${this.readPage + 1} of ${n}`;
    $('readPrev').disabled = this.readPage === 0; $('readNext').disabled = this.readPage === n - 1;
  }
  openNotes() {
    this.pauseFor('notes'); $('notesBtn').classList.remove('new');
    const list = $('notesList'); list.replaceChildren();
    if (!this.notes.length) list.append(el('p', 'Nothing yet. Read whatever you find.', 'empty'));
    for (const id of this.notes) {
      const t = this.g.T.gdf.entities.find((e) => e.id === id); if (!t) continue;
      const b = el('button', t.title); b.type = 'button';
      b.addEventListener('click', () => { $('notes').hidden = true; this.panel = null; this.g.mode = 'play'; this.openRead(t); });
      list.append(b);
    }
    $('notes').hidden = false; $('notesClose').focus({ preventScroll: true });
  }
  openMap() { this.pauseFor('map'); $('map').hidden = false; this.drawBig(); $('closeMap').focus({ preventScroll: true }); }
  openMenu() {
    const g = this.g, st = g.st, z = st.checkpoints[st.cp].zone, m = $('menuStats');
    this.pauseFor('menu'); m.replaceChildren();
    m.append(el('b', cap(z >= 0 ? g.T.gdf.zones[z].name : 'the stair')), ' is where you will rise.', document.createElement('br'));
    m.append('Deaths ', el('b', String(st.deaths)), ' · Treasure ', el('b', String(this.treasure())), ` of ${this.treasureTotal} · Time `, el('b', fmtTime(st.tick)));
    $('soundBtn').textContent = `Sound: ${AUD.on ? 'on' : 'off'}`;
    $('menu').hidden = false; $('resumeBtn').focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- map and sight (Gloamhollow revealSight, cellColor, drawMini, drawBig)
  frame(dt) {
    const g = this.g; if (!g.st || g.mode === 'title') return;
    this.sightT += dt; this.miniT += dt; this.saveT += dt;
    if (this.sightT > 0.15) { this.sightT = 0; this.revealSight(); }
    if (this.miniT > 0.1) { this.miniT = 0; this.drawMini(); }
    if (this.saveT > 10 && g.mode === 'play') { this.saveT = 0; this.save(); }
    this.ghosts();
  }
  revealSight() {
    const g = this.g, st = g.st, { w, h, grid } = g.T, p = st.player, pi = Math.floor(p.x / S), pj = Math.floor(p.z / S), R = 7;
    for (let j = pj - R; j <= pj + R; j++) for (let i = pi - R; i <= pi + R; i++) {
      if (i < 0 || j < 0 || i >= w || j >= h || (i - pi) ** 2 + (j - pj) ** 2 > R * R) continue;
      const k = j * w + i; if (this.seen[k] || grid[k] === CELL.WALL) continue;
      if (g.Q.los(st, p.x, p.z, i * S + S / 2, j * S + S / 2)) this.seen[k] = 1;
    }
  }
  nearSeen(i, j) { const { w, h } = this.g.T; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < w && b < h && this.seen[b * w + a]) return true; } return false; }
  cellColor(i, j) {
    const g = this.g, st = g.st, { w, grid } = g.T, k = j * w + i, code = grid[k];
    if (code === CELL.WALL) return this.nearSeen(i, j) ? '#5d574f' : null;
    if (!this.seen[k]) return null;
    if (g.Q.doorShutAt(st, k)) return '#a8743c';
    if (g.Q.slabAt(st, k)) return '#6a6258';
    if (code === CELL.VOID) return '#07090c';
    if (code === CELL.BRIDGE) return st.bridge.includes(k) ? '#3a90b8' : '#07090c';
    if (code === CELL.HPIT && st.pits.includes(k)) return '#000000';
    if (g.Q.openAlcovePit(st, k)) return '#000000';
    if (code === CELL.PLATE && st.marked.includes(k)) return '#9a3c2c';
    if (code === CELL.VENT) return '#5a2c18';
    return code === CELL.CORR ? '#2c2926' : '#36322e';
  }
  drawMini() {
    const c = this.miniCtx, Wp = this.mini.width, span = 15, px = Wp / span, g = this.g, p = g.st.player, { w, h } = g.T;
    c.fillStyle = '#0b0a0c'; c.fillRect(0, 0, Wp, Wp);
    const pi = p.x / S, pj = p.z / S, i0 = Math.floor(pi - span / 2), j0 = Math.floor(pj - span / 2), ox = (pi - span / 2 - i0) * px, oy = (pj - span / 2 - j0) * px;
    for (let j = j0; j <= j0 + span + 1; j++) for (let i = i0; i <= i0 + span + 1; i++) {
      if (i < 0 || j < 0 || i >= w || j >= h) continue; const col = this.cellColor(i, j); if (!col) continue;
      c.fillStyle = col; c.fillRect((i - i0) * px - ox, (j - j0) * px - oy, px + 0.5, px + 0.5);
    }
    c.save(); c.translate(Wp / 2, Wp / 2); c.rotate(-g.look.yaw);
    c.fillStyle = '#f2a84e'; c.beginPath(); c.moveTo(0, -px * 0.75); c.lineTo(px * 0.5, px * 0.5); c.lineTo(-px * 0.5, px * 0.5); c.closePath(); c.fill(); c.restore();
  }
  drawBig() {
    const g = this.g, st = g.st, { w: W, h: H } = g.T, ents = g.T.gdf.entities, dpr = Math.min(2, window.devicePixelRatio || 1);
    const cell = Math.max(4, Math.floor(Math.min((innerWidth - 40) / W, (innerHeight - 170) / H)));
    this.big.width = W * cell * dpr; this.big.height = H * cell * dpr; this.big.style.width = W * cell + 'px'; this.big.style.height = H * cell + 'px';
    const c = this.bigCtx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0b0a0c'; c.fillRect(0, 0, W * cell, H * cell);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const col = this.cellColor(i, j); if (!col) continue;
      c.fillStyle = col; c.fillRect(i * cell, j * cell, cell, cell);
      const k = j * W + i;
      if (this.seen[k] && g.T.grid[k] === CELL.PLATE && st.marked.includes(k) && !g.Q.slabAt(st, k)) { c.strokeStyle = '#ffb090'; c.lineWidth = 1; c.beginPath(); c.moveTo(i * cell + 2, j * cell + 2); c.lineTo(i * cell + cell - 2, j * cell + cell - 2); c.moveTo(i * cell + cell - 2, j * cell + 2); c.lineTo(i * cell + 2, j * cell + cell - 2); c.stroke(); }
    }
    c.font = `${Math.round(cell * 1.3)}px VT323, monospace`; c.textAlign = 'center'; c.textBaseline = 'middle';
    ents.forEach((e, n) => {
      if (e.type !== 'item' || e.kind !== 'treasure' || !e.cell) return;
      const num = n + 1, [i, j] = e.cell;
      if (st.taken.includes(num) || (e.hidden && !st.revealed.includes(num)) || !this.seen[j * W + i]) return;
      c.fillStyle = '#e0c060'; c.fillText('$', (i + 0.5) * cell, (j + 0.5) * cell);
    });
    const cp = st.checkpoints[st.cp]; c.fillStyle = '#9ad7f0'; c.fillText('&', cp.x / S * cell, cp.z / S * cell);
    c.fillStyle = '#f2a84e'; c.fillText('@', st.player.x / S * cell, st.player.z / S * cell);
  }

  // ---------------------------------------------------------------- touch (Gloamhollow stick, look, holdButton)
  touchDown(e) {
    const v = $('view');
    try { v.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!this.touchedOnce) { this.touchedOnce = true; this.g.setHints(); }
    if (e.clientX < innerWidth / 2 && !this.stick.active) {
      Object.assign(this.stick, { active: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, vx: 0, vy: 0 });
      const s = $('stick'); s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; $('knob').style.transform = 'translate(0,0)'; s.hidden = false;
    } else if (!this.lookP.active) Object.assign(this.lookP, { active: true, id: e.pointerId, x: e.clientX, y: e.clientY });
  }
  touchMove(e) {
    if (this.stick.active && e.pointerId === this.stick.id) {
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const m = Math.hypot(dx, dy), max = 52;
      if (m > max) { dx *= max / m; dy *= max / m; }
      this.stick.vx = dx / max; this.stick.vy = dy / max; $('knob').style.transform = `translate(${dx}px,${dy}px)`;
    } else if (this.lookP.active && e.pointerId === this.lookP.id) {
      this.g.applyLook((e.clientX - this.lookP.x) * 0.0058, (e.clientY - this.lookP.y) * 0.0058); this.lookP.x = e.clientX; this.lookP.y = e.clientY;
    }
  }
  touchUp(e) { if (this.stick.active && e.pointerId === this.stick.id) this.releaseStick(); if (this.lookP.active && e.pointerId === this.lookP.id) this.lookP.active = false; }
  releaseStick() { this.stick.active = false; this.stick.vx = this.stick.vy = 0; $('stick').hidden = true; }
  /** R-MOVE-5, decision #16: the stick drives `move` with run held, deflection · 127 · 8/9 after a 12 % dead zone. */
  stickInput() {
    if (!this.stick.active) return null;
    let fw = -this.stick.vy, sd = this.stick.vx; const m = Math.hypot(fw, sd);
    if (m < 0.12) return { move: [0, 0], run: false };
    const k = Math.min(1, m) * 127 * 8 / 9 / m; fw *= k; sd *= k;
    return { move: [Math.round(fw), Math.round(sd)], run: true };
  }
  ghosts() { const g = this.g, play = g.mode === 'play' && g.st?.dead === null; $('ghostMove').hidden = $('ghostLook').hidden = !(play && this.coarse && !this.touchedOnce); }

  // ---------------------------------------------------------------- saving (localStorage: the sim state, so a delve resumes exactly)
  save() {
    const g = this.g; if (!g.st || g.mode === 'title' || g.st.won !== null) return;
    const o = { v: SAVE_V, core: Sim.CORE_VERSION, world: g.T.world.id, state: g.st, look: g.look, notes: this.notes, seen: Array.from(this.seen).join(''), visited: [...g.visited] };
    try { localStorage.setItem(this.saveKey, JSON.stringify(o)); } catch { /* storage full or blocked */ }
  }
  clearSave() { try { localStorage.removeItem(this.saveKey); } catch { /* ignore */ } }
  loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(this.saveKey) || 'null');
      if (!s || s.v !== SAVE_V || s.core !== Sim.CORE_VERSION || s.world !== this.g.T.world.id || !s.state || s.state.world !== s.world) return null;
      if (s.state.won !== null || (s.state.dead !== null && s.state.mode === 'ironman')) return null;
      return s;
    } catch { return null; }
  }
  restore(s) {
    this.notes = Array.isArray(s.notes) ? s.notes.filter((x) => typeof x === 'string') : [];
    this.seen = new Uint8Array(this.g.T.w * this.g.T.h);
    if (typeof s.seen === 'string') for (let k = 0; k < this.seen.length && k < s.seen.length; k++) this.seen[k] = s.seen[k] === '1' ? 1 : 0;
    if (this.notes.length) $('notesBtn').classList.add('new');
  }
  fresh() { this.notes = []; this.seen = new Uint8Array(this.g.T.w * this.g.T.h); this.beamHit = false; this.bossWas = null; }

  showTitle() {
    const s = this.loadSave(), g = this.g;
    $('intro').hidden = false;
    for (const z of ['bar', 'pframe', 'tframe']) $(z).hidden = true;
    if (s) {
      const st = s.state, z = st.checkpoints[st.cp]?.zone ?? -1, ents = g.T.gdf.entities;
      const tre = st.taken.reduce((a, n) => a + (ents[n - 1]?.value ?? 0), 0);
      $('contBox').hidden = false; $('newBox').hidden = true;
      $('contTxt').textContent = `Return to ${z >= 0 ? g.T.gdf.zones[z].name : 'the tomb'}. Deaths ${st.deaths}, treasure ${tre}.`;
      $('contBtn').focus({ preventScroll: true });
    } else { $('contBox').hidden = true; $('newBox').hidden = false; $('goBtn').focus({ preventScroll: true }); }
    this.pendingSave = s;
  }
  hideOverlays() { for (const id of ['intro', 'death', 'win', 'map', 'read', 'notes', 'menu']) $(id).hidden = true; this.panel = null; this.vig(false); $('fade').classList.remove('on', 'day'); }

  // ---------------------------------------------------------------- wiring
  bind() {
    const g = this.g, on = (id, f) => $(id).addEventListener('click', f);
    on('readClose', () => this.closePanel());
    on('readPrev', () => { this.readPage = Math.max(0, this.readPage - 1); this.renderRead(); });
    on('readNext', () => { this.readPage = Math.min(this.readT.pages.length - 1, this.readPage + 1); this.renderRead(); });
    on('notesClose', () => this.closePanel()); on('closeMap', () => this.closePanel()); on('resumeBtn', () => this.closePanel());
    on('soundBtn', () => { AUD.on = !AUD.on; try { localStorage.setItem('tombwright:sound', AUD.on ? 'on' : 'off'); } catch { /* ignore */ } $('soundBtn').textContent = `Sound: ${AUD.on ? 'on' : 'off'}`; });
    on('restartBtn', () => { if (!this.restartArm) { this.restartArm = true; $('restartNote').hidden = false; return; } $('menu').hidden = true; this.panel = null; g.newGame(); });
    on('mapBtn', () => { if (g.mode === 'play') this.openMap(); else if (this.panel === 'map') this.closePanel(); });
    on('miniBtn', () => { if (g.mode === 'play') this.openMap(); });
    on('notesBtn', () => { if (g.mode === 'play') this.openNotes(); else if (this.panel === 'notes') this.closePanel(); });
    on('menuBtn', () => { if (g.mode === 'play') this.openMenu(); else if (this.panel === 'menu') this.closePanel(); });
    on('riseBtn', () => { audioInit(); g.rise(); });
    on('deathRestart', () => { $('death').hidden = true; this.vig(false); g.newGame(); });
    on('winNew', () => { $('win').hidden = true; g.newGame(); });
    on('goBtn', () => { audioInit(); g.newGame(); });
    on('contBtn', () => { audioInit(); g.continueGame(this.pendingSave); });
    on('newBtn2', () => { if (!this.newArm) { this.newArm = true; $('newBtn2').textContent = 'Press again to wipe it'; return; } this.newArm = false; $('newBtn2').textContent = 'Start over'; audioInit(); g.newGame(); });
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') { if (this.panel) { this.closePanel(); e.preventDefault(); } else if (g.mode === 'play' && document.pointerLockElement !== $('view')) this.openMenu(); return; }
      if (g.mode === 'paused') {
        if ((e.code === 'KeyM' && this.panel === 'map') || (e.code === 'KeyN' && this.panel === 'notes') || ((e.code === 'KeyE' || e.code === 'Enter') && this.panel === 'read' && document.activeElement === $('readClose'))) { this.closePanel(); e.preventDefault(); }
        if (this.panel === 'read' && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) { this.readPage = clamp(this.readPage + (e.code === 'ArrowRight' ? 1 : -1), 0, this.readT.pages.length - 1); this.renderRead(); e.preventDefault(); }
        return;
      }
      if (g.mode === 'play' && g.st?.dead === null && !e.repeat) { if (e.code === 'KeyM') { this.openMap(); e.preventDefault(); } else if (e.code === 'KeyN') { this.openNotes(); e.preventDefault(); } else if (e.code === 'KeyL' && g.toggleWire) { g.toggleWire(); e.preventDefault(); } }
    });
    document.addEventListener('pointerdown', () => audioInit(), { once: true });
    addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.save(); });
    addEventListener('resize', () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), css = this.mini.getBoundingClientRect().width || 124, px = Math.round(css * dpr);
      if (this.mini.width !== px) this.mini.width = this.mini.height = px;
      if (this.panel === 'map') this.drawBig();
    });
    void FLASK_NAME;
  }
}
