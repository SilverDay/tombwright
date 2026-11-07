// The tomb builder (M2 slice 1; decisions #79-#85): a 2D top-down grid editor. The document model is model.js, the
// checks are the sim core's own loader (validate.js). This file is the DOM: tools, canvas, panels, storage.
// Text from the tomb (names, titles) is only ever set with textContent / .value.
import { loadSineTable } from '../sim/sine.js';
import { loadBestiary } from '../sim/bestiary.js';
import { CELL, MAX_GDF_BYTES } from '../sim/world.js';
import * as M from './model.js';
import * as E from './entities.js';
import { validate } from './validate.js';
import { renderWiring } from './wiring.js';

const $ = (id) => document.getElementById(id);
const STORE = 'tw.build.v1', PLAYTEST = 'tw.playtest.v1';
const CELL_TOOLS = [
  { code: CELL.WALL, label: 'Wall', color: '#17141a' }, { code: CELL.ROOM, label: 'Room', color: '#4a4452' },
  { code: CELL.CORR, label: 'Corridor', color: '#35303c' }, { code: CELL.PLATE, label: 'Pressure plate', color: '#8a773f' },
  { code: CELL.HPIT, label: 'Hidden pit', color: '#5a3636' }, { code: CELL.VOID, label: 'Void', color: '#000000' },
  { code: CELL.BRIDGE, label: 'Unlit bridge', color: '#4f6a80' }, { code: CELL.VENT, label: 'Fire vent', color: '#a8441c' },
  { code: CELL.ALCOVE, label: 'Alcove trap', color: '#6a3f80' },
];
const PLACE_TOOLS = [
  { id: 'select', label: 'Select / move' }, { id: 'zone', label: 'Chamber (drag)' }, { id: 'checkpoint', label: 'Checkpoint' }, { id: 'start', label: 'Start' }, { id: 'exit', label: 'Exit' },
];
const ZONE_COLORS = ['#e0a458', '#7aa6d6', '#8fcf8f', '#d68fb8', '#c9c36a', '#8fd0cf', '#cf8f6a', '#a58fd6'];

const S = {
  doc: M.newTomb(), tool: { kind: 'cell', code: CELL.ROOM }, zoom: 20, sel: null, ent: null, view: 'plan', undo: [], redo: [],
  drag: null, core: false, problems: { ok: true, error: null, warnings: [] }, saveTimer: 0,
};

// ------------------------------------------------------------------ storage (always guarded: it can be missing or full)
function store(key, value) { try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); return true; } catch { return value === undefined ? null : false; } }

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4000);
}

// ------------------------------------------------------------------ document changes
const snap = () => M.toText(S.doc);
function restore(text) { S.doc = M.fromText(text); }

/** Run an edit; if the document changed, remember how it was for Undo. */
function edit(fn) {
  const before = snap();
  fn();
  if (snap() !== before) pushUndo(before);
  refresh();
}
function pushUndo(before) { S.undo.push(before); if (S.undo.length > 100) S.undo.shift(); S.redo.length = 0; }
function undo() { if (!S.undo.length) return; S.redo.push(snap()); restore(S.undo.pop()); refresh(); }
function redo() { if (!S.redo.length) return; S.undo.push(snap()); restore(S.redo.pop()); refresh(); }

// ------------------------------------------------------------------ drawing
const cv = $('grid'), ctx = cv.getContext('2d');
const zoneColor = (n) => ZONE_COLORS[n % ZONE_COLORS.length];

const entityAt = E.entityPoint;

