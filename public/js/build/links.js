// Links for the builder's wiring view (M2 slice 4, decisions #91-#93): the pure data side. No DOM, so node tests cover
// it, and the playtest page reuses `describe*` to label the live panel. The table says which triggers and effects
// exist and what each takes; `Sim.load` (the links compiler) stays the only validator. Rules: R-LINK-1..3, spec §4.3.
import { entities, byId, groupIds } from './entities.js';

const trig = (k) => (typeof k === 'string' && Object.hasOwn(TRIGGERS, k) ? TRIGGERS[k] : undefined);
const eff = (k) => (typeof k === 'string' && Object.hasOwn(EFFECTS, k) ? EFFECTS[k] : undefined);
export const MAX_LINKS = 64, MAX_EFFECTS = 16, MAX_TERMS = 8, MAX_TRIGGERS = 16, MAX_DEPTH = 4;
export const GATES = ['all', 'any', 'atLeast', 'sequence', 'not'];
export const GATE_LABEL = { all: 'ALL of', any: 'ANY of', atLeast: 'AT LEAST … of', sequence: 'SEQUENCE (in this order)', not: 'NOT' };

const ofType = (doc, ...types) => entities(doc).filter((e) => types.includes(e.type));
const ids = (list) => list.map((e) => ({ value: e.id, text: e.id }));
const looseItems = (doc) => ofType(doc, 'item').filter((e) => e.kind !== 'rubble');

/** Triggers by key: `event` or `cond`, what the argument is, the options for it (null: fixed), and a sentence. */
export const TRIGGERS = {
  // events (happen on one tick)
  interact: { kind: 'event', label: 'you interact with', opts: (d) => ids(ofType(d, 'door', 'item', 'bell', 'lampHook', 'mirror', 'chest', 'brazier')), say: (a) => `you interact with “${a}”` },
  itemTaken: { kind: 'event', label: 'you take the item', opts: (d) => ids(looseItems(d)), say: (a) => `you take “${a}”` },
  enterZone: { kind: 'event', label: 'you enter the chamber', opts: (d) => zoneOpts(d), say: (a) => `you enter “${a}”` },
  leaveZone: { kind: 'event', label: 'you leave the chamber', opts: (d) => zoneOpts(d), say: (a) => `you leave “${a}”` },
  bellsWrong: { kind: 'event', label: 'the bell set is rung wrong', opts: (d) => ids(ofType(d, 'bellSet')), say: (a) => `the bells “${a}” are rung wrong` },
  linkFired: { kind: 'event', label: 'link … fires', opts: (d, self) => linkOpts(d, self), say: (a) => `link ${a} fires`, num: true },
  foesDefeated: { kind: 'event', label: 'the last foe of the group falls', opts: (d) => groupOpts(d), say: (a) => `the last foe of “${a}” falls` },
  bossDefeated: { kind: 'event', label: 'the boss is defeated', opts: null, fixed: true, needs: (d) => ofType(d, 'boss').length > 0, say: () => 'the boss is defeated' },
  // conditions (true or false at any tick)
  doorOpen: { kind: 'cond', label: 'the door is open', opts: (d) => ids(ofType(d, 'door')), say: (a) => `door “${a}” is open` },
  inZone: { kind: 'cond', label: 'you are in the chamber', opts: (d) => zoneOpts(d), say: (a) => `you are in “${a}”` },
  hasItem: { kind: 'cond', label: 'you carry the item', opts: (d) => ids(looseItems(d)), say: (a) => `you carry “${a}”` },
  lanternHooded: { kind: 'cond', label: 'the lantern is hooded', opts: null, bool: true, say: (a) => (a ? 'the lantern is hooded' : 'the lantern is open') },
  lanternHung: { kind: 'cond', label: 'the lantern hangs on a hook', opts: null, bool: true, say: (a) => (a ? 'the lantern hangs on a hook' : 'the lantern is off its hook') },
  bellsSolved: { kind: 'cond', label: 'the bell set is solved', opts: (d) => ids(ofType(d, 'bellSet')), say: (a) => `the bells “${a}” are solved` },
  beamHits: { kind: 'cond', label: 'the light beam hits the crystal', opts: (d) => ids(ofType(d, 'crystal')), say: (a) => `the beam hits “${a}”` },
  linkActive: { kind: 'cond', label: 'link … is active', opts: (d, self) => linkOpts(d, self), say: (a) => `link ${a} is active`, num: true },
  foesAlive: { kind: 'cond', label: 'foes of the group are alive', opts: (d) => groupOpts(d), say: (a) => `foes of “${a}” are alive` },
  bossAwake: { kind: 'cond', label: 'the boss is awake', opts: null, fixed: true, needs: (d) => ofType(d, 'boss').length > 0, say: () => 'the boss is awake' },
  lightLit: { kind: 'cond', label: 'the brazier is lit', opts: (d) => ids(ofType(d, 'brazier')), say: (a) => `brazier “${a}” is lit` },
};
const zoneOpts = (d) => (d.gdf.zones ?? []).map((z) => ({ value: z.id, text: `${z.id} (${z.name})` }));
const groupOpts = (d) => groupIds(d).map((g) => ({ value: g, text: g }));
const linkOpts = (d, self) => (d.gdf.links ?? []).filter((l) => l.id !== self).map((l) => ({ value: l.id, text: `link ${l.id}` }));

