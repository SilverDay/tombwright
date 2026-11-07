// The live Wiring panel of a playtest (decision #93): every link of the tomb with what the sim says about it right now.
// Display only: it reads the sim state and never writes it. The link-level facts (when true, active, spent, pending) are
// the core's own; for single triggers it shows what is cheap to read (when an event last fired, a few conditions).
import * as L from '../build/links.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

export class WiringLive {
  /** @param T the loaded tomb ({ gdf }), @param host the element to fill */
  constructor(T, host) {
    this.T = T; this.host = host;
    const ents = T.gdf.entities ?? [];
    this.order = [...(T.gdf.links ?? [])].sort((a, b) => a.id - b.id);     // the core keeps links in ascending id order
    const idx = (type) => ents.filter((e) => e.type === type).map((e) => e.id);
    this.doors = idx('door'); this.braziers = idx('brazier'); this.sets = idx('bellSet'); this.zones = (T.gdf.zones ?? []).map((z) => z.id);
    this.num = (id) => ents.findIndex((e) => e.id === id) + 1;             // entity number, as in state.taken
    this.rows = [];
    this.build();
  }

  build() {
    const h = this.host; h.replaceChildren();
    h.appendChild(el('h2', null, 'Wiring'));
    if (this.order.length === 0) h.appendChild(el('p', 'hint', 'This tomb has no links.'));
    this.rows = this.order.map((link) => {
      const art = el('article', 'wl'); const head = el('div', 'wlhead');
      const title = el('b', null, `Link ${link.id}`), badge = el('span', 'wlbadge');
      head.append(title, badge); art.appendChild(head);
      art.appendChild(el('p', 'wlsum', L.describeLink(link)));
      const terms = [];
      const slots = L.slotMap(link);
      const walk = (path) => {
        const t = L.termAt(link, path), g = L.gateKey(t);
        const row = el('div', 'wlterm'); row.style.marginLeft = `${path.length * 10}px`;
        const label = el('span', null, g ? L.GATE_LABEL[g] : L.describeTerm(t)); const state = el('span', 'wlstate');
        row.append(label, state); art.appendChild(row);
        terms.push({ path, t, g, state, slot: slots.find((s) => s.path.join('.') === path.join('.')) });
        if (g) L.children(t)[1].forEach((_, i) => walk([...path, i]));
      };
      walk([]);
      this.host.appendChild(art);
      return { link, art, badge, terms };
    });
  }

  /** Read one condition from the state, or null if this panel does not know how. */
  cond(t, st) {
    const key = L.triggerKey(t), a = t[key];
    switch (key) {
      case 'doorOpen': return st.doors[this.doors.indexOf(a)]?.open ?? null;
      case 'lightLit': { const n = this.braziers.indexOf(a); return n >= 0 ? Boolean(st.braziers[n]?.lit ?? st.braziers[n]) : null; }
      case 'inZone': return null;
      case 'hasItem': return st.taken.includes(this.num(a));
      case 'lanternHung': return (st.player.hung >= 0) === a;
      case 'bellsSolved': return st.bellSets[this.sets.indexOf(a)]?.solved ?? null;
      case 'linkActive': { const n = this.order.findIndex((l) => l.id === a); return n >= 0 ? st.links[n].active : null; }
      case 'bossAwake': return st.boss ? st.boss.st !== 'asleep' && st.boss.st !== 'dead' : null;
      default: return null;
    }
  }

  update(st) {
    if (this.host.hidden || !st || !st.links) return;
    this.rows.forEach((r, n) => {
      const s = st.links[n]; if (!s) return;
      const spent = s.spent && r.link.repeat !== true;
      const bits = [];
      bits.push(s.val ? 'true now' : 'waiting');
      if (s.active) bits.push('active');
      if (spent) bits.push('used up');
      if (s.pend.length) bits.push(`effects in ${(Math.min(...s.pend.map((p) => p.left)) / 30).toFixed(1)} s`);
      r.badge.textContent = bits.join(' · ');
      r.art.classList.toggle('on', s.val); r.art.classList.toggle('done', spent);
      for (const x of r.terms) {
        if (x.g) { x.state.textContent = ''; continue; }
        const key = L.triggerKey(x.t);
        if (L.isEventKey(key) && x.slot && x.slot.slot >= 0) {
          const last = s.m[x.slot.slot];
          x.state.textContent = last >= 0 ? `fired ${((st.tick - last) / 30).toFixed(1)} s ago` : 'not yet';
        } else {
          const v = this.cond(x.t, st);
          x.state.textContent = v === null ? '' : v ? 'true' : 'false';
        }
      }
    });
  }
}
