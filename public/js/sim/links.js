// The link engine: triggers, gates and effects (spec §4.3; rules R-LINK-*). Pure; no floats.
// Mirror: src/Sim/Links.php. Any change here needs the same change there + golden vectors.

export const MAX_LINKS = 64;
export const MAX_PASSES = 8;
const MAX_EFFECTS = 16, MAX_TERMS = 8, MAX_DEPTH = 4, MAX_TRIGGERS = 16, MAX_MESSAGE_BYTES = 1000;
const EVENTS = ['interact', 'itemTaken', 'enterZone', 'leaveZone', 'bellsWrong', 'linkFired', 'foesDefeated'];
const CONDS = ['doorOpen', 'inZone', 'hasItem', 'lanternHooded', 'lanternHung', 'bellsSolved', 'beamHits', 'linkActive', 'foesAlive'];
const GATES = ['all', 'any', 'atLeast', 'sequence', 'not'];
const GATE_OPTS = { all: ['within'], any: ['within'], atLeast: ['k', 'within'], sequence: ['within', 'strict', 'onWrong'], not: [] };
const EFFECTS = ['spawnFoes', 'openDoor', 'closeDoor', 'sealDoor', 'reveal', 'hide', 'damage', 'message'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v) => Number.isSafeInteger(v);
const bad = (what) => { throw new RangeError('links: ' + what); };

/**
 * R-LINK-1..3: validate and compile `links`. ctx: { ents: Map(id -> { type, n, door?, item?, kind?, set? }),
 * zones: Map(id -> index) }. Returns the links in ascending id order, frozen.
 */
export function compileLinks(list, ctx) {
  if (list === undefined) list = [];
  if (!Array.isArray(list) || list.length > MAX_LINKS) bad('list');
  const ids = new Set();
  for (const l of list) {
    if (!isObj(l) || !isInt(l.id) || l.id < 1 || l.id > 65535) bad('id');
    if (ids.has(l.id)) bad('duplicate id');
    ids.add(l.id);
  }
  const out = list.map((l) => {
    for (const k of Object.keys(l)) if (!['id', 'when', 'do', 'undo', 'repeat', 'delay'].includes(k)) bad('key ' + k);
    if (!Object.hasOwn(l, 'when') || !Object.hasOwn(l, 'do')) bad('when/do');
    if (Object.hasOwn(l, 'repeat') && typeof l.repeat !== 'boolean') bad('repeat');
    if (Object.hasOwn(l, 'delay') && (!isInt(l.delay) || l.delay < 0 || l.delay > 600)) bad('delay');
    const c = { ctx, links: ids, self: l.id, slots: 0, triggers: 0 };
    const when = term(l.when, c, 1), ev = eventValued(when);
    if (ev && Object.hasOwn(l, 'undo')) bad('undo on an event-valued when');
    return Object.freeze({
      id: l.id, when, ev, slots: c.slots, init: initMemory(when, []),
      do: effects(l.do, ctx), undo: Object.hasOwn(l, 'undo') ? effects(l.undo, ctx) : null,
      repeat: l.repeat === true, delay: Object.hasOwn(l, 'delay') ? l.delay : 0,
    });
  });
  out.sort((a, b) => a.id - b.id);
  return Object.freeze(out);
}

function effects(list, ctx) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_EFFECTS) bad('effects');
  return Object.freeze(list.map((e) => {
    if (!isObj(e) || Object.keys(e).length !== 1) bad('effect');
    const kind = Object.keys(e)[0], v = e[kind];
    if (!EFFECTS.includes(kind)) bad('effect kind');
    if (kind === 'damage') { if (!isInt(v) || v < 1 || v > 1000) bad('damage'); return Object.freeze({ kind, n: v }); }
    if (kind === 'message') {
      if (typeof v !== 'string' || new TextEncoder().encode(v).length > MAX_MESSAGE_BYTES) bad('message');
      return Object.freeze({ kind, text: v });
    }
    if (kind === 'spawnFoes') return Object.freeze({ kind, group: group(v, ctx) });
    if (kind === 'reveal' || kind === 'hide') return Object.freeze({ kind, item: entity(v, ctx, (r) => r.type === 'item' && r.hidden).n });
    return Object.freeze({ kind, door: entity(v, ctx, (r) => r.type === 'door').door });
  }));
}

function entity(id, ctx, ok) {
  const r = typeof id === 'string' ? ctx.ents.get(id) : undefined;
  if (r === undefined || !ok(r)) bad('entity reference');
  return r;
}

function group(id, ctx) {
  const g = typeof id === 'string' ? ctx.groups.get(id) : undefined;
  if (g === undefined) bad('group reference');
  return g;
}

