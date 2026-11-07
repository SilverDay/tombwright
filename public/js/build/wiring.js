// The builder's wiring view V1 (decision #91): each link is a card; its `when` is a nested tree built from dropdowns,
// then Do / Undo effect lists and options. All changes go through links.js (pure, tested) inside the host's `edit()`,
// so they undo with everything else. Text from the tomb (ids, zone names, messages) is only ever set with
// textContent / .value.
import * as L from './links.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const opt = (value, text) => { const o = document.createElement('option'); o.value = String(value); o.textContent = text; return o; };

/**
 * Draw all links into `host`. `api.edit(fn)` runs a document change (with undo and a redraw); `api.toast(msg)` shows a message.
 */
export function renderWiring(host, doc, api) {
  host.replaceChildren();
  const links = doc.gdf.links ?? [];
  const top = el('div', 'wtop');
  top.append(el('h2', null, `Links (${links.length} / ${L.MAX_LINKS})`));
  const add = el('button', 'primary', 'Add a link'); add.type = 'button';
  add.addEventListener('click', () => act(api, () => L.addLink(doc)));
  top.appendChild(add);
  host.appendChild(top);
  if (links.length === 0) host.appendChild(el('p', 'hint', 'A link says: when this happens, do that. For example: when the bells are solved, open the grate. Add one to start.'));
  for (const link of links) host.appendChild(L.wellFormed(link) ? card(doc, link, api) : brokenCard(doc, link, api));
}

/** Run a change; if it answers with a reason, show it. The focus leaves any text field so the redraw is not held back. */
function act(api, fn) {
  let r;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  api.edit(() => { r = fn(); });
  if (typeof r === 'string') api.toast(r);
}

