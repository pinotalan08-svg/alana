'use strict';

const MAX_FLOOR = 10;
const FOV_RADIUS = 7;

// One visual theme per depth band. Colors feed the procedural tile textures.
const THEMES = [
  {
    name: 'Les Cryptes', flagstones: true, torches: true,
    floor: '#2c2734', floorAlt: '#302a39', grout: '#221e29', speck: '#3a3345', decoA: '#cfc6b4', decoB: '#8f8778',
    wallTop: '#141018', wallTopHi: '#1d1823', wallFace: '#4a4157', wallHi: '#625675', mortar: '#2e2837',
  },
  {
    name: 'Les Grottes', flagstones: false, torches: false,
    floor: '#212d27', floorAlt: '#25332c', grout: '#1a231e', speck: '#2f4238', decoA: '#6fae5f', decoB: '#4c8a49',
    wallTop: '#0d1410', wallTopHi: '#142019', wallFace: '#3b5245', wallHi: '#557560', mortar: '#26352d',
  },
  {
    name: 'Les Forges', flagstones: true, torches: true,
    floor: '#33251f', floorAlt: '#382922', grout: '#261a15', speck: '#46322a', decoA: '#f08a3c', decoB: '#b8501f',
    wallTop: '#160d0b', wallTopHi: '#211411', wallFace: '#5c3a2d', wallHi: '#7b4c3a', mortar: '#351f18',
  },
  {
    name: 'Le Repaire du Wyrm', flagstones: true, torches: true,
    floor: '#2a1f2f', floorAlt: '#2f2236', grout: '#1f1724', speck: '#3c2c47', decoA: '#f7d154', decoB: '#b98a2c',
    wallTop: '#110b14', wallTopHi: '#1b121f', wallFace: '#4a2e50', wallHi: '#68436f', mortar: '#2a1a2e',
  },
];

const themeFor = (floor) => (floor >= MAX_FLOOR ? 3 : floor >= 7 ? 2 : floor >= 4 ? 1 : 0);

// `the` is the name with its article, as used in log sentences ("Le rat te mord").
const MONSTERS = {
  rat: {
    the: 'le rat', spr: 'rat', hp: 4, atk: 2, def: 0, xp: 1, speed: 10,
    floors: [1, 3], weight: 10, verb: 'te mord', blood: '#b8323c',
  },
  bat: {
    the: 'la chauve-souris', spr: 'bat', hp: 3, atk: 3, def: 0, xp: 2, speed: 15, erratic: 0.5, awake: true,
    floors: [1, 4], weight: 7, verb: 'te mord', blood: '#b8323c',
  },
  goblin: {
    the: 'le gobelin', spr: 'goblin', hp: 6, atk: 3, def: 1, xp: 3, speed: 10,
    floors: [1, 5], weight: 9, verb: 'te frappe', blood: '#5d9a3e',
  },
  slime: {
    the: 'la gelée', spr: 'slime', hp: 12, atk: 4, def: 0, xp: 3, speed: 5,
    floors: [2, 6], weight: 6, verb: 't’englue', blood: '#79c26a',
  },
  skeleton: {
    the: 'le squelette', spr: 'skeleton', hp: 9, atk: 5, def: 1, xp: 5, speed: 10, kite: true,
    floors: [3, 7], weight: 6, verb: 'te frappe', blood: '#e6dcc4',
    ranged: { range: 5, cd: 2, verb: 'te décoche une flèche', color: '#e6dcc4' },
  },
  wolf: {
    the: 'le loup', spr: 'wolf', hp: 10, atk: 5, def: 1, xp: 5, speed: 20, awake: true,
    floors: [4, 7], weight: 6, verb: 'te mord', blood: '#b8323c',
  },
  orc: {
    the: 'l’orc', spr: 'orc', hp: 18, atk: 8, def: 3, xp: 8, speed: 10,
    floors: [5, 9], weight: 7, verb: 'te cogne', blood: '#b8323c',
  },
  ghost: {
    the: 'le spectre', spr: 'ghost', hp: 14, atk: 7, def: 3, xp: 9, speed: 10, phase: true, awake: true,
    floors: [6, 9], weight: 5, verb: 'te glace les os', blood: '#9fe6f2',
  },
  troll: {
    the: 'le troll', spr: 'troll', hp: 30, atk: 10, def: 4, xp: 14, speed: 10, regen: 1,
    floors: [7, 10], weight: 5, verb: 't’écrase', blood: '#5d9a3e',
  },
  demon: {
    the: 'le démon', spr: 'demon', hp: 22, atk: 11, def: 4, xp: 14, speed: 10, kite: true,
    floors: [8, 10], weight: 5, verb: 'te griffe', blood: '#f2a03d',
    ranged: { range: 6, cd: 3, verb: 'te lance une boule de feu', color: '#ff8a3d' },
  },
  mimic: {
    the: 'la mimique', spr: 'mimic', hp: 16, atk: 6, def: 2, xp: 8, speed: 10,
    floors: [1, 10], weight: 0, verb: 'te dévore à moitié', blood: '#b8323c',
  },
  wyrm: {
    the: 'le Wyrm', name: 'Vorgath, le Wyrm', spr: 'wyrm', hp: 220, atk: 18, def: 8, xp: 0, speed: 10,
    boss: true, awake: true, floors: [10, 10], weight: 0, verb: 'te déchire', blood: '#f2a03d',
    ranged: { range: 7, cd: 3, mult: 1.4, verb: 'crache un torrent de flammes', color: '#ffb347' },
  },
};

