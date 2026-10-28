'use strict';

// ---- Run structure ----------------------------------------------------------------------------
// Three biomes of six chambers: four fights, a rest stop (fountain and merchant), then a boss.
const ROOMS_PER_BIOME = 6;
const REST_STEP = 4;
const BOSS_STEP = 5;

const BIOMES = [
  {
    name: 'Les Cryptes',
    enemies: [['wretch', 10], ['bat', 6], ['archer', 5], ['slime', 4]],
    boss: 'sentinel',
    floor: 'crypt',
    fog: 0x120b16, light: 0xffd2a8, sky: 0x6b5a8c, ground: 0x2a1410, accent: 0xff8a3a, abyss: '#4a0f22',
  },
  {
    name: 'Les Grottes',
    enemies: [['wretch', 6], ['bat', 6], ['slime', 6], ['wraith', 6], ['archer', 5], ['brute', 4]],
    boss: 'troll',
    floor: 'cave',
    fog: 0x07141a, light: 0xc8f0ff, sky: 0x3c7a8c, ground: 0x0e1c14, accent: 0x5fe0ff, abyss: '#0d3a3f',
  },
  {
    name: 'Les Forges',
    enemies: [['brute', 6], ['imp', 6], ['wraith', 5], ['archer', 5], ['wretch', 5]],
    boss: 'wyrm',
    floor: 'forge',
    fog: 0x1a0805, light: 0xffc08a, sky: 0x8a3a20, ground: 0x2a0a04, accent: 0xff5a1a, abyss: '#7a1e05',
  },
];
const TOTAL_ROOMS = BIOMES.length * ROOMS_PER_BIOME;

// ---- Hero and weapons -------------------------------------------------------------------------

const HERO = { hp: 60, speed: 6.6, radius: 0.45, dashDist: 4.4, dashTime: 0.16, dashRegen: 0.55, iframes: 0.55 };

const WEAPONS = {
  sword: {
    name: 'Lame des Abysses',
    desc: 'Trois coups enchaînés, tourbillon en spécial.',
    combo: [
      { dmg: 20, range: 2.3, arc: 2.0, lunge: 3.2, windup: 0.07, active: 0.1, recover: 0.17 },
      { dmg: 20, range: 2.3, arc: 2.0, lunge: 3.2, windup: 0.07, active: 0.1, recover: 0.17 },
      { dmg: 34, range: 2.8, arc: 1.3, lunge: 6.5, windup: 0.13, active: 0.12, recover: 0.3 },
    ],
    dashStrike: { dmg: 30, range: 2.6, arc: 1.6, lunge: 7 },
    special: { dmg: 30, radius: 2.7, windup: 0.16, recover: 0.28, knock: 7 },
  },
  bow: {
    name: 'Arc des Échos',
    desc: 'Tir rapide à distance. Maintiens pour une flèche chargée qui transperce.',
    shot: { dmg: 16, speed: 26, cooldown: 0.3, range: 15 },
    charged: { dmg: 46, speed: 34, time: 0.5 },
    special: { dmg: 13, count: 5, spread: 0.85, speed: 22, recover: 0.38 },
    cost: 40,
  },
};

const CAST = { dmg: 40, speed: 22, range: 11, recover: 0.2, returnAfter: 9 };

// ---- Enemies ---------------------------------------------------------------------------------
// ai: behaviour routine in game.js. Bosses use their own routines.