/** A link the builder cannot draw (a hand-edited file): say so and let the author remove it. */
function brokenCard(doc, link, api) {
  const art = el('article', 'link broken'); const id = link && typeof link === 'object' ? link.id : '?';
  art.append(el('h3', null, `Link ${id}`), el('p', 'lsum', 'This link is malformed and cannot be shown. Remove it and make it again.'));
  const rm = el('button', null, 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', `Remove malformed link ${id}`);
  rm.addEventListener('click', () => act(api, () => { const list = doc.gdf.links; list.splice(list.indexOf(link), 1); return true; }));
  art.appendChild(rm);
  return art;
}

function card(doc, link, api) {
  const art = el('article', 'link'); art.dataset.link = String(link.id);
  const head = el('div', 'lhead');
  head.append(el('h3', null, `Link ${link.id}`));
  const sum = el('p', 'lsum', L.describeLink(link)); head.appendChild(sum);
  const rm = el('button', null, 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', `Remove link ${link.id}`);
  rm.addEventListener('click', () => act(api, () => { L.removeLink(doc, link.id); return true; }));
  head.appendChild(rm);
  art.appendChild(head);

  const opts = el('div', 'lopts');
  const rep = el('label'); const repBox = el('input'); repBox.type = 'checkbox'; repBox.checked = link.repeat === true;
  repBox.addEventListener('change', () => act(api, () => L.setRepeat(link, repBox.checked)));
  rep.append(repBox, document.createTextNode(' fires every time it becomes true'));
  const del = el('label', null, 'after '); const delIn = el('input'); delIn.type = 'number'; delIn.min = '0'; delIn.max = '600'; delIn.value = String(link.delay ?? 0); delIn.setAttribute('aria-label', `Delay of link ${link.id} in ticks`);
  delIn.addEventListener('change', () => act(api, () => L.setDelay(link, delIn.value === '' ? 0 : Number(delIn.value))));
  del.append(delIn, document.createTextNode(' ticks'));
  opts.append(rep, del);
  art.appendChild(opts);

  const when = el('section', 'lwhen'); when.append(el('h4', null, 'When'));
  when.appendChild(termView(doc, link, [], api));
  art.appendChild(when);

  art.appendChild(effectsView(doc, link, 'do', [], 'Do', api));
  if (!L.isEventValued(link.when)) {
    if (link.undo) art.appendChild(effectsView(doc, link, 'undo', [], 'Undo (when it stops being true)', api));
    else { const b = el('button', null, 'Add an undo'); b.type = 'button'; b.addEventListener('click', () => act(api, () => L.setUndo(doc, link, true))); art.appendChild(b); }
  }
  return art;
}

// ------------------------------------------------------------------ the `when` tree
function kindSelect(doc, link, path, term, api) {
  const parent = path.length ? L.termAt(link, path.slice(0, -1)) : null;
  const want = L.slotWants(parent), cur = L.gateKey(term) ?? L.triggerKey(term);
  const sel = el('select'); sel.setAttribute('aria-label', 'What this term waits for');
  const group = (label, items) => { if (!items.length) return; const g = document.createElement('optgroup'); g.label = label; for (const [v, t] of items) g.appendChild(opt(v, t)); sel.appendChild(g); };
  const trig = (k) => Object.keys(L.TRIGGERS).filter((key) => L.TRIGGERS[key].kind === k).map((key) => [key, `${k === 'event' ? '◆' : '■'} ${L.TRIGGERS[key].label}`]);
  if (want !== 'cond') group('Events (one tick)', trig('event'));
  if (want !== 'event') group('Conditions (true or false)', trig('cond'));
  if (want !== 'event') group('Gates', L.GATES.filter((g) => !(want === 'cond' && g === 'sequence')).map((g) => [g, L.GATE_LABEL[g]]));
  else group('Gates', [['sequence', L.GATE_LABEL.sequence]]);
  sel.value = cur;
  sel.addEventListener('change', () => act(api, () => (L.GATES.includes(sel.value) ? L.setGate(doc, link, path, sel.value) : L.setTrigger(doc, link, path, sel.value))));
  return sel;
}

function termView(doc, link, path, api) {
  const term = L.termAt(link, path);
  const box = el('div', 'term'); box.dataset.path = path.join('.');
  const row = el('div', 'trow');
  const g = L.gateKey(term);
  box.classList.add(g ? 'gate' : L.isEventValued(term) ? 'event' : 'cond');
  row.appendChild(kindSelect(doc, link, path, term, api));

  if (!g) {
    const key = L.triggerKey(term), info = L.triggerInfo(key);
    if (info && !info.fixed) {
      if (info.bool) {
        const s = el('select'); s.setAttribute('aria-label', 'Value'); s.append(opt('true', 'yes'), opt('false', 'no')); s.value = String(term[key]);
        s.addEventListener('change', () => act(api, () => L.setArg(doc, link, path, s.value === 'true')));
        row.appendChild(s);
      } else {
        const s = el('select'); s.setAttribute('aria-label', 'Which one');
        const options = info.opts(doc, link.id);
        if (!options.some((o) => String(o.value) === String(term[key]))) s.appendChild(opt(term[key], `${term[key]} (missing)`));
        for (const o of options) s.appendChild(opt(o.value, o.text));
        s.value = String(term[key]);
        s.addEventListener('change', () => act(api, () => L.setArg(doc, link, path, s.value)));
        row.appendChild(s);
      }
    }
  } else {
    gateOptions(row, term, g, link, path, api);
  }
  const parent = path.length ? L.termAt(link, path.slice(0, -1)) : null;
  if (parent && L.gateKey(parent) !== 'not') {
    const x = el('button', 'small', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Remove this term');
    x.addEventListener('click', () => act(api, () => L.removeChild(link, path)));
    row.appendChild(x);
  }
  box.appendChild(row);

  if (g) {
    const kids = el('div', 'kids');
    L.children(term)[1].forEach((_, i) => kids.appendChild(termView(doc, link, [...path, i], api)));
    box.appendChild(kids);
    if (g !== 'not') {
      const add = el('button', 'small', g === 'sequence' ? 'Add a step' : 'Add a term'); add.type = 'button';
      add.addEventListener('click', () => act(api, () => L.addChild(doc, link, path)));
      box.appendChild(add);
    }
    if (g === 'sequence' && term.strict === true) box.appendChild(effectsView(doc, link, 'onWrong', path, 'On a wrong step, do', api));
  }
  return box;
}

function gateOptions(row, term, g, link, path, api) {
  const num = (label, key, value, min, max, blankOk) => {
    const lab = el('label', 'opt', label + ' '); const i = el('input'); i.type = 'number'; i.min = String(min); i.max = String(max); i.value = value === undefined ? '' : String(value); i.setAttribute('aria-label', label);
    i.addEventListener('change', () => act(api, () => L.setGateOption(link, path, key, i.value === '' && blankOk ? '' : Number(i.value))));
    lab.appendChild(i); row.appendChild(lab);
  };
  if (g === 'atLeast') num('k', 'k', term.k, 1, 8, false);
  if (g === 'all' || g === 'any' || g === 'atLeast') num('within (ticks)', 'within', term.within, 1, 1800, true);
  if (g === 'sequence') {
    num('time limit (ticks)', 'within', term.within, 1, 1800, true);
    const lab = el('label', 'opt'); const b = el('input'); b.type = 'checkbox'; b.checked = term.strict === true;
    b.addEventListener('change', () => act(api, () => L.setGateOption(link, path, 'strict', b.checked)));
    lab.append(b, document.createTextNode(' strict (a wrong step resets)')); row.appendChild(lab);
  }
}

// ------------------------------------------------------------------ effect lists
function effectsView(doc, link, which, path, title, api) {
  const sec = el('section', 'leffects'); sec.append(el('h4', null, title));
  const list = L.listOf(link, which, path) ?? [];
  list.forEach((fx, i) => {
    const key = L.effectKey(fx), info = L.effectInfo(key) ?? { label: String(key) };
    const row = el('div', 'frow2');
    const sel = el('select'); sel.setAttribute('aria-label', 'Effect');
    for (const k of Object.keys(L.EFFECTS)) sel.appendChild(opt(k, L.EFFECTS[k].label));
    sel.value = key; sel.addEventListener('change', () => act(api, () => L.setEffect(doc, link, which, path, i, sel.value)));
    row.appendChild(sel);
    if (info.int) {
      const n = el('input'); n.type = 'number'; n.min = String(info.int.min); n.max = String(info.int.max); n.value = String(fx[key]); n.setAttribute('aria-label', 'How much');
      n.addEventListener('change', () => act(api, () => L.setEffectArg(link, which, path, i, Number(n.value)))); row.appendChild(n);
    } else if (info.text) {
      const t = el('input'); t.type = 'text'; t.maxLength = info.text.max; t.value = String(fx[key]); t.className = 'msg'; t.setAttribute('aria-label', 'Message');
      t.addEventListener('change', () => act(api, () => L.setEffectArg(link, which, path, i, t.value))); row.appendChild(t);
    } else if (info.opts) {
      const s = el('select'); s.setAttribute('aria-label', 'Which one');
      const options = info.opts(doc);
      if (!options.some((o) => o.value === fx[key])) s.appendChild(opt(fx[key], `${fx[key]} (missing)`));
      for (const o of options) s.appendChild(opt(o.value, o.text));
      s.value = String(fx[key]); s.addEventListener('change', () => act(api, () => L.setEffectArg(link, which, path, i, s.value))); row.appendChild(s);
    }
    const x = el('button', 'small', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Remove this effect');
    x.addEventListener('click', () => act(api, () => L.removeEffect(link, which, path, i)));
    row.appendChild(x);
    sec.appendChild(row);
  });
  const add = el('button', 'small', 'Add an effect'); add.type = 'button';
  add.addEventListener('click', () => act(api, () => L.addEffect(doc, link, which, path)));
  sec.appendChild(add);
  return sec;
}