function zone(id, ctx) {
  const z = typeof id === 'string' ? ctx.zones.get(id) : undefined;
  if (z === undefined) bad('zone reference');
  return z;
}

function linkRef(v, c) {
  if (!isInt(v) || !c.links.has(v) || v === c.self) bad('link reference');
  return v;
}

const takeable = (r) => r.type === 'item' && r.kind !== 'rubble';

/** A trigger's argument (R-LINK-2): entity number, zone index, bell set index, link id or boolean. */
function triggerArg(kind, v, c) {
  switch (kind) {
    case 'interact': return entity(v, c.ctx, (r) => ['door', 'item', 'bell', 'lampHook', 'mirror', 'chest'].includes(r.type)).n;
    case 'itemTaken': case 'hasItem': return entity(v, c.ctx, takeable).n;
    case 'enterZone': case 'leaveZone': case 'inZone': return zone(v, c.ctx);
    case 'bellsWrong': case 'bellsSolved': return entity(v, c.ctx, (r) => r.type === 'bellSet').set;
    case 'linkFired': case 'linkActive': return linkRef(v, c);
    case 'doorOpen': return entity(v, c.ctx, (r) => r.type === 'door').door;
    case 'foesDefeated': case 'foesAlive': return group(v, c.ctx);
    case 'beamHits': return entity(v, c.ctx, (r) => r.type === 'crystal').crystal;
    case 'lanternHooded': case 'lanternHung': if (typeof v !== 'boolean') bad(kind); return v;
  }
  return bad('trigger');
}

function trigger(t, c) {
  const keys = Object.keys(t);
  if (keys.length !== 1) bad('trigger keys');
  const kind = keys[0];
  if (!EVENTS.includes(kind) && !CONDS.includes(kind)) bad('trigger kind');
  if (++c.triggers > MAX_TRIGGERS) bad('too many triggers');
  const arg = triggerArg(kind, t[kind], c);
  return EVENTS.includes(kind) ? { t: 'ev', kind, arg, slot: c.slots++ } : { t: 'cond', kind, arg };
}

const eventValued = (n) => n.t === 'ev' || n.t === 'seq';

function term(t, c, depth) {
  if (!isObj(t)) bad('term');
  const keys = Object.keys(t), gates = keys.filter((k) => GATES.includes(k));
  if (gates.length === 0) return Object.freeze(trigger(t, c));
  if (gates.length !== 1) bad('gate keys');
  const g = gates[0];
  for (const k of keys) if (k !== g && !GATE_OPTS[g].includes(k)) bad('gate option ' + k);
  if (depth > MAX_DEPTH) bad('gates nested too deep');
  if (g === 'not') {
    const inner = term(t.not, c, depth + 1);
    if (eventValued(inner)) bad('not needs a condition');
    return Object.freeze({ t: 'gate', g, terms: Object.freeze([inner]), k: 0, within: 0 });
  }
  const list = t[g];
  if (!Array.isArray(list) || list.length < 2 || list.length > MAX_TERMS) bad('gate terms');
  let within = 90;
  if (Object.hasOwn(t, 'within')) { if (!isInt(t.within) || t.within < 1 || t.within > 1800) bad('within'); within = t.within; }
  if (g === 'sequence') {
    const slot = c.slots; c.slots += 3;
    const steps = list.map((s) => {
      if (!isObj(s) || Object.keys(s).length !== 1 || !EVENTS.includes(Object.keys(s)[0])) bad('sequence step');
      if (++c.triggers > MAX_TRIGGERS) bad('too many triggers');
      const kind = Object.keys(s)[0];
      return Object.freeze({ kind, arg: triggerArg(kind, s[kind], c) });
    });
    if (Object.hasOwn(t, 'strict') && typeof t.strict !== 'boolean') bad('strict');
    const strict = t.strict === true;
    if (Object.hasOwn(t, 'onWrong') && !strict) bad('onWrong needs strict');
    return Object.freeze({
      t: 'seq', steps: Object.freeze(steps), within: Object.hasOwn(t, 'within') ? within : 0, strict,
      onWrong: Object.hasOwn(t, 'onWrong') ? effects(t.onWrong, c.ctx) : null, slot,
    });
  }
  const terms = list.map((x) => term(x, c, depth + 1));
  let k = 0;
  if (g === 'atLeast') {
    if (!isInt(t.k) || t.k < 1 || t.k > terms.length) bad('k');
    k = t.k;
  }
  return Object.freeze({ t: 'gate', g, terms: Object.freeze(terms), k, within });
}

/** R-LINK-4: initial memory: -1 per event trigger, [0, -1, -1] per sequence, depth-first. */
function initMemory(n, m) {
  if (n.t === 'ev') m[n.slot] = -1;
  else if (n.t === 'seq') { m[n.slot] = 0; m[n.slot + 1] = -1; m[n.slot + 2] = -1; }
  else if (n.t === 'gate') for (const x of n.terms) initMemory(x, m);
  return m;
}