const ENEMIES = {
  wretch: {
    name: 'Rôdeur', ai: 'melee', hp: 40, speed: 3.6, radius: 0.5, dmg: 8,
    reach: 1.7, arc: 1.4, windup: 0.55, lunge: 7, cooldown: 1.1, color: 0x6b7a5a,
  },
  bat: {
    name: 'Chauve-souris', ai: 'swoop', hp: 18, speed: 5, radius: 0.38, dmg: 6, cooldown: 1.6, flying: true, color: 0x5b3a85,
  },
  archer: {
    name: 'Archer squelette', ai: 'archer', hp: 30, speed: 2.8, radius: 0.45, dmg: 8,
    aim: 0.9, cooldown: 2.5, projSpeed: 13, color: 0xe6dcc4,
  },
  slime: {
    name: 'Gelée', ai: 'hopper', hp: 52, speed: 3, radius: 0.6, dmg: 7, cooldown: 1.1, split: 'slimelet', color: 0x79c26a,
  },
  slimelet: {
    name: 'Gelée', ai: 'hopper', hp: 18, speed: 3.6, radius: 0.38, dmg: 5, cooldown: 0.9, color: 0x9be37a,
  },
  wraith: {
    name: 'Spectre', ai: 'wraith', hp: 46, speed: 2.8, radius: 0.48, dmg: 10, cooldown: 3.2, flying: true, color: 0x7fe0d0,
  },
  brute: {
    name: 'Brute', ai: 'slam', hp: 130, speed: 2.5, radius: 0.85, dmg: 16,
    windup: 0.95, slamRadius: 2.4, cooldown: 2.2, heavy: true, color: 0x8a4a32,
  },
  imp: {
    name: 'Démon', ai: 'caster', hp: 70, speed: 3, radius: 0.5, dmg: 8, cooldown: 3.1, color: 0xd8454f,
  },
  sentinel: {
    name: 'La Sentinelle', title: 'Gardienne des Cryptes', ai: 'sentinel', hp: 1100, speed: 2.8, radius: 1.15, dmg: 12,
    boss: true, heavy: true, color: 0xcfc6b4, shards: 25,
  },
  troll: {
    name: 'Le Roi des cavernes', title: 'Seigneur des Grottes', ai: 'troll', hp: 1900, speed: 2.6, radius: 1.35, dmg: 16,
    boss: true, heavy: true, color: 0x6f8f7c, shards: 40,
  },
  wyrm: {
    name: 'Vorgath, le Wyrm', title: 'Le cœur des Abysses', ai: 'wyrm', hp: 3000, speed: 2.2, radius: 1.9, dmg: 16,
    boss: true, heavy: true, color: 0xc8323f, shards: 60,
  },
};

// ---- Blessings ---------------------------------------------------------------------------------
// Six Ancients, each offering one blessing per move (attack, special, dash, cast) and passives.

const ANCIENTS = {
  storm: { name: 'La Tempête', color: '#7cc4ff', glyph: 'bolt', line: 'Que la foudre guide ta lame.' },
  ember: { name: 'La Braise', color: '#ff7b39', glyph: 'flame', line: 'Réduis-les en cendres.' },
  frost: { name: 'Le Givre', color: '#a8f0ff', glyph: 'flake', line: 'Le froid n’oublie personne.' },
  tide: { name: 'La Marée', color: '#38d6b8', glyph: 'wave', line: 'Repousse-les jusqu’aux murs.' },
  shadow: { name: 'L’Ombre', color: '#b98cff', glyph: 'moon', line: 'Frappe là où ils ne regardent pas.' },
  wind: { name: 'Le Vent', color: '#a6ec7e', glyph: 'feather', line: 'Plus vite que la mort.' },
};

const SLOT_NAMES = { attack: 'Attaque', special: 'Spécial', dash: 'Esquive', cast: 'Éclat', passive: 'Passif' };

