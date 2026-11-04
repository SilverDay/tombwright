// Client text. Everything here is shown with textContent, never innerHTML.
// The engine's own lines (what a probe or a pebble finds, the lantern, deaths) come from Gloamhollow.
// Item, bell and foe names stay client text for now (decision #23), per official tomb, keyed by entity id.

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Sim events -> the lines Gloamhollow said for them.
export const SAY = {
  msg: {
    lanternOut: 'Your lantern is out. Pour in some oil first.',
    lanternHung: 'You will not go on without your lantern. It still hangs on the hook.',
    pouchEmpty: 'Your pouch is empty. Walk over pebbles to pick them up, or gather more from loose rubble.',
    noFlasks: 'You have no oil flasks left.',
    lanternFull: 'Your lantern is already full.',
    needLight: 'You need a lit lantern to light it.',
  },
  probe: {
    wall: 'Your pole knocks against stone.',
    stone: 'Solid stone.',
    slab: 'Your pole scrapes the edge of a fallen slab.',
    plateKnown: 'That tile is a pressure plate. You have already marked it.',
    plate: 'The tile shifts a hair under the pole’s tip. A pressure plate. You scratch a mark beside it.',
    pit: 'The pole punches straight through the floor. A false lid of plaster over a pit.',
    pitKnown: 'An open pit. Your pole finds no bottom.',
    void: 'The pole sweeps through empty air.',
    bridge: 'The pole taps something solid where there is nothing to see.',
    vent: 'Iron bars, hot enough to feel through the pole.',
    alcove: 'Wet stone. A thin trickle of black water runs from under the weeping face.',
    tip: 'The floor of the alcove tips like a grinning jaw, nearly taking your pole with it, then swings back. The laughing door grinds shut.',
    needles: 'You nudge the gilded lid with the tip of your pole. Needles hiss from the ring of holes and patter across the floor where you would have knelt. Nothing else happens.',
    needlesSpent: 'The gilded chest’s needles are spent. The holes are empty now.',
    mimic: null,
  },
  land: {
    floor: null,
    slab: null,
    plate: 'The pebble clicks on a tile, and a slab of the ceiling crashes down on top of it.',
    pit: 'The pebble punches through the floor. A long moment later, a faint click far below.',
    void: 'The pebble falls into the dark without a sound.',
    bridge: 'The pebble clinks, skips, and stops, resting on nothing at all.',
  },
  alcove: {
    drown: 'Black water gushes from the weeping face, fills the alcove to the top and drains away again. The weeping door grinds shut.',
    tip: 'The alcove floor tips like a grinning jaw and the pebble slides away into the dark. The laughing door grinds shut.',
  },
  hoodOn: 'You close the lantern’s shutters. Only a thread of light escapes.',
  hoodOff: 'You open the lantern’s shutters.',
  oil: 'You top up your lantern with oil.',
  relit: 'You pour oil into the lantern and strike it alight again.',
  hung: 'You hang your lantern on the hook. A hard beam of light shoots from its lens across the vault, and the rest of the room drops into darkness.',
  hungAgain: 'You hang your lantern on the hook again.',
  unhung: 'You lift your lantern from the hook.',
  rubble: 'You fill your pouch with pebbles.',
  lowOil: 'Your lantern is burning low. Pour in a flask of oil soon.',
  out: 'Your lantern gutters and goes out.',
  eyes: 'All along the walls, stone eyelids begin to lift.',
  smoke: 'Your blade passes through her like smoke. In the dark she has no body to cut.',
  bossPhase2: 'Ilvaris shrieks, and every flame in the sanctum dies at once. She is faster now, and hungrier.',
  bossFeed: 'The Candle-Eater bends over the brazier and begins to drink its flame. In its light, she looks almost solid.',
  bossSwallow: 'She swallows the brazier’s flame, and her shape thins back into smoke.',
  bossDrained: 'She drinks the last of your light. Your lantern goes out. Pour in oil, quickly.',
  brazier: 'The brazier catches with a roar.',
  // Touch powers (R-POW-*), in Lantern Delve's words where it had them.
  power: {
    douse: (who) => `The ${who}'s touch douses your lantern. Hood it to strike it alight again.`,
    freeze: (who) => `The ${who}'s touch freezes you solid!`,
    seize: (who) => `The ${who} seizes you! Kill it to break free.`,
    confuse: (who) => `The ${who}'s touch muddles your senses.`,
    poison: (who) => `The ${who}'s bite poisons you. Your wounds will not close for a while.`,
    drain: () => 'The vampire\'s bite drains your vitality. (−5 max health)',
  },
  free: 'You tear free.',
  // Thieves and tricks (R-THIEF-*, R-FORGET-1, R-MIMIC-1).
  stealTreasure: (who, what) => `The ${who} snatches ${what} and vanishes!`,
  stealFlask: (who) => `The ${who} stole a flask of lamp oil and vanished!`,
  stealPebbles: (who, n) => `The ${who} stole ${n} of your pebbles and vanished!`,
  lootBack: (what) => `You take back ${what}.`,
  forget: 'Something you knew about this chamber slips from your mind.',
  mimic: (was) => `The ${was} was a xeroc!`,
  mimicSafe: (was) => `Your pole jabs the ${was}. It snarls and unfolds: a xeroc!`,
  relit: 'You strike your lantern alight again.',
  thawed: 'You can move again.',
  unconfused: 'You feel less confused now.',
  enter: (name) => `You enter ${name}.`,
  rise: (name) => `You rise in ${name}, cold and stiff, your lantern lit again.`,
  take: (name) => `You take ${name}.`,
  bell: (name) => `${cap(name)} rings, and the note does not fade.`,
  bellQuiet: (name) => `${cap(name)} hums. The garden is quiet now.`,
};