/** Effects by key. `opts` null means a typed value (damage, message). */
export const EFFECTS = {
  openDoor: { label: 'open the door', opts: (d) => ids(ofType(d, 'door')), say: (a) => `open door “${a}”` },
  closeDoor: { label: 'close the door', opts: (d) => ids(ofType(d, 'door')), say: (a) => `close door “${a}”` },
  sealDoor: { label: 'seal the door shut', opts: (d) => ids(ofType(d, 'door')), say: (a) => `seal door “${a}”` },
  spawnFoes: { label: 'spawn the group', opts: (d) => groupOpts(d), say: (a) => `spawn the foes of “${a}”` },
  wakeBoss: { label: 'wake the boss', opts: (d) => ids(ofType(d, 'boss')), say: () => 'wake the boss' },
  lightOn: { label: 'light the brazier', opts: (d) => ids(ofType(d, 'brazier')), say: (a) => `light brazier “${a}”` },
  lightOff: { label: 'put out the brazier', opts: (d) => ids(ofType(d, 'brazier')), say: (a) => `put out brazier “${a}”` },
  setCheckpoint: { label: 'set the checkpoint of', opts: (d) => (d.gdf.zones ?? []).filter((z) => z.checkpoint).map((z) => ({ value: z.id, text: `${z.id} (${z.name})` })), say: (a) => `set the checkpoint of “${a}”` },
  reveal: { label: 'reveal the hidden item', opts: (d) => ids(ofType(d, 'item').filter((e) => e.hidden === true)), say: (a) => `reveal “${a}”` },
  hide: { label: 'hide the item again', opts: (d) => ids(ofType(d, 'item').filter((e) => e.hidden === true)), say: (a) => `hide “${a}”` },
  damage: { label: 'hurt you by', opts: null, int: { min: 1, max: 1000, def: 10 }, say: (a) => `hurt you by ${a}` },
  message: { label: 'show the message', opts: null, text: { max: 1000, def: 'Somewhere below, stone grinds against stone.' }, say: (a) => `say “${String(a).slice(0, 60)}”` },
};

export const isEventKey = (k) => trig(k)?.kind === 'event';
export { trig as triggerInfo, eff as effectInfo };
export const gateKey = (t) => (t && typeof t === 'object' ? GATES.find((g) => Object.hasOwn(t, g)) ?? null : null);
export const triggerKey = (t) => (t && typeof t === 'object' && !gateKey(t) ? Object.keys(t)[0] ?? null : null);