// `v` is the base value; rarity and levels scale it unless `fixed`. {v} in the text is replaced.
const BOONS = {
  storm_attack: { anc: 'storm', slot: 'attack', name: 'Frappe foudroyante', v: 10, text: 'Tes attaques lancent un éclair qui rebondit sur 2 ennemis proches ({v} dégâts).' },
  storm_special: { anc: 'storm', slot: 'special', name: 'Tonnerre', v: 30, text: 'Ton spécial fait tomber la foudre sur chaque ennemi touché ({v} dégâts).' },
  storm_dash: { anc: 'storm', slot: 'dash', name: 'Pas de l’orage', v: 26, text: 'Ton esquive foudroie l’ennemi le plus proche ({v} dégâts).' },
  storm_cast: { anc: 'storm', slot: 'cast', name: 'Éclat chargé', v: 55, text: 'Ton éclat éclate en arc électrique autour de l’impact ({v} dégâts).' },
  storm_passive: { anc: 'storm', slot: 'passive', name: 'Surtension', v: 30, text: 'Les éclairs infligent +{v} % de dégâts.' },

  ember_attack: { anc: 'ember', slot: 'attack', name: 'Lame ardente', v: 1, text: 'Tes attaques infligent {v} charge(s) de brûlure (3 dégâts par seconde chacune).' },
  ember_special: { anc: 'ember', slot: 'special', name: 'Embrasement', v: 7, text: 'Ton spécial fait exploser les brûlures : {v} dégâts par charge.' },
  ember_dash: { anc: 'ember', slot: 'dash', name: 'Sillage de cendres', v: 18, text: 'Ton esquive laisse une traînée de feu ({v} dégâts par seconde).' },
  ember_cast: { anc: 'ember', slot: 'cast', name: 'Bombe de braises', v: 22, text: 'Ton éclat embrase le sol pendant 3 s ({v} dégâts par seconde).' },
  ember_passive: { anc: 'ember', slot: 'passive', name: 'Combustion', v: 40, text: 'La brûlure inflige +{v} % de dégâts.' },

  frost_attack: { anc: 'frost', slot: 'attack', name: 'Morsure du givre', v: 14, text: 'Tes attaques glacent : -{v} % de vitesse par charge. À 4 charges, l’ennemi gèle.' },
  frost_special: { anc: 'frost', slot: 'special', name: 'Éclat polaire', v: 60, text: 'Ton spécial inflige +{v} % de dégâts aux ennemis glacés.' },
  frost_dash: { anc: 'frost', slot: 'dash', name: 'Souffle boréal', v: 2, text: 'Ton esquive libère une onde de froid : {v} charges de givre autour de toi.' },
  frost_cast: { anc: 'frost', slot: 'cast', name: 'Prison de glace', v: 1.6, text: 'Ton éclat gèle sa cible pendant {v} s.' },
  frost_passive: { anc: 'frost', slot: 'passive', name: 'Bris', v: 40, text: 'Les ennemis glacés éclatent en mourant ({v} dégâts autour).' },

  tide_attack: { anc: 'tide', slot: 'attack', name: 'Ressac', v: 8, text: 'Tes attaques repoussent et éclaboussent autour de la cible ({v} dégâts).' },
  tide_special: { anc: 'tide', slot: 'special', name: 'Lame de fond', v: 40, text: 'Ton spécial repousse très loin et inflige +{v} % de dégâts.' },
  tide_dash: { anc: 'tide', slot: 'dash', name: 'Déferlante', v: 20, text: 'Ton esquive pousse une vague devant toi ({v} dégâts).' },
  tide_cast: { anc: 'tide', slot: 'cast', name: 'Geyser', v: 50, text: 'Ton éclat jaillit en geyser qui projette tout autour ({v} dégâts).' },
  tide_passive: { anc: 'tide', slot: 'passive', name: 'Écueil', v: 30, text: 'Un ennemi projeté contre un obstacle subit {v} dégâts.' },

  shadow_attack: { anc: 'shadow', slot: 'attack', name: 'Lame furtive', v: 15, text: 'Tes attaques ont {v} % de chances d’infliger un coup critique (×3).' },
  shadow_special: { anc: 'shadow', slot: 'special', name: 'Exécution', v: 25, text: 'Ton spécial a {v} % de chances d’infliger un coup critique.' },
  shadow_dash: { anc: 'shadow', slot: 'dash', name: 'Pas de l’ombre', v: 0.6, text: 'Pendant {v} s après une esquive, tous tes coups sont critiques.' },
  shadow_cast: { anc: 'shadow', slot: 'cast', name: 'Marque sombre', v: 35, text: 'Ton éclat marque sa cible : +{v} % de chances de critique contre elle.' },
  shadow_passive: { anc: 'shadow', slot: 'passive', name: 'Coup fatal', v: 50, text: 'Les coups critiques infligent +{v} % de dégâts.' },

  wind_attack: { anc: 'wind', slot: 'attack', name: 'Lame vive', v: 20, text: 'Tes attaques sont {v} % plus rapides.' },
  wind_special: { anc: 'wind', slot: 'special', name: 'Tourbillon', v: 25, text: 'Ton spécial est {v} % plus rapide et plus large.' },
  wind_dash: { anc: 'wind', slot: 'dash', name: 'Second souffle', v: 1, fixed: true, text: '+{v} charge d’esquive.' },
  wind_cast: { anc: 'wind', slot: 'cast', name: 'Écho', v: 1, fixed: true, text: '+{v} éclat : tu peux en lancer un de plus.' },
  wind_passive: { anc: 'wind', slot: 'passive', name: 'Pas léger', v: 15, text: '+{v} % de vitesse de déplacement.' },
  wind_dodge: { anc: 'wind', slot: 'passive', name: 'Insaisissable', v: 10, text: '{v} % de chances d’esquiver complètement un coup.' },
};

