// Renaming ids in the builder (M2 slice 5): every reference follows - other entities (door keys, alcove doors, chests an item
// or inscription belongs to, bell sets) and links (triggers and effects). Pure data; Sim.load stays the validator.
import { entities, byId } from './entities.js';
import * as L from './links.js';

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;
// Trigger and effect keys whose value is an entity id, or a zone id.
const ENTITY_TRIGGERS = ['interact', 'itemTaken', 'hasItem', 'doorOpen', 'bellsWrong', 'bellsSolved', 'lightLit', 'beamHits', 'buttonPressed', 'pebbleHit', 'buttonDown', 'leverOn'];
const ENTITY_EFFECTS = ['openDoor', 'closeDoor', 'sealDoor', 'lightOn', 'lightOff', 'reveal', 'hide', 'grantItem', 'resetButton', 'setLeverOn', 'setLeverOff', 'wakeBoss'];
const ZONE_TRIGGERS = ['enterZone', 'leaveZone', 'inZone'], ZONE_EFFECTS = ['setCheckpoint'];

function eachTerm(t, fn) {
  if (!t || typeof t !== 'object') return;
  const g = L.gateKey(t);
  if (!g) { fn(t); return; }
  for (const c of L.children(t)[1]) eachTerm(c, fn);
  if (Array.isArray(t.onWrong)) for (const fx of t.onWrong) if (fx && typeof fx === 'object') fn(fx);
}
function rewrite(doc, trigKeys, effKeys, from, to) {
  for (const link of doc.gdf.links ?? []) {
    if (!link || typeof link !== 'object') continue;
    eachTerm(link.when, (t) => {                               // a trigger (in the tree) or an on-wrong effect
      const k = Object.keys(t)[0];
      if ((trigKeys.includes(k) || effKeys.includes(k)) && t[k] === from) t[k] = to;
    });
    for (const list of [link.do, link.undo]) if (Array.isArray(list)) for (const fx of list) { const k = fx && typeof fx === 'object' ? Object.keys(fx)[0] : null; if (k && effKeys.includes(k) && fx[k] === from) fx[k] = to; }
  }
}

/** Why `id` cannot be used, or null. */
export function idProblem(doc, id, except, scope = 'entity') {
  if (typeof id !== 'string' || !ID_RE.test(id)) return 'An id: letters, digits and _, starting with a letter or _, at most 32.';
  const used = scope === 'zone' ? (doc.gdf.zones ?? []) : entities(doc);         // chambers and things are separate namespaces (Gloamhollow's door `vest` and chamber `vest`)
  if (id !== except && used.some((e) => e && e.id === id)) return 'That id is already used.';
  return null;
}

/** Rename an entity and everything that points at it. Returns true or a reason. */
export function renameEntity(doc, from, to) {
  const e = entities(doc).find((x) => x && x.id === from);
  if (!e) return 'No such thing.';
  if (from === to) return true;
  const why = idProblem(doc, to, from);
  if (why) return why;
  e.id = to;
  if (doc.gdf.exit?.requires === from) doc.gdf.exit.requires = to;
  for (const x of entities(doc)) {
    if (!x || typeof x !== 'object') continue;
    if (x.type === 'door' && x.key === from) x.key = to;
    if (x.type === 'alcove' && x.door === from) x.door = to;
    if (x.type === 'item' && x.in === from) x.in = to;
    if (x.type === 'inscription' && x.on === from) x.on = to;
    if (x.type === 'bellSet' && Array.isArray(x.bells)) x.bells = x.bells.map((b) => (b === from ? to : b));
  }
  rewrite(doc, ENTITY_TRIGGERS, ENTITY_EFFECTS, from, to);
  return true;
}

/** Rename a chamber and everything that points at it (eyes, the boss, links). Returns true or a reason. */
export function renameZone(doc, from, to) {
  const z = (doc.gdf.zones ?? []).find((q) => q.id === from);
  if (!z) return 'No such chamber.';
  if (from === to) return true;
  const why = idProblem(doc, to, from, 'zone');
  if (why) return why;
  z.id = to;
  for (const x of entities(doc)) if (x && (x.type === 'eyes' || x.type === 'boss') && x.zone === from) x.zone = to;
  rewrite(doc, ZONE_TRIGGERS, ZONE_EFFECTS, from, to);
  return true;
}

/** Renumber a link (1-65535) and every `linkFired` / `linkActive` that names it. Returns true or a reason. */
export function renameLink(doc, from, to) {
  const links = (doc.gdf.links ?? []).filter((q) => q && typeof q === 'object'), l = links.find((q) => q.id === from);
  if (!l) return 'No such link.';
  if (from === to) return true;
  if (!Number.isInteger(to) || to < 1 || to > 65535) return 'A link number from 1 to 65535.';
  if (links.some((q) => q.id === to)) return 'That number is already used.';
  l.id = to;
  rewrite(doc, ['linkFired', 'linkActive'], [], from, to);
  doc.gdf.links.sort((a, b) => (Number.isInteger(a?.id) ? a.id : 0) - (Number.isInteger(b?.id) ? b.id : 0));
  return true;
}