/** Event-valued: an event trigger or a sequence. (Everything else is condition-valued.) */
export function isEventValued(t) {
  const g = gateKey(t);
  if (g) return g === 'sequence';
  return isEventKey(triggerKey(t));
}

/** The child terms of a gate: [key, list] (a `not` holds one term, shown as a list of one). */
export function children(t) {
  const g = gateKey(t);
  if (!g) return null;
  return [g, g === 'not' ? [t.not] : Array.isArray(t[g]) ? t[g] : []];
}

/** The term at `path` (child indices from the link's `when`). */
export function termAt(link, path) {
  let t = link.when;
  for (const i of path) { const c = children(t); if (!c || c[1][i] === undefined) return undefined; t = c[1][i]; }
  return t;
}
const parentOf = (link, path) => (path.length === 0 ? null : termAt(link, path.slice(0, -1)));

/** How many trigger terms a tree holds (sequence steps count). */
export function triggerCount(t) {
  const c = children(t);
  return c ? c[1].reduce((n, x) => n + triggerCount(x), 0) : 1;
}
/** How deep gates nest. */
export function depthOf(t) {
  const c = children(t);
  return c ? 1 + Math.max(0, ...c[1].map(depthOf)) : 0;
}

// ------------------------------------------------------------------ building terms
/** Why a trigger cannot be made right now, or null. */
export function whyNot(doc, key, self) {
  const t = trig(key);
  if (!t) return 'Unknown trigger.';
  if (t.needs && !t.needs(doc)) return 'The tomb has no boss yet.';
  if (t.opts && t.opts(doc, self).length === 0) return `Nothing to point at yet (${t.label}).`;
  return null;
}
/** A fresh trigger term for `key`, pointing at the first thing that fits; or a reason string. */
export function newTrigger(doc, key, self) {
  const why = whyNot(doc, key, self);
  if (why) return why;
  const t = trig(key);
  if (t.fixed) return { [key]: true };
  if (t.bool) return { [key]: true };
  return { [key]: t.opts(doc, self)[0].value };
}
/** The first trigger of a kind (event or condition) that can be made, for filling a new gate. */
export function anyTrigger(doc, want, self) {
  for (const key of Object.keys(TRIGGERS)) if ((!want || trig(key).kind === want) && typeof newTrigger(doc, key, self) === 'object') return newTrigger(doc, key, self);
  return null;
}
/** Which kinds of term a slot accepts: sequence steps are events, a `not` holds a condition-valued term. */
export function slotWants(parent) {
  const g = parent ? gateKey(parent) : null;
  return g === 'sequence' ? 'event' : g === 'not' ? 'cond' : null;
}

/** A gate of `kind` over `kids` (fills up to two terms with fitting triggers). Returns a term or a reason. */
export function newGate(doc, kind, kids, self) {
  const want = kind === 'sequence' ? 'event' : null;
  let list = kids.filter((k) => (want === 'event' ? isEventValued(k) && !gateKey(k) : true));
  if (kind === 'not') {
    const inner = kids.find((k) => !isEventValued(k)) ?? anyTrigger(doc, 'cond', self);
    return inner ? { not: inner } : 'A NOT needs a condition to negate.';
  }
  while (list.length < 2) { const t = anyTrigger(doc, want, self); if (!t) return 'There is nothing to put in the gate yet.'; list = [...list, t]; }
  list = list.slice(0, MAX_TERMS);
  const g = { [kind]: list };
  if (kind === 'atLeast') g.k = Math.min(2, list.length);
  return g;
}