export function initLinkState(links) {
  return links.map((l) => ({ val: false, active: false, spent: false, pend: [], m: l.init.slice() }));
}

export function copyLinkState(s) {
  return s.map((l) => ({ val: l.val, active: l.active, spent: l.spent, pend: l.pend.map((p) => ({ left: p.left, undo: p.undo })), m: l.m.slice() }));
}

/** R-LINK-5: deliver one batch of [kind, arg] events to one link's memory. Returns onWrong lists to apply. */
function deliver(n, m, batch, tick, wrong) {
  if (n.t === 'ev') {
    if (batch.some(([k, a]) => k === n.kind && a === n.arg)) m[n.slot] = tick;
  } else if (n.t === 'seq') {
    const s = n.slot, used = batch.map(() => false);
    if (m[s] > 0 && n.within > 0 && tick - m[s + 1] > n.within) m[s] = 0;
    let done = false;
    for (;;) {
      const step = n.steps[m[s]];
      const at = batch.findIndex(([k, a], x) => !used[x] && k === step.kind && a === step.arg);
      if (at < 0) break;
      used[at] = true; m[s] += 1; m[s + 1] = tick;
      if (m[s] === n.steps.length) { m[s + 2] = tick; m[s] = 0; done = true; break; }
    }
    if (!done && n.strict && batch.some(([k, a], x) => !used[x] && n.steps.some((st) => st.kind === k && st.arg === a))) {
      m[s] = 0;
      if (n.onWrong !== null) wrong.push(n.onWrong);
    }
  } else if (n.t === 'gate') for (const x of n.terms) deliver(x, m, batch, tick, wrong);
}

/** R-LINK-6 */
function value(n, m, tick, within, ws) {
  if (n.t === 'ev' || n.t === 'seq') {
    const last = n.t === 'ev' ? m[n.slot] : m[n.slot + 2];
    return within === 0 ? last === tick : last >= 0 && tick - last < within;
  }
  if (n.t === 'cond') return ws.cond(n.kind, n.arg);
  if (n.g === 'not') return !value(n.terms[0], m, tick, within, ws);
  let count = 0;
  for (const x of n.terms) if (value(x, m, tick, n.within, ws)) count++;
  if (n.g === 'all') return count === n.terms.length;
  if (n.g === 'any') return count >= 1;
  return count >= n.k;
}

/**
 * R-LINK-7: evaluate the links once, at the end of a living tick. ws (the sim's side):
 * { tick, cond(kind, arg) -> bool, apply(effects) -> bool changed, dead() -> bool, fired(id) }.
 */
export function runLinks(links, states, batch0, ws) {
  if (links.length === 0) return;
  const tick = ws.tick;
  for (let n = 0; n < links.length; n++) {
    const st = states[n];
    if (st.pend.length === 0) continue;
    for (const p of st.pend) p.left -= 1;
    const due = st.pend.filter((p) => p.left === 0);
    st.pend = st.pend.filter((p) => p.left > 0);
    for (const p of due) { ws.apply(p.undo ? links[n].undo : links[n].do); if (ws.dead()) return; }
  }
  let batch = batch0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    const next = [];
    if (batch.length > 0) {
      for (let n = 0; n < links.length; n++) {
        const wrong = [];
        deliver(links[n].when, states[n].m, batch, tick, wrong);
        for (const list of wrong) { if (ws.apply(list)) changed = true; if (ws.dead()) return; }
      }
    }
    for (let n = 0; n < links.length; n++) {
      const L = links[n], st = states[n], v = value(L.when, st.m, tick, 0, ws);
      if (v && !st.val) {
        if (st.pend.some((p) => p.undo)) { st.pend = st.pend.filter((p) => !p.undo); st.active = true; }
        else if (!st.spent) {
          st.active = true;
          if (!L.repeat) st.spent = true;
          next.push(['linkFired', L.id]);
          ws.fired(L.id);
          if (L.delay === 0) { if (ws.apply(L.do)) changed = true; } else st.pend.push({ left: L.delay, undo: false });
        }
      } else if (!v && st.val && st.active) {
        st.active = false;
        if (L.ev) { /* event-valued: queued effects still land (decision #31) */ }
        else if (st.pend.some((p) => !p.undo)) st.pend = st.pend.filter((p) => p.undo);
        else if (L.undo !== null) {
          if (L.delay === 0) { if (ws.apply(L.undo)) changed = true; } else st.pend.push({ left: L.delay, undo: true });
        }
      }
      st.val = v;
      if (ws.dead()) return;
    }
    if (!changed && next.length === 0) break;
    batch = next;
  }
}
