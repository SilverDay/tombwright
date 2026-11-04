// Lantern Delve's foe sprites, ported verbatim from reference/lantern-delve/LanternDelve.html ("pixel-art sprites",
// MIT, decision #60), and the sprite heights from its MONSTERS table. Renderer only.
// Lantern Delve's `warden` is the Warden of the Deep (a boss, step 7d); Gloamhollow's bone gardener, also `warden`
// in the bestiary, keeps its own sprite in textures.js.
import { cv } from './textures.js';

function pix(rows, pal, sym, over) {
  let R = sym ? rows.map(r => r + [...r].reverse().join('')) : rows.slice();
  if (over) R = R.map((r, y) => {
    const o = over[y]; if (!o) return r;
    const s = r.padEnd(Math.max(r.length, o.length), '.').split('');
    for (let x = 0; x < o.length; x++) if (o[x] !== '.') s[x] = o[x];
    return s.join('');
  });
  const w = Math.max(...R.map(r => r.length)), h = R.length, c = cv(w, h), g = c.getContext('2d');
  R.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch === '.') continue; g.fillStyle = pal[ch] || '#ff00ff'; g.fillRect(x, y, 1, 1); } });
  return c;
}
const KOBOLD_ROWS = ['...k....', '...kk.kk', '....kGGG', '....GGGG', '...kGyGG', '....GGGG', '.....GwG', '......GG', '...kGGGG',
  '..kG.GGG', '..G..GGG', '..G..ccc', '.kg..crc', '.....cc.', '.....G..', '.....G..', '....gG..', '....kk..'];
const WRAITH_ROWS = ['......ccc', '.....cCCC', '....cCkkk', '....cCkek', '....cCkkk', '....cCCkk', '...cCCCCC', '..cCCCCCC', '.hcCCCCCC',
  'hhcCCCCcC', '..cCCCCcC', '..cCCCCcC', '..cCCCCcC', '..cCCcCcC', '..cCcCCcC', '...cCcCcC', '...c.cC.c', '...c..c.c', '....c...c'];