/** Replace the term at `path` with a trigger of `key`. Returns true or a reason. */
export function setTrigger(doc, link, path, key, self = link.id) {
  const want = slotWants(parentOf(link, path));
  if (want && trig(key)?.kind !== want) return want === 'event' ? 'A sequence takes events only.' : 'A NOT takes a condition.';
  const t = newTrigger(doc, key, self);
  if (typeof t === 'string') return t;
  return put(link, path, t);
}
/** Change a trigger's argument (an id, a link id or a boolean). */
export function setArg(doc, link, path, value) {
  const t = termAt(link, path), key = triggerKey(t);
  if (!key) return 'Not a trigger.';
  const info = trig(key);
  if (!info) return 'Not a known trigger.';
  if (info.fixed) return true;
  if (info.bool) { t[key] = Boolean(value); return true; }
  if (info.num) { const n = Number(value); if (!Number.isInteger(n)) return 'A link number.'; t[key] = n; return true; }
  t[key] = String(value); return true;
}
/** Turn the term at `path` into a gate of `kind`, keeping its content where it fits. */
export function setGate(doc, link, path, kind, self = link.id) {
  const cur = termAt(link, path);
  const want = slotWants(parentOf(link, path));
  if (want === 'event' && kind !== 'sequence') return 'A sequence takes events only.';
  if (want === 'cond' && (kind === 'sequence')) return 'A NOT takes a condition.';
  const c = children(cur);
  const kids = c ? c[1] : [cur];
  if (kind === 'sequence' && kids.some((k) => gateKey(k))) kids.splice(0, kids.length, ...kids.filter((k) => !gateKey(k)));
  const g = newGate(doc, kind, kids, self);
  if (typeof g === 'string') return g;
  if (depthOf(g) + path.length > MAX_DEPTH) return 'Gates nest at most 4 deep.';
  return put(link, path, g);
}
function put(link, path, term) {
  if (path.length === 0) { link.when = term; fixUndo(link); return true; }
  const parent = termAt(link, path.slice(0, -1)), g = gateKey(parent), i = path[path.length - 1];
  if (g === 'not') parent.not = term; else parent[g][i] = term;
  fixUndo(link);
  return true;
}
/** Add a child to the gate at `path` (an event for a sequence). Returns true or a reason. */
export function addChild(doc, link, path, self = link.id) {
  const gt = termAt(link, path), g = gateKey(gt);
  if (!g || g === 'not') return 'This gate takes one term.';
  if (gt[g].length >= MAX_TERMS) return 'At most 8 terms in a gate.';
  if (triggerCount(link.when) >= MAX_TRIGGERS) return 'At most 16 triggers in a link.';
  const t = anyTrigger(doc, g === 'sequence' ? 'event' : null, self);
  if (!t) return 'There is nothing to add yet.';
  gt[g].push(t); fixUndo(link); return true;
}
/** Remove the term at `path`. A gate left with one term gives way to it; a NOT or the root cannot be emptied. */
export function removeChild(link, path) {
  if (path.length === 0) return 'A link needs a trigger.';
  const parent = termAt(link, path.slice(0, -1)), g = gateKey(parent), i = path[path.length - 1];
  if (g === 'not') return 'Remove the whole NOT instead, or change what it negates.';
  parent[g].splice(i, 1);
  if (g === 'atLeast') parent.k = Math.min(parent.k, parent[g].length);
  if (parent[g].length === 1) {                                // a gate of one is just that term
    const only = parent[g][0];
    put(link, path.slice(0, -1), only);
  }
  fixUndo(link);
  return true;
}
/** Set a gate option: within (1-1800 or '' to drop), k, strict. */
export function setGateOption(link, path, key, value) {
  const t = termAt(link, path), g = gateKey(t);
  if (!g) return 'Not a gate.';
  if (key === 'within') {
    if (value === '' || value === null) { delete t.within; return true; }
    if (!Number.isInteger(value) || value < 1 || value > 1800) return 'Between 1 and 1800 ticks (30 ticks = 1 s).';
    t.within = value; return true;
  }
  if (key === 'k') {
    if (g !== 'atLeast') return 'Only AT LEAST has a k.';
    if (!Number.isInteger(value) || value < 1 || value > t.atLeast.length) return `Between 1 and ${t.atLeast.length}.`;
    t.k = value; return true;
  }
  if (key === 'strict') {
    if (g !== 'sequence') return 'Only a SEQUENCE can be strict.';
    if (value) t.strict = true; else { delete t.strict; delete t.onWrong; }
    return true;
  }
  return 'Unknown option.';
}