const CONSUMABLES = {
  potion: { name: 'Potion de soin', spr: 'potion', weight: 22, desc: 'Rend 40 % de tes PV max.' },
  elixirStr: { name: 'Élixir de force', spr: 'elixirStr', weight: 5, desc: '+1 en attaque, pour toujours.' },
  elixirVit: { name: 'Élixir de vigueur', spr: 'elixirVit', weight: 6, desc: '+6 PV max, pour toujours.' },
  scrollFire: { name: 'Parchemin de feu', spr: 'scrollFire', weight: 7, desc: 'Brûle tous les ennemis en vue.' },
  scrollTele: { name: 'Parchemin de téléportation', spr: 'scrollTele', weight: 8, desc: 'T’envoie ailleurs sur l’étage, au hasard.' },
  scrollMap: { name: 'Parchemin de clairvoyance', spr: 'scrollMap', weight: 7, desc: 'Révèle tout le plan de l’étage.' },
};
const INV_ORDER = Object.keys(CONSUMABLES);
const STACK_MAX = 9;

const WEAPONS = [
  { name: 'Dague', atk: 1, spr: 'dagger' },
  { name: 'Épée courte', atk: 2, spr: 'shortsword' },
  { name: 'Épée longue', atk: 4, spr: 'longsword' },
  { name: 'Hache de guerre', atk: 5, spr: 'axe' },
  { name: 'Lame runique', atk: 7, spr: 'runeblade' },
];

const ARMORS = [
  { name: 'Armure de cuir', def: 1, spr: 'armor0' },
  { name: 'Cotte de mailles', def: 2, spr: 'armor1' },
  { name: 'Armure d’écailles', def: 3, spr: 'armor2' },
  { name: 'Armure de plates', def: 4, spr: 'armor3' },
  { name: 'Armure runique', def: 6, spr: 'armor4' },
];

// Item ids: consumable keys, 'gold', 'chest', 'weapon:<tier>', 'armor:<tier>'.
function itemDef(id) {
  if (CONSUMABLES[id]) return CONSUMABLES[id];
  if (id === 'gold') return { name: 'Pièces d’or', spr: 'gold' };
  if (id === 'chest') return { name: 'Coffre', spr: 'chest' };
  const [kind, tier] = id.split(':');
  if (kind === 'weapon') return { ...WEAPONS[+tier], kind, tier: +tier };
  if (kind === 'armor') return { ...ARMORS[+tier], kind, tier: +tier };
  return { name: '?', spr: 'gold' };
}

const xpNext = (lvl) => 4 + lvl * lvl * 3;
