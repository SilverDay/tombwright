// Live validation for the builder: the sim core's own loader is the validator (spec §7.3, no second rule set).
// Needs the sine table and the bestiary loaded first, as the game does. Warnings are things the loader allows but a
// published tomb will need (decision #85).
import * as Sim from '../sim/sim.js';
import { toBytes, zoneIndexAt, isFloor, cellAt } from './model.js';

/** The loader's messages are terse; this says what they usually mean in the editor. Unknown ones are shown as they are. */
const HINTS = {
  'grid not closed': 'The outer ring of cells must stay wall.',
  'start.cell is not floor': 'The start is not on a room or corridor cell.',
  'start.cell outside grid': 'The start lies outside the grid.',
  'exit cell': 'The exit is not on a room or corridor cell.',
  'zones overlap': 'Two chambers cover the same cell.',
  'zone rect outside grid': 'A chamber reaches outside the grid.',
  'zone ceil': 'A chamber ceiling must be between 3.0 and 6.5 m.',
  'checkpoint cell': 'A checkpoint must stand on a room or corridor cell inside its own chamber.',
  'checkpoint cell taken': 'A checkpoint stands on a door or a slab.',
  'too many checkpoints': 'At most 12 checkpoints.',
  'zones': 'At most 16 chambers.',
  'door cell': 'A door must stand on a room or corridor cell that is not the start.',
  'cell already taken': 'Two things share one cell.',
  'slab not on a plate': 'A slab needs a pressure plate under it.',
  'vent cell': 'A fire vent cell is not a vent cell.',
  'vent cell without a vent': 'Fire-vent cells need a vent: use the Fire vent tool on them.',
  'entity cell': 'An entity has a bad cell.',
  'entity cell outside grid': 'An entity lies outside the grid.',
  'dressing wall cell': 'A torch, mark or inscription is not on a room or corridor cell.',
  'dressing not on a wall': 'A torch, mark or inscription does not face a wall.',
};
export const explain = (msg) => (HINTS[msg] ? `${HINTS[msg]} (${msg})` : msg.startsWith('links: ') ? `Wiring: ${msg.slice(7)}. Check the link cards in the Wiring view.` : msg);

/** @returns {{ok: boolean, error: string|null, warnings: string[]}} */
export function validate(doc) {
  const warnings = [];
  let error = null;
  try { Sim.load(toBytes(doc)); } catch (e) { error = explain(e instanceof Error ? e.message : String(e)); }
  try { warn(doc, warnings); } catch { if (error === null) error = 'A chamber or a placed thing is malformed.'; }
  return { ok: error === null, error, warnings };
}

function warn(doc, warnings) {
  const g = doc.gdf;
  if (!g.exit) warnings.push('No exit yet: players cannot win. Place one before publishing.');
  const s = g.start?.cell;
  if (s && isFloor(cellAt(doc, s[0], s[1])) && zoneIndexAt(doc, s[0], s[1]) < 0) warnings.push('The start lies outside every chamber.');
  if ((g.zones ?? []).length === 0) warnings.push('There are no chambers yet.');
  // Things that only work once a link wires them (the wiring view comes in a later step of the builder).
  const effects = (g.links ?? []).flatMap((l) => (Array.isArray(l.do) ? l.do : []).concat(Array.isArray(l.undo) ? l.undo : []));
  for (const e of g.entities ?? []) {
    if (e.type === 'door' && e.opens === 'trigger' && !effects.some((x) => x.openDoor === e.id)) warnings.push(`Door “${e.id}” opens on a trigger, but no link opens it yet.`);
    if (e.type === 'foe' && e.start === 'dormant') {
      const grp = typeof e.group === 'string' ? e.group : e.id;
      const spawned = effects.some((x) => x.spawnFoes === grp) || (g.entities ?? []).some((b) => b.type === 'boss' && b.summons === grp);
      if (!spawned) warnings.push(`Foe “${e.id}” is dormant, but no link spawns its group and no boss calls it yet.`);
    }
    if (e.type === 'item' && e.hidden === true && !effects.some((x) => x.reveal === e.id)) warnings.push(`Item “${e.id}” is hidden, but no link reveals it yet.`);
  }
}