// the undo list is only allowed on condition-valued links (R-LINK-1)
function fixUndo(link) { if (isEventValued(link.when)) delete link.undo; }

// ------------------------------------------------------------------ links
export function nextLinkId(doc) {
  const used = new Set((doc.gdf.links ?? []).map((l) => l.id));
  for (let n = 1; n <= 65535; n++) if (!used.has(n)) return n;
  return 0;
}
/** Add a link with the first trigger and effect that fit. Returns the link or a reason. */
export function addLink(doc) {
  const list = (doc.gdf.links ??= []);
  if (list.length >= MAX_LINKS) return 'At most 64 links.';
  const id = nextLinkId(doc);
  const when = anyTrigger(doc, null, id);
  if (!when) return 'There is nothing to trigger on yet: place a door, a zone, an item… first.';
  const fx = newEffect(doc, firstEffectKey(doc));
  if (typeof fx === 'string') return fx;
  const link = { id, when, do: [fx] };
  list.push(link); list.sort((a, b) => a.id - b.id);
  return link;
}
export function removeLink(doc, id) {
  const list = doc.gdf.links ?? [], n = list.findIndex((l) => l.id === id);
  if (n < 0) return false;
  list.splice(n, 1); return true;
}
export const linkById = (doc, id) => (doc.gdf.links ?? []).find((l) => l.id === id);
export function setRepeat(link, on) { if (on) link.repeat = true; else delete link.repeat; return true; }
export function setDelay(link, v) {
  if (v === '' || v === 0) { delete link.delay; return true; }
  if (!Number.isInteger(v) || v < 1 || v > 600) return 'Between 0 and 600 ticks (30 ticks = 1 s).';
  link.delay = v; return true;
}
/** Give a condition-valued link an undo list, or take it away. */
export function setUndo(doc, link, on) {
  if (!on) { delete link.undo; return true; }
  if (isEventValued(link.when)) return 'Only a link that waits on a condition can undo (an event happens once).';
  const fx = newEffect(doc, firstEffectKey(doc));
  if (typeof fx === 'string') return fx;
  link.undo = [fx]; return true;
}

// ------------------------------------------------------------------ effects
const firstEffectKey = (doc) => Object.keys(EFFECTS).find((k) => typeof newEffect(doc, k) === 'object') ?? 'message';
export function newEffect(doc, key) {
  const e = eff(key);
  if (!e) return 'Unknown effect.';
  if (e.int) return { [key]: e.int.def };
  if (e.text) return { [key]: e.text.def };
  const o = e.opts(doc);
  return o.length ? { [key]: o[0].value } : `Nothing to point at yet (${e.label}).`;
}
export const effectKey = (fx) => (fx && typeof fx === 'object' ? Object.keys(fx)[0] ?? null : null);