function draw() {
  const { doc, zoom: z } = S, W = doc.w * z, H = doc.h * z, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#050405'; ctx.fillRect(0, 0, W, H);
  const color = (c) => CELL_TOOLS.find((t) => t.code === c)?.color ?? '#f0f';
  for (let j = 0; j < doc.h; j++) for (let i = 0; i < doc.w; i++) {
    ctx.fillStyle = color(M.cellAt(doc, i, j)); ctx.fillRect(i * z, j * z, z, z);
  }
  if (z >= 12) {
    ctx.strokeStyle = 'rgba(226,222,236,.07)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i <= doc.w; i++) { ctx.moveTo(i * z + .5, 0); ctx.lineTo(i * z + .5, H); }
    for (let j = 0; j <= doc.h; j++) { ctx.moveTo(0, j * z + .5); ctx.lineTo(W, j * z + .5); }
    ctx.stroke();
  }
  // chambers
  (doc.gdf.zones ?? []).forEach((zn, n) => {
    ctx.strokeStyle = zoneColor(n); ctx.fillStyle = zoneColor(n) + '22'; ctx.lineWidth = zn.id === S.sel ? 3 : 1.5;
    for (const [x, y, w, h] of zn.rects ?? []) { ctx.fillRect(x * z, y * z, w * z, h * z); ctx.strokeRect(x * z + 1, y * z + 1, w * z - 2, h * z - 2); }
    const r = zn.rects?.[0];
    if (r && z >= 14) { ctx.fillStyle = zoneColor(n); ctx.font = '12px Spectral, serif'; ctx.textBaseline = 'top'; ctx.fillText(String(zn.name ?? '').slice(0, 24), r[0] * z + 4, r[1] * z + 3); }
    if (zn.checkpoint) mark(zn.checkpoint.cell[0], zn.checkpoint.cell[1], '◆', zoneColor(n));
  });
  // what this slice does not edit, shown so the author knows it is there
  ctx.font = `${Math.max(9, z * 0.5)}px Spectral, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const e of doc.gdf.entities ?? []) {
    const cells = Array.isArray(e.cells) ? e.cells : null;
    if (cells) {                                                   // vents and marks cover several cells
      for (const c of cells) if (Array.isArray(c)) { ctx.fillStyle = e.type === 'vent' ? 'rgba(242,168,78,.45)' : 'rgba(154,215,240,.4)'; ctx.fillRect(c[0] * z + 2, c[1] * z + 2, z - 4, z - 4); }
    }
    const p = entityAt(e); if (!p) continue;
    const side = E.sideOf(e);
    if (side) { const d = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[side]; ctx.strokeStyle = 'rgba(242,168,78,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p[0] * z + d[0] * z * .3 - d[1] * z * .25, p[1] * z + d[1] * z * .3 - d[0] * z * .25); ctx.lineTo(p[0] * z + d[0] * z * .5 - d[1] * z * .25, p[1] * z + d[1] * z * .5 - d[0] * z * .25); ctx.stroke(); }
    ctx.fillStyle = e.id === S.ent ? '#ffffff' : 'rgba(242,168,78,.85)'; ctx.beginPath(); ctx.arc(p[0] * z, p[1] * z, z * (e.id === S.ent ? 0.3 : 0.22), 0, 6.3); ctx.fill();
    if (z >= 14) { ctx.fillStyle = '#0b0a0c'; ctx.fillText(String(e.type ?? '?')[0].toUpperCase(), p[0] * z, p[1] * z + 1); }
  }
  const st = doc.gdf.start?.cell, ex = doc.gdf.exit?.cell;
  if (st) mark(st[0], st[1], 'S', '#8fcf8f', true);
  if (ex) mark(ex[0], ex[1], 'X', '#f2a84e', true);
  // drag preview
  if (S.drag && S.drag.rect) {
    const [a, b] = rectOf(S.drag);
    ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
    ctx.strokeRect(a[0] * z + 1, a[1] * z + 1, (b[0] - a[0] + 1) * z - 2, (b[1] - a[1] + 1) * z - 2); ctx.setLineDash([]);
  }
  ctx.textAlign = 'start';
  function mark(i, j, ch, col, ring = false) {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2;
    if (ring) { ctx.beginPath(); ctx.arc((i + .5) * z, (j + .5) * z, z * 0.4, 0, 6.3); ctx.stroke(); }
    ctx.font = `bold ${Math.max(10, z * 0.55)}px Spectral, serif`; ctx.fillText(ch, (i + .5) * z, (j + .5) * z + 1); ctx.restore();
  }
}

const rectOf = (d) => [[Math.min(d.i0, d.i1), Math.min(d.j0, d.j1)], [Math.max(d.i0, d.i1), Math.max(d.j0, d.j1)]];

// ------------------------------------------------------------------ panels
function buildTools() {
  const mk = (host, items, isOn, pick, swatch) => {
    host.replaceChildren();
    for (const it of items) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio');
      if (swatch) { const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = it.color; b.appendChild(sw); }
      b.appendChild(document.createTextNode(it.label)); b.dataset.k = String(it.code ?? it.id);
      b.addEventListener('click', () => { pick(it); markTools(); });
      host.appendChild(b);
    }
  };
  mk($('cellTools'), CELL_TOOLS, null, (it) => { S.tool = { kind: 'cell', code: it.code }; }, true);
  mk($('placeTools'), PLACE_TOOLS, null, (it) => { S.tool = { kind: it.id }; }, false);
  const things = $('thingTools'); things.replaceChildren();
  let group = null;
  for (const p of E.PALETTE) {
    if (p.group !== group) { group = p.group; const h = document.createElement('h3'); h.textContent = group; things.appendChild(h); }
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.k = 'thing:' + p.id; b.textContent = p.label;
    b.addEventListener('click', () => { S.tool = { kind: 'thing', entry: p }; markTools(); });
    things.appendChild(b);
  }
  markTools();
}
function markTools() {
  for (const b of $('cellTools').children) b.setAttribute('aria-checked', String(S.tool.kind === 'cell' && String(S.tool.code) === b.dataset.k));
  for (const b of $('placeTools').children) b.setAttribute('aria-checked', String(S.tool.kind === b.dataset.k));
  for (const b of $('thingTools').querySelectorAll('button')) b.setAttribute('aria-checked', String(S.tool.kind === 'thing' && 'thing:' + S.tool.entry.id === b.dataset.k));
}

function panels() {
  const v = S.problems, st = $('status');
  st.className = v.ok ? 'ok' : 'bad';
  st.textContent = v.ok ? 'The tomb loads and can be played.' : v.error;
  const ul = $('problems'); ul.replaceChildren();
  for (const w of v.warnings) { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); }
  $('playBtn').disabled = !v.ok || !S.core;
  const s = M.summary(S.doc);
  $('summary').textContent = `${s.w} × ${s.h} cells, ${s.floor} walkable, ${s.zones} chambers, ${s.entities} things placed, ${s.links} links.`;
  const t = E.threat(S.doc), tl = $('threat');
  tl.textContent = `Threat ${t.points} / ${E.THREAT_BUDGET} · foes ${t.foes} / ${E.MAX_FOES} · awake at the start ${t.awake} / ${E.MAX_AWAKE}`;
  tl.className = t.over ? 'bad' : '';
  if (document.activeElement !== $('title')) $('title').value = S.doc.gdf.meta?.title ?? '';
  $('undoBtn').disabled = !S.undo.length; $('redoBtn').disabled = !S.redo.length;
  $('zoomLabel').textContent = S.zoom + ' px';
  zonesPanel();
  inspectorPanel();
  wiringPanel();
}

function zonesPanel() {
  const ul = $('zones'), zs = S.doc.gdf.zones ?? [];
  if (ul.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;   // don't rebuild under the caret
  ul.replaceChildren();
  zs.forEach((z, n) => {
    const li = document.createElement('li'); if (z.id === S.sel) li.className = 'sel';
    li.addEventListener('click', () => { if (S.sel !== z.id) { S.sel = z.id; refresh(); } });
    const r1 = document.createElement('div'); r1.className = 'zrow';
    const chip = document.createElement('span'); chip.className = 'chip'; chip.style.background = zoneColor(n);
    const name = document.createElement('input'); name.type = 'text'; name.maxLength = 60; name.value = typeof z.name === 'string' ? z.name : ''; name.setAttribute('aria-label', 'Chamber name');
    name.addEventListener('change', () => edit(() => M.updateZone(S.doc, z.id, { name: name.value })));
    const del = document.createElement('button'); del.type = 'button'; del.textContent = '✕'; del.setAttribute('aria-label', 'Remove chamber ' + String(z.name ?? z.id));
    del.addEventListener('click', (ev) => { ev.stopPropagation(); edit(() => M.removeZone(S.doc, z.id)); });
    r1.append(chip, name, del);
    const r2 = document.createElement('div'); r2.className = 'zrow';
    const ceil = document.createElement('input'); ceil.type = 'number'; ceil.min = '3'; ceil.max = '6.5'; ceil.step = '0.1'; ceil.value = String(z.ceil / 1000); ceil.setAttribute('aria-label', 'Ceiling height in metres');
    ceil.addEventListener('change', () => { const mm = Math.round(Number(ceil.value) * 1000); if (Number.isFinite(mm)) edit(() => M.updateZone(S.doc, z.id, { ceil: mm })); });
    const cp = document.createElement('label'); const cpb = document.createElement('input'); cpb.type = 'checkbox'; cpb.checked = Boolean(z.checkpoint);
    cpb.addEventListener('change', () => edit(() => {
      if (!cpb.checked) { M.updateZone(S.doc, z.id, { checkpoint: null }); return; }
      const cell = firstFloor(z); if (cell) M.updateZone(S.doc, z.id, { checkpoint: { cell, yaw: 0 } });
    }));
    cp.append(cpb, document.createTextNode(' checkpoint'));
    r2.append(document.createTextNode('Ceiling '), ceil, document.createTextNode(' m'), cp);
    const r3 = document.createElement('div'); r3.className = 'zrow';
    const eyes = E.eyesOf(S.doc, z.id), eb = document.createElement('label'), ebox = document.createElement('input'); ebox.type = 'checkbox'; ebox.checked = Boolean(eyes);
    const wake = document.createElement('input'); wake.type = 'number'; wake.min = '18'; wake.max = '1800'; wake.value = String(eyes?.wake ?? 30); wake.disabled = !eyes; wake.setAttribute('aria-label', 'Ticks until the eyes wake');
    ebox.addEventListener('change', () => { let r; edit(() => { r = E.setEyes(S.doc, z.id, ebox.checked ? 30 : null); }); if (r !== true) toast(r); });
    wake.addEventListener('change', () => { let r; edit(() => { r = E.setEyes(S.doc, z.id, Number(wake.value)); }); if (r !== true) toast(r); });
    eb.append(ebox, document.createTextNode(' waking eyes, wake after ')); r3.append(eb, wake, document.createTextNode(' ticks'));
    li.append(r1, r2, r3); ul.appendChild(li);
  });
  $('zoneHint').textContent = zs.length ? 'Move a checkpoint with the Checkpoint tool.' : 'Use the Chamber tool and drag over the floor.';
}
function firstFloor(z) {
  for (const [x, y, w, h] of z.rects) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (M.isFloor(M.cellAt(S.doc, i, j))) return [i, j];
  return null;
}

function refresh() {
  S.problems = S.core ? validate(S.doc) : { ok: false, error: 'Loading the rules…', warnings: [] };
  if (S.sel && !(S.doc.gdf.zones ?? []).some((z) => z.id === S.sel)) S.sel = null;
  panels(); draw();
  clearTimeout(S.saveTimer); S.saveTimer = setTimeout(() => store(STORE, snap()), 400);
}

// ------------------------------------------------------------------ the wiring view
function wiringPanel() {
  document.querySelector('.work').dataset.view = S.view;
  $('wiring').hidden = S.view !== 'wiring';
  $('viewPlan').setAttribute('aria-selected', String(S.view === 'plan')); $('viewWiring').setAttribute('aria-selected', String(S.view === 'wiring'));
  if (S.view !== 'wiring') return;
  const host = $('wiring');
  if (host.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;   // don't redraw under the caret
  const top = host.scrollTop;
  try { renderWiring(host, S.doc, { edit, toast }); }
  catch (e) { console.error(e); S.view = 'plan'; toast('The links of this tomb could not be drawn; showing the plan instead.'); document.querySelector('.work').dataset.view = 'plan'; host.hidden = true; host.replaceChildren(); }
  host.scrollTop = top;
}
$('viewPlan').addEventListener('click', () => { S.view = 'plan'; refresh(); });
$('viewWiring').addEventListener('click', () => { S.view = 'wiring'; refresh(); });

// ------------------------------------------------------------------ the inspector (select a thing to edit it)
const selected = () => (S.ent ? E.byId(S.doc, S.ent) : undefined);
function applyField(e, k, v) { let r; edit(() => { r = E.setField(S.doc, e, k, v); }); if (r !== true) toast(r); }
const labelOf = (id) => PALETTE_LABEL.get(id);
const PALETTE_LABEL = new Map([['door', 'Door'], ['slab', 'Falling slab'], ['vent', 'Fire vent'], ['alcove', 'Alcove trap'], ['item', 'Item'], ['chest', 'Chest'], ['inscription', 'Inscription'], ['torch', 'Torch'], ['marks', "Masons' marks"], ['prop', 'Prop'], ['decor', 'Decor']]);

function inspectorPanel() {
  const host = $('inspector'), e = selected();
  if (host.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && e) return;   // don't rebuild under the caret
  host.replaceChildren();
  if (S.ent && !e) S.ent = null;
  if (!e) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = 'Nothing selected. Use Select / move, then click a placed thing; or pick something in the palette and click the plan.'; host.appendChild(p); return; }
  const head = document.createElement('p'); head.textContent = `${labelOf(e.type) ?? e.type} “${e.id}”`;
  const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Remove'; del.setAttribute('aria-label', `Remove ${e.id}`);
  del.addEventListener('click', () => { edit(() => E.removeEntity(S.doc, e.id)); S.ent = null; refresh(); });
  host.append(head, del);
  for (const f of E.FIELDS[e.type] ?? []) {
    if (f.show && !f.show(e)) continue;
    const row = document.createElement('label'); row.className = 'frow'; row.append(document.createTextNode(f.label + ' '));
    const cur = E.getField(e, f.k);
    let ctl;
    if (f.t === 'select' || f.t === 'ref') {
      ctl = document.createElement('select');
      const list = typeof f.o === 'function' ? f.o() : f.o;
      const opts = f.t === 'select' ? list.map((o) => [String(o), f.text ? f.text(o) : f.labels?.[o] ?? String(o)]) : f.refs(S.doc).map((x) => [x.id, x.name ? `${x.id} (${x.name})` : x.id]);
      if (f.t === 'ref' && f.none) opts.unshift(['', f.none]);
      for (const [val, text] of opts) { const o = document.createElement('option'); o.value = val; o.textContent = text; ctl.appendChild(o); }
      ctl.value = cur === undefined || cur === null ? '' : String(cur);
      ctl.addEventListener('change', () => applyField(e, f.k, f.num ? Number(ctl.value) : ctl.value));
    } else if (f.t === 'int') {
      ctl = document.createElement('input'); ctl.type = 'number'; ctl.min = String(f.min); ctl.max = String(f.max); ctl.value = String(cur ?? '');
      ctl.addEventListener('change', () => applyField(e, f.k, ctl.value === '' ? NaN : Number(ctl.value)));
    } else if (f.t === 'text') {
      ctl = document.createElement('input'); ctl.type = 'text'; ctl.maxLength = f.max; ctl.value = cur ?? '';
      ctl.addEventListener('change', () => applyField(e, f.k, ctl.value));
    } else if (f.t === 'bool') {
      ctl = document.createElement('input'); ctl.type = 'checkbox'; ctl.checked = Boolean(cur);
      ctl.addEventListener('change', () => applyField(e, f.k, ctl.checked));
    } else if (f.t === 'order') {
      const box = document.createElement('div'), order = Array.isArray(cur) ? cur : []; box.className = 'pages';
      order.forEach((idx, pos) => {
        const sel = document.createElement('select'); sel.setAttribute('aria-label', 'Bell number ' + (pos + 1) + ' to ring');
        (Array.isArray(e.bells) ? e.bells : []).forEach((id, n) => { const o = document.createElement('option'); o.value = String(n); o.textContent = id; sel.appendChild(o); });
        sel.value = String(idx);
        sel.addEventListener('change', () => {                      // swap with whoever rang this bell, so it stays a permutation
          const next = order.slice(), other = next.indexOf(Number(sel.value));
          if (other >= 0) next[other] = next[pos];
          next[pos] = Number(sel.value); applyField(e, 'order', next);
        });
        const lab = document.createElement('div'); lab.append(document.createTextNode(`${pos + 1}. `), sel); box.appendChild(lab);
      });
      const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Add bells with the Bell tool while this set is selected (2 to 5).'; box.appendChild(hint);
      ctl = box;
    } else if (f.t === 'pages') {
      const box = document.createElement('div'); box.className = 'pages';
      const pages = Array.isArray(cur) ? cur : [];
      pages.forEach((txt, n) => {
        const ta = document.createElement('textarea'); ta.rows = 4; ta.value = txt; ta.setAttribute('aria-label', 'Page ' + (n + 1));
        ta.addEventListener('change', () => applyField(e, 'pages', pages.map((x, m) => (m === n ? ta.value : x))));
        const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = 'Remove page ' + (n + 1);
        rm.addEventListener('click', () => applyField(e, 'pages', pages.filter((_, m) => m !== n)));
        box.append(ta, rm);
      });
      const add = document.createElement('button'); add.type = 'button'; add.textContent = 'Add a page';
      add.addEventListener('click', () => applyField(e, 'pages', [...pages, '…']));
      box.appendChild(add); ctl = box;
    }
    row.appendChild(ctl); host.appendChild(row);
  }
  if (Array.isArray(e.cells)) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = `${e.cells.length} cell${e.cells.length === 1 ? '' : 's'}.`; host.appendChild(p); }
}

/** Make a freshly read document the current one; if it is malformed in a way that breaks drawing or the panels, keep the old one. */
function adopt(doc) {
  const old = S.doc;
  S.doc = doc;
  try { refresh(); return true; } catch (e) { console.error(e); S.doc = old; refresh(); return false; }
}

// ------------------------------------------------------------------ pointer
const cellOf = (ev) => {
  const r = cv.getBoundingClientRect(), i = Math.floor((ev.clientX - r.left) / S.zoom), j = Math.floor((ev.clientY - r.top) / S.zoom);
  return [Math.max(0, Math.min(S.doc.w - 1, i)), Math.max(0, Math.min(S.doc.h - 1, j))];
};
const dragsRect = () => S.tool.kind === 'zone' || (S.tool.kind === 'cell' && $('rectMode').checked);

cv.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  const [i, j] = cellOf(ev);
  cv.setPointerCapture(ev.pointerId);
  S.drag = { i0: i, j0: j, i1: i, j1: j, before: snap(), rect: dragsRect() };
  if (S.tool.kind === 'select') {                          // pick the next thing in this cell after the one already selected
    const here = E.entitiesAt(S.doc, i, j), at = here.findIndex((x) => x.id === S.ent);
    S.ent = (here[(at + 1) % here.length] ?? null)?.id ?? null;
    S.drag.moving = S.ent;
    refresh();
  }
  if (S.tool.kind === 'cell' && !S.drag.rect) { M.paint(S.doc, i, j, S.tool.code); draw(); }
});
cv.addEventListener('pointermove', (ev) => {
  if (!S.drag) return;
  const [i, j] = cellOf(ev);
  if (i === S.drag.i1 && j === S.drag.j1) return;
  S.drag.i1 = i; S.drag.j1 = j;
  if (S.tool.kind === 'cell' && !S.drag.rect) M.paint(S.doc, i, j, S.tool.code);   // brush
  draw();
});
cv.addEventListener('pointerup', (ev) => {
  const d = S.drag; S.drag = null; if (!d) return;
  const [i, j] = cellOf(ev); d.i1 = i; d.j1 = j;
  const k = S.tool.kind;
  if (k === 'cell' && d.rect) M.paintRect(S.doc, d.i0, d.j0, d.i1, d.j1, S.tool.code);
  else if (k === 'zone') { const z = M.addZone(S.doc, d.i0, d.j0, d.i1, d.j1); if (z) S.sel = z.id; else toast('A chamber needs free space inside the walls, not touching another chamber (at most 16).'); }
  else if (k === 'select') {
    if (d.moving && (i !== d.i0 || j !== d.j0)) { const e = E.byId(S.doc, d.moving), r = e ? E.move(S.doc, e, i, j) : 'Gone.'; if (r !== true) toast(r); }
  }
  else if (k === 'thing') {
    const entry = { ...S.tool.entry, selected: S.ent, kind: S.tool.entry.type === 'foe' ? $('foeKind').value : S.tool.entry.kind };
    const r = E.place(S.doc, entry, i, j);
    if (typeof r === 'string') toast(r); else { S.ent = r.id; }
  }
  else if (k === 'start') { if (!M.setStart(S.doc, i, j)) toast('The start goes on a room or corridor cell.'); }
  else if (k === 'exit') { if (!M.setExit(S.doc, i, j)) toast('The exit goes on a room or corridor cell.'); }
  else if (k === 'checkpoint') {
    const n = M.zoneIndexAt(S.doc, i, j), z = n >= 0 ? S.doc.gdf.zones[n] : null;
    if (!z) toast('A checkpoint goes inside a chamber.');
    else if (!M.isFloor(M.cellAt(S.doc, i, j)) || !M.updateZone(S.doc, z.id, { checkpoint: { cell: [i, j], yaw: z.checkpoint?.yaw ?? 0 } })) toast('A checkpoint goes on a room or corridor cell (at most 12).');
  }
  const after = snap();
  if (after !== d.before) pushUndo(d.before);
  refresh();
});
cv.addEventListener('pointercancel', () => { if (S.drag) { restore(S.drag.before); S.drag = null; refresh(); } });

// ------------------------------------------------------------------ buttons
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const slug = () => (S.doc.gdf.meta?.title ?? 'tomb').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tomb';

$('title').addEventListener('change', () => edit(() => M.setTitle(S.doc, $('title').value)));
$('saveBtn').addEventListener('click', () => {
  if (!S.problems.ok) toast('Saved anyway, but the tomb has a problem: ' + S.problems.error);
  download(slug() + '.gdf.json', snap());
});
$('openBtn').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const f = $('file').files[0]; $('file').value = '';
  if (!f) return;
  if (f.size > MAX_GDF_BYTES) { toast('That file is larger than 256 KiB, the most a tomb may be.'); return; }
  try {
    const doc = M.fromBytes(new Uint8Array(await f.arrayBuffer())), before = snap();
    if (!adopt(doc)) throw new Error('its chambers or things are malformed');
    pushUndo(before); S.sel = null; S.ent = null; refresh(); toast('Opened ' + (doc.gdf.meta?.title ?? f.name));
  } catch (e) { toast('That file is not a tomb this builder can read: ' + (e instanceof Error ? e.message : 'error')); }
});
$('newBtn').addEventListener('click', () => $('newDlg').showModal());
$('newDlg').addEventListener('close', () => {
  if ($('newDlg').returnValue !== 'ok') return;
  try { const doc = M.newTomb(Number($('newW').value), Number($('newH').value)); const before = snap(); S.doc = doc; pushUndo(before); S.sel = null; S.ent = null; refresh(); }
  catch { toast('The size must be between 6 and 64 cells each way.'); }
});
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('playBtn').addEventListener('click', () => {
  if (!S.problems.ok) { toast(S.problems.error); return; }
  if (!store(PLAYTEST, snap())) { toast('This browser will not let the builder hand the tomb to the game (storage is blocked or full).'); return; }
  location.assign('/play/test');
});
$('zoomIn').addEventListener('click', () => { S.zoom = Math.min(48, S.zoom + 4); refresh(); });
$('zoomOut').addEventListener('click', () => { S.zoom = Math.max(6, S.zoom - 4); refresh(); });
addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
  else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); }
});

addEventListener('pagehide', () => { clearTimeout(S.saveTimer); store(STORE, snap()); });   // don't lose the last 400 ms

function fillFoeKinds() {
  const sel = $('foeKind'); sel.replaceChildren();
  for (const k of E.foeKinds()) { const o = document.createElement('option'); o.value = k; o.textContent = `${E.foeLabel(k)} (cost ${E.foeCost(k)})`; sel.appendChild(o); }
  sel.value = 'crawler';
}

// ------------------------------------------------------------------ boot
async function boot() {
  buildTools();
  const saved = store(STORE);
  let ok = true;
  if (saved) { try { ok = adopt(M.fromText(saved)); } catch { ok = false; } }
  if (!ok) toast('The saved tomb could not be read; starting a new one.');
  refresh();
  try {
    const get = async (u) => { const r = await fetch(u, { credentials: 'same-origin' }); if (!r.ok) throw new Error(u); return new Uint8Array(await r.arrayBuffer()); };
    const [sine, best] = await Promise.all([get('/js/sim/data/sine4096.bin'), get('/js/sim/data/bestiary.v1.json')]);
    loadSineTable(sine); loadBestiary(best); S.core = true;
    E.setBestiary(JSON.parse(new TextDecoder().decode(best))); fillFoeKinds();
  } catch (e) { toast('The rules could not be loaded, so the tomb cannot be checked. Reload the page.'); console.error(e); }
  refresh();
  if (window.__twTest === true) window.__twBuild = {
    M, E, get doc() { return S.doc; }, get problems() { return S.problems; }, get text() { return snap(); },
    use(text) { return adopt(M.fromText(text)); },
    setView(v) { S.view = v; refresh(); },
  };
}
boot();