// Deaths by sim cause (R-DEATH-1): the card's cause and lesson (Gloamhollow DEATHS; weep = drown, laugh = tip).
export const DEATHS = {
  slab: { cause: 'A slab of the ceiling dropped on you in the Hall of the Kneeling Bearers.', lesson: 'The plate you stepped on has been sprung for good. The slab still lies there.' },
  pit: { cause: 'You fell through a false floor in the Gallery of Waking Eyes.', lesson: 'That pit stays open now. There may be others.' },
  eyes: { cause: 'The Waking Eyes opened, and burned you to ash where you stood.', lesson: 'The eyes wake to an open flame. They take a moment to open.' },
  vent: { cause: 'The Breathing Hall breathed out while you stood on a vent.', lesson: 'The vents glow and rumble just before they fire.' },
  needles: { cause: 'Needles sprang from the gilded chest, and they were poisoned.', lesson: 'The holes around the lock were the warning.' },
  chasm: { cause: 'You stepped off the Unlit Road and fell into the gulf.', lesson: 'Pebbles and your pole find the road. Any road cell you have found stays marked.' },
  drown: { cause: 'Black water poured from the weeping face and filled the alcove before you could turn.', lesson: 'That door is sealed now.' },
  tip: { cause: 'The floor behind the laughing face tipped like a grinning jaw, and you slid into the dark.', lesson: 'That door is sealed now.' },
  beast: { cause: 'You were struck down by {who}.', lesson: 'Rest between fights: you heal while nothing is hurting you.' },
  damage: { cause: 'You were struck down by {who}.', lesson: 'Rest between fights: you heal while nothing is hurting you.' },
  eater: { cause: 'The Candle-Eater drank your light, and then the rest of you.', lesson: 'In the dark she is smoke. Lit braziers make her solid.' },
};
export const EPITAPHS = ['HERE LIES A THIEF', 'SHE WAS HUNGRY', 'BROUGHT A LIGHT', 'NOT FIRST, NOT LAST', 'THE TOMB REMEMBERS'];

// Per official tomb. Keys are GDF entity ids.
export const TOMB_TEXT = {
  gloamhollow: {
    intro: 'The stair-slab grinds shut above you. You are in the Candle-Eater’s tomb, with a lantern, a ten-foot pole and a pouch of pebbles. A bronze plaque gleams beside the far door.',
    items: {
      chain: { name: 'a silver lamp-chain', icon: 'chain' }, coins: { name: 'a scatter of old coins', icon: 'coins' },
      censer: { name: 'a gold censer', icon: 'censer' }, opal: { name: 'a sun-opal', icon: 'gem' }, ring: { name: 'a moonstone ring', icon: 'ring' },
      rubies: { name: 'a fistful of rubies', icon: 'rubies' }, heart: { name: 'the Heart of Embers', icon: 'heart' },
      crescent: { name: 'the crescent key', icon: 'key', hud: 'Crescent key' },
    },
    bells: {
      great: { name: 'the great bright bell', look: 'A great bell, its bronze still bright as a new coin.' },
      green: { name: 'the small green bell', look: 'A small bell, crusted green with verdigris.' },
      brown: { name: 'the dull brown bell', look: 'A middling bell, dull brown and pitted.' },
    },
    reads: {
      verseText: 'Read the bronze plaque', stairText: 'Look back at the stair', steleText: 'Read the stele', scrawlText: 'Read the scratches on the wall',
      burntText: 'Look at the scorched bones', plinthText: 'Read the plinth', crystalText: 'Look at the crystal', journalText: 'Read the journal',
      ledgeText: 'Read the carving', masksText: 'Read the plaque above the doors',
    },
    // Gloamhollow's own HUD and prompt touches that the GDF doesn't carry.
    damageWho: 'darts from the stone trees',
    boss: { name: 'Ilvaris, the Candle-Eater', who: 'the Candle-Eater' },
  },
};

import { DELVE_NAMES } from './delve-art.js';
const article = (n) => (/^[aeiou]/.test(n) ? 'an ' : 'a ') + n;
// Gloamhollow's two, then Lantern Delve's names (its `warden` is the Warden of the Deep, a boss, not a foe kind here).
export const FOE_NAMES = { ...Object.fromEntries(Object.entries(DELVE_NAMES).filter(([k]) => k !== 'warden').map(([k, n]) => [k, article(n)])), warden: 'a bone gardener', crawler: 'a gloam crawler' };
export const FLASK_NAME = 'a flask of lamp oil';
export const READ_LABEL = { plaque: 'Read the plaque', carving: 'Read the carving', scrawl: 'Read the scratches on the wall', stele: 'Read the stele', book: 'Read the book', look: 'Look closer' };
export const FACE_NAME = { weep: 'weeping', laugh: 'laughing', sleep: 'sleeping', blank: 'blank' };