/** The effect list at `which`: 'do', 'undo', or the onWrong of the sequence at `path`. */
export function listOf(link, which, path = []) {
  if (which === 'do') return link.do;
  if (which === 'undo') return link.undo;
  return termAt(link, path)?.onWrong;
}
export function addEffect(doc, link, which, path = []) {
  let list = listOf(link, which, path);
  if (which === 'onWrong' && !list) { const t = termAt(link, path); if (gateKey(t) !== 'sequence' || t.strict !== true) return 'Only a strict SEQUENCE has an on-wrong list.'; list = t.onWrong = []; }
  if (!list) return 'No such list.';
  if (list.length >= MAX_EFFECTS) return 'At most 16 effects in a list.';
  const fx = newEffect(doc, firstEffectKey(doc));
  if (typeof fx === 'string') return fx;
  list.push(fx); return true;
}
export function setEffect(doc, link, which, path, index, key) {
  const list = listOf(link, which, path);
  if (!list?.[index]) return 'No such effect.';
  const fx = newEffect(doc, key);
  if (typeof fx === 'string') return fx;
  list[index] = fx; return true;
}
export function setEffectArg(link, which, path, index, value) {
  const list = listOf(link, which, path), fx = list?.[index], key = effectKey(fx);
  if (!key) return 'No such effect.';
  const info = eff(key);
  if (!info) return 'Not a known effect.';
  if (info.int) { if (!Number.isInteger(value) || value < info.int.min || value > info.int.max) return `A whole number from ${info.int.min} to ${info.int.max}.`; fx[key] = value; return true; }
  if (info.text) {
    const s = String(value ?? '');
    if (s === '') return 'The message cannot be empty.';
    if (new TextEncoder().encode(s).length > info.text.max) return 'At most 1000 bytes.';
    if (/[\u0000-\u001F\u007F-\u009F]/u.test(s)) return 'No control characters, please.';
    fx[key] = s; return true;
  }
  fx[key] = String(value); return true;
}
export function removeEffect(link, which, path, index) {
  const list = listOf(link, which, path);
  if (!list?.[index]) return 'No such effect.';
  if (which === 'do' && list.length === 1) return 'A link needs at least one effect.';
  list.splice(index, 1);
  if (list.length === 0) { if (which === 'undo') delete link.undo; else if (which === 'onWrong') delete termAt(link, path).onWrong; }
  return true;
}

/** Is this link shaped well enough to draw? (A file the core would refuse can still be opened in the builder.) */
export function wellFormed(link) {
  if (!link || typeof link !== 'object' || !Array.isArray(link.do) || (link.undo !== undefined && !Array.isArray(link.undo))) return false;
  const term = (t, depth) => {
    if (!t || typeof t !== 'object' || Array.isArray(t) || depth > MAX_DEPTH + 1) return false;
    const g = gateKey(t);
    if (!g) return Object.keys(t).length === 1;
    const kids = g === 'not' ? [t.not] : t[g];
    return Array.isArray(kids) && kids.every((k) => term(k, depth + 1));
  };
  return term(link.when, 0);
}

// ------------------------------------------------------------------ words
export function describeTerm(t) {
  const g = gateKey(t);
  if (g) {
    const [, kids] = children(t);
    const inner = kids.map(describeTerm);
    if (g === 'not') return `NOT (${inner[0]})`;
    if (g === 'atLeast') return `AT LEAST ${t.k} of (${inner.join('; ')})`;
    return `${g === 'sequence' ? 'SEQUENCE' : g.toUpperCase()} (${inner.join(g === 'sequence' ? ', then ' : '; ')})`;
  }
  const key = triggerKey(t), info = trig(key);
  return info ? info.say(t[key]) : '(unknown trigger)';
}
export function describeEffect(fx) {
  const key = effectKey(fx), info = eff(key);
  return info ? info.say(fx[key]) : '(unknown effect)';
}
export function describeLink(link) {
  if (!wellFormed(link)) return 'This link is malformed.';
  const bits = [`When ${describeTerm(link.when)}: ${link.do.map(describeEffect).join(', ')}`];
  if (link.delay) bits.push(`after ${(link.delay / 30).toFixed(1)} s`);
  if (link.undo) bits.push(`undo: ${link.undo.map(describeEffect).join(', ')}`);
  if (link.repeat) bits.push('every time');
  return bits.join(' · ');
}

/** Terms in depth-first order with their memory slots, the way the core numbers them (R-LINK-4): each event trigger
 *  outside a sequence takes one slot, a sequence takes three. Used by the live panel to read when events last fired. */
export function slotMap(link) {
  const out = [];
  let slot = 0;
  const walk = (t, path) => {
    const g = gateKey(t);
    if (!g) { const key = triggerKey(t); if (isEventKey(key)) out.push({ path, slot: slot++, seq: false }); else out.push({ path, slot: -1, seq: false }); return; }
    if (g === 'sequence') { out.push({ path, slot, seq: true }); slot += 3; return; }
    children(t)[1].forEach((c, i) => walk(c, [...path, i]));
  };
  walk(link.when, []);
  return out;
}
export { byId };