const ART = {
  aquator: pix(['.....bbb', '...bbBBB', '..bBBBBB', '.bBBBBBB', '.bBkkBBB', 'bBBkwBBB', 'bBBBBBBB', 'bBcBBBBB', 'bBcBBBBB', 'bBBBBBmm', '.bBBBBBB', '..bBbBBB', '.b..b.bB', '......b.'],
    { b: '#1d5674', B: '#3a8fb8', c: '#a6e4ff', k: '#08161e', w: '#ffffff', m: '#0e3346' }, true),
  bat: pix(['b.........', 'bb......k.', 'bbb....kkk', 'bbbb..kkek', '.bbbbbkkkk', '..bbbbbkkk', '...bb.bkkk', '....b...kk', '........k.'],
    { k: '#4a3a46', b: '#7a6270', e: '#ff4a3a' }, true),
  centaur: pix(['.....hhh............', '....hfffh...........', '....hfkfh...........', '.....fff............', '...FffffF...........', '..Ff.fffF.F.........', '..f..fffF..f........',
    '.....fFFF...........', '....bbbbbbbbbbbb.t..', '...bBBBBBBBBBBBbbtt.', '...bBBBBBBBBBBBBb.t.', '...bBBBBBBBBBBBBb..t', '....bbbbbbbbbbbbb...', '....bb.b.....b.bb...',
    '....b..b.....b..b...', '....b..b.....b..b...', '....b..b.....b..b...', '....k..k.....k..k...'],
    { h: '#3a2616', f: '#c69068', F: '#9a6a48', k: '#1a0e08', b: '#6e4a2c', B: '#94673c', t: '#3a2616' }),
  dragon: pix(['..........hh', '.........hgg', 'w.......ggGG', 'ww.....gGGGG', 'wWw...gGrGGG', 'wWWw..gGGGGG', 'wWWWw.gGGGGk', 'wWWWWwgGGGkk', 'wWWWWWgGGGGG',
    '.wWWWWgGyyyy', '..wWWWgGyYyy', '...wWWgGyyyy', '....wwgGyYyy', '......gGyyyy', '......gGGyyy', '.....gGG.gGG', '.....gG...gG', '....kkk...kk'],
    { g: '#5a2418', G: '#8e3a22', h: '#ddd2b0', w: '#3a1610', W: '#6a281c', r: '#ffcc33', k: '#140806', y: '#c8964a', Y: '#a87830' }, true),
  emu: pix(['...bb.........', '..bbbb........', '.ybwbb........', 'yy.bbb........', '....bb........', '....bb........', '....bb........', '....bbb.......', '...bBBBBbb....',
    '..bBBBBBBBbb..', '..bBBBBBBBBBb.', '..bBBBBBBBBbbb', '...bBBBBBBbb..', '....bbbbbb....', '.....l..l.....', '.....l..l.....', '.....l..l.....', '....ll.ll.....'],
    { b: '#4e4032', B: '#76664e', w: '#ffd84a', y: '#c8a050', l: '#8a7050' }),
  flytrap: pix(['..gggggg', '.gGGGGGG', 'gGGGGGGG', 'gGrrrrrr', 'WtWtWtWt', 'mmmmmmmm', 'tWtWtWtW', 'gGrrrrrr', 'gGGGGGGG', '.gGGGGGG', '..gggggg',
    '.......s', '.......s', 'll.....s', '.lll...s', '..llllls', '....llls'],
    { g: '#2c561c', G: '#58983a', r: '#b8303a', W: '#f0ead0', t: '#b8b090', m: '#3a0808', s: '#3d6a22', l: '#4a8a2e' }, true),
  griffin: pix(['..ww..................', '.wwww.................', 'yWkwww........aaa.....', 'yyWwwww......aAAAa....', '..wwwww.....aAAAAAa...', '...wwwwbbb.aAAAAAa....',
    '....wwwbbbbbAAAAa.....', '.....bbBBBBBBBAa......', '.....bBBBBBBBBBBb.....', '.....bBBBBBBBBBBBb..t.', '.....bBBBBBBBBBBBBbtt.', '......bBBBBBBBBBBBb.t.',
    '......bbbbbbbbbbbbb...', '......bb.b.....b.bb...', '......b..b.....b..b...', '......y..b.....b..b...', '.....yy..y.....k..k...'],
    { w: '#e8e0cc', W: '#b8b0a0', k: '#140c08', y: '#d8a030', a: '#7a5a30', A: '#a07a40', b: '#9a7438', B: '#c09450', t: '#6a4a20' }),
  hobgoblin: pix(KOBOLD_ROWS, { k: '#1f1410', g: '#8a3a1e', G: '#c0643a', y: '#fff070', w: '#efe6c8', c: '#4a4a54', r: '#2a2a30' }, true),
  ice: pix(['......c', '.....cC', '..c.cCW', '.cCcCCC', 'cCCCCCC', 'cCkkCCC', 'cCkwCCC', 'cCCCCCC', '.cCCCCW', '.cCCCCC', '..cCcCC', '...c.cC', '......c'],
    { c: '#5fa6cc', C: '#c4ecfa', W: '#ffffff', k: '#0e2a3c', w: '#ffffff' }, true),
  jabberwock: pix(['........hh.', '.........hh', '........gGG', '.......gGrG', '.......gGGG', '........gGk', '.........gG', 'w.......gGG', 'ww.....gGGG', 'wWw...gGGGG',
    'wWWw.gGGGGG', 'wWWWwgGGGGG', 'wWWWWgGGpGG', '.wWWWgGGGGG', '..wWWgGGGGG', '...wwgGGpGG', '.....gGGGGG', '.....gGGGGG', '....gGG..gG', '....gG....g', '...gGG....g', '...kkk...kk'],
    { g: '#2c3a28', G: '#4e6a44', h: '#c8c0a8', r: '#ff5a1a', k: '#0c0c0a', w: '#2a2030', W: '#4a3a5a', p: '#7a5a9a' }, true),
  kestrel: pix(['.......b', '......bB', '.....bkB', 'b...bBBy', 'bb.bBBBB', 'bBbBBBBB', '.bBBBBBB', '..bBBBBc', '...bBBcc', '....bccc', '.....b.b', '......y.'],
    { b: '#5e3820', B: '#a8683a', k: '#140a06', y: '#e0a030', c: '#d8c8a8' }, true),
  leprechaun: pix(['...ggg', '...gGG', '..gGGG', '..kkky', 'gGGGGG', '..ffff', '..fkff', '..ffff', '.rrfff', '.rrrrr', '..rrrr', '.gGGGG', 'gGGGyy', 'f.GGGG', '..GGGG', '..g.gG', '..k..k'],
    { g: '#256025', G: '#3c963c', k: '#141414', y: '#e0c040', f: '#e0b08a', r: '#c8602a' }, true),
  medusa: pix(['s.s.s..', '.sSsSs.', 's.sSSSs', '.sSSSSS', '..sffff', '..fkyff', '..fffff', '...fffr', '....fff', '..dDDDD', '.dDDDDD', 'dDDfDDD', 'f.dDDDD', '..dDDDD', '..dDDDD', '.dDDDDD', '.dDDDDD', 'dDDDDDD'],
    { s: '#2c6a28', S: '#5aa040', f: '#9ac08a', k: '#102010', y: '#ffe040', r: '#6a2a2a', d: '#34263f', D: '#5a4070' }, true),
  nymph: pix(['..hhhh', '.hHHHH', 'hHffff', 'hHfkff', 'hHffff', 'hH.fff', 'h..ffp', '..gGGG', '.fgGGG', 'f.gGGG', '..gGGG', '.gGGGG', '.gGGGG', 'gGGGGG', '...f.f', '...f.f'],
    { h: '#d8a040', H: '#f0c860', f: '#f0d0b0', k: '#2a3a4a', p: '#e8e8f0', g: '#2f6e52', G: '#56a07a' }, true),
  orc: pix(['......kkkk', '.....kOOOO', '....kOOOOO', '....OOrkOO', '....OOOOOO', '....OwOOOk', '.....OOOOO', '..aaAAoOOO',
    '.aAAAaOOOO', '.aAaOOOLLL', '..OO.OOLLL', '..OO.OOOOO', '..OO.lLLLL', '.OOo.lLlLL', '.kOk.lLLLL', '.....OOO..',
    '.....OOO..', '.....OOO..', '....lLLL..', '....kkkk..'],
    { O: '#6e8a5a', o: '#4e6640', k: '#161410', r: '#ff3020', w: '#efe6c8', a: '#565a62', A: '#8a8e96', l: '#5a3b22', L: '#7a5230' }, true),
  phantom: pix(WRAITH_ROWS, { c: '#7e879e', C: '#c4ccdc', k: '#1c2028', e: '#ffffff', h: '#dfe4ee' }, true),
  quagga: pix(['..bb................', '.bbbb...............', 'bbkbbm..............', 'nbbbbmm.............', '.bbbbbmm............', '...bsbbmm...........', '....bsbbbbbbbbbb....',
    '....bbsbsbsBBBBBb...', '....bsbsbsbBBBBBBbt.', '....bbsbsbBBBBBBBbt.', '.....bbbbbbBBBBBBb.t', '.....bb.b.....b.bb..', '.....b..b.....b..b..', '.....b..b.....b..b..', '.....k..k.....k..k..'],
    { b: '#86643e', B: '#b08a5a', s: '#241a10', k: '#160e08', m: '#241a10', n: '#3a2a1e', t: '#241a10' }),
  rattlesnake: pix(['.......bb.....', '......bBkb....', '......bBBy....', '.......bBb....', '........bB....', '...bbbbbBBb...', '..bBdBdBdBBb..', '.bBdBdBdBdBBb.', 'bBBBBBBBBBBBBb', '.bbbbbbbbbbbrr'],
    { b: '#665628', B: '#a8904a', d: '#3a2e14', k: '#140c04', y: '#c03030', r: '#d8c8a0' }),
  snake: pix(['......bb....', '.....bBkb...', '.....bBBr...', '......bB....', '..bbbbbBb...', '.bBBBBBBBb..', 'bBBBBBBBBBb.', '.bbbbbbbbbbb'],
    { b: '#265426', B: '#4a8a3a', k: '#0a140a', r: '#c03030' }),
  troll: pix(['.....gggg', '....gGGGG', '....GGrGG', '....GGGGG', '.....GwGG', '..ggGGGGG', '.gGGGGGGG', 'gGGGGGGGG', 'gGG.gGGGG', 'gG..gGGGG', 'gG..lLLLL', 'GG..lLLLL',
    'kG..GGGGG', '....GGG.G', '....GGG..', '....GG...', '...gGG...', '...kkk...'],
    { g: '#365436', G: '#5a7a52', r: '#ff3020', w: '#efe6c8', l: '#5a3b22', L: '#7a5230', k: '#141410' }, true),
  unicorn: pix(['h...................', '.h..................', '..hbb...............', '..bbbbm.............', '.brbbbmm............', 'bbbbbbmm............', '.bb.bbbmm...........',
    '.....bbbbbbbbbbbb...', '.....bBBBBBBBBBBbb..', '.....bBBBBBBBBBBbbt.', '.....bBBBBBBBBBBb.t.', '......bbbbbbbbbbb..t', '......bb.b....b.bb..', '......b..b....b..b..', '......b..b....b..b..', '......k..k....k..k..'],
    { h: '#e8e0d0', b: '#1c1a22', B: '#363242', m: '#4a4458', r: '#ff2a2a', k: '#000000', t: '#4a4458' }),
  vampire: pix(['...kkkk', '..kkkkk', '..kffff', '..kfrff', '..kffff', '...fwff', 'c.ccfff', 'cCcRRRR', 'cCcRRRR', 'cCCkRRR', 'cCCkRRR', 'cCCkkkk', 'cCCkkkk', 'cCCkkkk',
    'cCCkk.k', 'cCCkk.k', 'cCCkk.k', 'cC.kk.k', 'c..kk.k'],
    { k: '#141018', f: '#e0dcd8', r: '#ff2030', w: '#ffffff', c: '#2a0a12', C: '#5a1020', R: '#8a1a2a' }, true),
  wraith: pix(WRAITH_ROWS, { c: '#353c50', C: '#56607c', k: '#07080c', e: '#7fe7ff', h: '#8a93aa' }, true),
  xeroc: pix(['..iIIIIIII', '.iWWWWWWWW', '.iWWWWeWWW', '.iWWWWWWWW', '.itWtWtWtW', '.imtmmmmmm', '.immmmTTTT', '.immmmmmTT',
    '.itmtmtmtm', '.iwwwwwwww', '.iwwIIwwww', '.iwwwwwwww', '..iiiiiiii'],
    { w: '#5e4026', W: '#86602f', i: '#3e3e44', I: '#8c8c94', t: '#efe8d0', m: '#2a0808', T: '#c0405a', e: '#ffcc00' }, true),
  yeti: pix(['.....www', '....wWWW', '...wWWWW', '...WbkbW', '...WbbbW', '....WbbW', '..wwWWWW', '.wWWWWWW', 'wWWWWWWW', 'wWW.WWWW', 'wW..WWWW', 'wW..WWWW', 'Wk..WWWW',
    '....WWW.', '....WWW.', '....WW..', '...wWW..', '...kkk..'],
    { w: '#aab4be', W: '#e4eaf0', b: '#5a7a9a', k: '#1a2028' }, true),
  zombie: pix(['...ggg', '..gGGG', '..GkGG', '..GGGG', '..GGmG', '...GGG', '..cCCC', '.cCCcC', 'gcCCCC', 'G.cCCC', 'G.cCcC', '..pPPP', '..pPPP', '..pP.P', '..pP.P', '..gG.G', '..kk.k'],
    { g: '#566648', G: '#7a8a62', k: '#1a1a14', m: '#2a1010', c: '#44445a', C: '#66667a', p: '#3a2e24', P: '#5a4636' }, true),
  warden: pix([
    '..h...........', '..hh..........', '...hh....kkkkk', '....hhhkkAAAAA', '......kAAAAAAA', '......kAkkkkkk',
    '......kAkkekkk', '......kAkkkkkk', '.......kAAAkkk', '....aaaaaAAAAk', '..aaAAAAAaAAAA', '.aAAAAAAAaAAAA',
    '.aAAAaccaAAAgG', '.aAAa.ccaAAgGG', '.aAAa.ccaAAAgG', '.aAAa.ccaAAAAA', '.aAAa.ccaaAAAA', '.kAAk.ccaAAAAA',
    '.kkkk.ccaAAkAA', '......ccaAAAAA', '......ccaaaAAA', '......cc.aAAAk', '......cc.aAAAk', '......cc.aAAkk',
    '......cc.aAAk.', '......cc.aAAk.', '.....ccc.aAAk.', '.....cc.aaAAk.', '.....c..akkkk.',
  ], { a: '#3a3d46', A: '#5e6372', k: '#0d0e12', h: '#d9d0b8', e: '#9fe2ff', g: '#86cbe8', G: '#d6f4ff', c: '#5a1a20' }, true),
  merchant: pix([
    '.....mmmm', '....mMMMM', '...mMMkkk', '...mMkfff', '...mMkfef', '...mMkfff', '...mMMkff', '..pmMMMMM', '.pPmMMMMM',
    '.pPmMMMMM', '.pPmMMMMM', '.pPmMMmMM', '..pmMMmMM', '...mMMmMM', '...mMMmMM', '...mMMmMM', '...mmMmMM', '...kk.kk.',
  ], { m: '#4e3d2a', M: '#735b3c', k: '#14100c', f: '#c49a72', e: '#2a1a10', p: '#8a6a3a', P: '#a8844a', l: '#ffd27a', L: '#fff2c0', i: '#3a3a3a' }, true,
  ['', '', '', '', '', '', '', '', '', '...............i', '...............i', '..............lll', '..............lLl', '..............lll']),
};