const RARITIES = [
  { name: 'Commune', mult: 1, color: '#d8d0c0' },
  { name: 'Rare', mult: 1.5, color: '#5ea8ff' },
  { name: 'Épique', mult: 2, color: '#c07cff' },
  { name: 'Héroïque', mult: 2.5, color: '#ff9b3a' },
];

// ---- Rewards and shop -------------------------------------------------------------------------

const REWARDS = {
  boon: { name: 'Bénédiction' },
  gold: { name: 'Bourse d’or', glyph: 'coin', color: '#f7c948' },
  heart: { name: 'Cœur de titan', glyph: 'heart', color: '#ff5d6c', text: '+15 PV max' },
  fruit: { name: 'Fruit d’ambre', glyph: 'fruit', color: '#ff9b3a', text: 'Renforce une bénédiction' },
  shard: { name: 'Éclats d’âme', glyph: 'shard', color: '#c9a8ff', text: 'Monnaie du Sanctuaire' },
  forge: { name: 'Enclume', glyph: 'anvil', color: '#ffd98a', text: '+15 % de dégâts d’attaque et de spécial' },
  rest: { name: 'Halte', glyph: 'fountain', color: '#7cd8ff' },
  boss: { name: 'Gardien', glyph: 'skull', color: '#ff4a3d' },
};

const SHOP_ITEMS = [
  { id: 'heal', name: 'Fiole de vie', text: 'Rend 35 % de tes PV.', cost: 30, glyph: 'heart', color: '#ff5d6c' },
  { id: 'heart', name: 'Cœur de titan', text: '+15 PV max.', cost: 80, glyph: 'heart', color: '#ffb0b8' },
  { id: 'fruit', name: 'Fruit d’ambre', text: 'Renforce une bénédiction.', cost: 70, glyph: 'fruit', color: '#ff9b3a' },
  { id: 'boon', name: 'Bénédiction', text: 'Choisis une bénédiction d’un Ancien au hasard.', cost: 120, glyph: 'star', color: '#ffd98a' },
  { id: 'defiance', name: 'Sursis', text: 'Reviens d’entre les morts une fois de plus.', cost: 150, glyph: 'ankh', color: '#ffd98a' },
];

// ---- Sanctuary (permanent upgrades) -------------------------------------------------------------

const UPGRADES = [
  { id: 'vitality', name: 'Vitalité', text: '+8 PV max', costs: [10, 20, 30, 45, 60] },
  { id: 'might', name: 'Puissance', text: '+6 % de dégâts', costs: [15, 25, 40, 55, 75] },
  { id: 'insight', name: 'Clairvoyance', text: '+4 % de chances de critique', costs: [20, 35, 50] },
  { id: 'reprieve', name: 'Sursis', text: 'Reviens une fois d’entre les morts avec 40 % de tes PV', costs: [40, 100] },
  { id: 'swift', name: 'Élan', text: '+1 charge d’esquive', costs: [60] },
  { id: 'echo', name: 'Second éclat', text: '+1 éclat à lancer', costs: [50] },
  { id: 'fortune', name: 'Fortune', text: '+25 or au départ', costs: [10, 20, 30] },
  { id: 'favor', name: 'Faveur', text: 'Bénédictions rares plus fréquentes', costs: [25, 45, 70] },
];