/** Sprite height in metres per bestiary kind (Lantern Delve MONSTERS h). */
export const DELVE_H = { aquator: 1.0, bat: 0.62, centaur: 2.0, dragon: 2.6, emu: 1.7, flytrap: 1.5, griffin: 2.0, hobgoblin: 1.4, ice: 1.0, jabberwock: 2.7, kestrel: 0.6, leprechaun: 0.95, medusa: 1.85, nymph: 1.65, orc: 1.95, phantom: 1.85, quagga: 1.6, rattlesnake: 0.75, snake: 0.5, troll: 2.3, unicorn: 1.8, vampire: 1.85, wraith: 1.85, xeroc: 0.95, yeti: 2.1, zombie: 1.8, warden: 2.9 };
/** Lantern Delve's names, for the death card ("struck down by …"). */
export const DELVE_NAMES = { aquator: 'aquator', bat: 'bat', centaur: 'centaur', dragon: 'dragon', emu: 'emu', flytrap: 'venus flytrap', griffin: 'griffin', hobgoblin: 'hobgoblin', ice: 'ice monster', jabberwock: 'jabberwock', kestrel: 'kestrel', leprechaun: 'leprechaun', medusa: 'medusa', nymph: 'nymph', orc: 'orc', phantom: 'phantom', quagga: 'quagga', rattlesnake: 'rattlesnake', snake: 'snake', troll: 'troll', unicorn: 'black unicorn', vampire: 'vampire', wraith: 'wraith', xeroc: 'xeroc', yeti: 'yeti', zombie: 'zombie', warden: 'Warden of the Deep' };
export { ART as DELVE_ART };
