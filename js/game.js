'use strict';

const SAVE_KEY = 'abysses.save.v1';
const SCORES_KEY = 'abysses.scores.v1';
const SAVE_VERSION = 1;

// The whole run lives in S (plain data, saved after each turn). `visible` is recomputed, never saved.
let S = null;
let visible = new Uint8Array(MAP_W * MAP_H);
let dmap = null; // distances from the player, used by monsters to chase

const idx = (x, y) => y * MAP_W + x;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
const tileAt = (x, y) => (inBounds(x, y) ? S.tiles[idx(x, y)] : T_WALL);
const walkable = (x, y) => tileAt(x, y) !== T_WALL;
const isVisible = (x, y) => inBounds(x, y) && visible[idx(x, y)] === 1;
const monsterAt = (x, y) => S.monsters.find((m) => m.x === x && m.y === y);
const itemAt = (x, y) => S.items.find((it) => it.x === x && it.y === y);
const visibleMonsters = () => S.monsters.filter((m) => isVisible(m.x, m.y));
const onStairs = () => !!S.stairs && S.player.x === S.stairs.x && S.player.y === S.stairs.y;
const playerAtk = () => S.player.atk + (S.player.weapon >= 0 ? WEAPONS[S.player.weapon].atk : 0);
const playerDef = () => S.player.def + (S.player.armor >= 0 ? ARMORS[S.player.armor].def : 0);
const isOver = () => !S || S.dead || S.won;

function calcDamage(atk, def) {
  const base = (atk * atk) / (atk + def);
  return Math.max(1, Math.round(base * (0.8 + Math.random() * 0.4)));
}

function log(text, kind = '') {
  S.log.push({ text, kind, turn: S.turn });
  if (S.log.length > 30) S.log.splice(0, S.log.length - 30);
  Bus.emit('log');
}

// ---- Run and floor setup -------------------------------------------------------------------

function newRun() {
  S = {
    v: SAVE_VERSION, floor: 0, deepest: 0, turn: 0, theme: 0, nextId: 1,
    tiles: null, explored: null, deco: null, stairs: null,
    player: {
      id: 0, x: 0, y: 0, hp: 24, maxHp: 24, atk: 3, def: 1, lvl: 1, xp: 0,
      gold: 0, weapon: 0, armor: -1, kills: 0, regen: 0,
    },
    inv: { potion: 1 }, monsters: [], items: [], log: [],
    bossSeen: false, dead: false, won: false, cause: '',
  };
  log('Tu t’enfonces dans les Abysses. Trouve l’escalier qui descend.', 'info');
  descend();
}

function descend() {
  S.floor += 1;
  S.deepest = Math.max(S.deepest, S.floor);
  S.theme = themeFor(S.floor);
  const L = S.floor === MAX_FLOOR ? genArena() : S.theme === 1 ? genCaves() : genRooms();
  S.tiles = L.tiles;
  S.deco = L.deco;
  S.stairs = L.stairs;
  S.explored = new Uint8Array(MAP_W * MAP_H);
  S.player.x = L.start.x;
  S.player.y = L.start.y;
  S.monsters = [];
  S.items = [];
  visible.fill(0);
  populate(L);
  updateFov();
  Bus.emit('floor');
  if (S.floor === MAX_FLOOR) log('Une chaleur écrasante monte des profondeurs…', 'warn');
  else if (S.floor > 1) log(`Tu descends à l’étage ${S.floor}.`);
}

function populate(L) {
  const f = S.floor;
  if (f === MAX_FLOOR) {
    spawnMonster('wyrm', L.boss.x, L.boss.y);
    dropItem('potion', L.start.x - 2, L.start.y - 1);
    dropItem('potion', L.start.x + 2, L.start.y - 1);
    return;
  }
  const monsters = 3 + Math.floor(f * 1.4) + rand(3);
  for (let i = 0; i < monsters; i++) {
    const pos = freeSpot(7);
    if (pos) spawnMonster(pickMonsterType(f), pos.x, pos.y);
  }
  const items = 3 + rand(3);
  for (let i = 0; i < items; i++) {
    const pos = freeSpot(2);
    if (pos) dropItem(randomItemId(f), pos.x, pos.y);
  }
  if (f === 1) {
    const pos = freeSpot(3);
    if (pos) dropItem('armor:0', pos.x, pos.y);
  }
  const piles = 2 + rand(3);
  for (let i = 0; i < piles; i++) {
    const pos = freeSpot(2);
    if (pos) dropItem('gold', pos.x, pos.y, randInt(3, 8) + f * 3);
  }
  if (chance(0.65)) {
    const pos = freeSpot(4, true);
    if (pos) S.items.push({ id: 'chest', x: pos.x, y: pos.y, n: 1, seen: 0, mimic: f >= 3 && chance(0.2) });
  }
}

function freeSpot(minDist, open = false) {
  const p = S.player;
  for (let tries = 0; tries < 500; tries++) {
    const x = randInt(1, MAP_W - 2), y = randInt(1, MAP_H - 2);
    if (tileAt(x, y) !== T_FLOOR) continue;
    if (cheb(x, y, p.x, p.y) < minDist) continue;
    if (monsterAt(x, y) || itemAt(x, y)) continue;
    if (open && DIRS8.filter(([dx, dy]) => walkable(x + dx, y + dy)).length < 7) continue;
    return { x, y };
  }
  return null;
}

function pickMonsterType(f) {
  const pool = Object.entries(MONSTERS)
    .filter(([, d]) => d.weight && d.floors[0] <= f && f <= d.floors[1])
    .map(([key, d]) => [key, d.weight]);
  return pickWeighted(pool);
}

const gearTier = (f) => clamp(Math.floor((f - 1) / 2 + Math.random() * 1.6 - 0.4), 0, 4);

function randomItemId(f) {
  const kind = pickWeighted([...INV_ORDER.map((k) => [k, CONSUMABLES[k].weight]), ['weapon', 9], ['armor', 9]]);
  return kind === 'weapon' || kind === 'armor' ? `${kind}:${gearTier(f)}` : kind;
}

function spawnMonster(type, x, y, opts = {}) {
  const d = MONSTERS[type];
  const lvl = Math.max(0, S.floor - d.floors[0]);
  const hp = Math.round(d.hp * (1 + 0.15 * lvl));
  const m = {
    id: S.nextId++, type, x, y, hp, maxHp: hp,
    atk: d.atk + Math.floor(lvl / 2), def: d.def + Math.floor(lvl / 3), xp: d.xp + lvl,
    energy: rand(10), asleep: opts.asleep ?? (!d.awake && chance(0.5)), hunting: !!opts.hunting, lost: 0, cd: 0,
  };
  S.monsters.push(m);
  return m;
}

// Drops on the nearest free floor tile around (x, y).
function dropItem(id, x, y, n = 1) {
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (tileAt(nx, ny) !== T_FLOOR || itemAt(nx, ny)) continue;
        const it = { id, x: nx, y: ny, n, seen: isVisible(nx, ny) ? 1 : 0 };
        S.items.push(it);
        return it;
      }
    }
  }
  return null;
}

function updateFov() {
  visible.fill(0);
  const p = S.player;
  shadowcast(p.x, p.y, FOV_RADIUS, (x, y) => tileAt(x, y) === T_WALL, (x, y) => {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    visible[i] = 1;
    S.explored[i] = 1;
  });
  for (const it of S.items) if (!it.seen && isVisible(it.x, it.y)) it.seen = 1;
  checkBoss();
}

function checkBoss() {
  if (S.bossSeen) return;
  if (S.monsters.some((m) => MONSTERS[m.type].boss && isVisible(m.x, m.y))) {
    S.bossSeen = true;
    log('Vorgath, le Wyrm des Abysses, déploie ses ailes !', 'warn');
    Bus.emit('boss');
  }
}

// ---- Player actions (each returns true when it used up the turn) -----------------------------

function playerMove(dx, dy) {
  if (isOver()) return false;
  const p = S.player, nx = p.x + dx, ny = p.y + dy;
  const m = monsterAt(nx, ny);
  if (m) {
    playerAttack(m);
    endTurn();
    return true;
  }
  const it = itemAt(nx, ny);
  if (it && it.id === 'chest') {
    openChest(it);
    endTurn();
    return true;
  }
  if (!walkable(nx, ny)) return false;
  p.x = nx;
  p.y = ny;
  Bus.emit('move', p);
  pickUp();
  if (onStairs()) log('Un escalier s’enfonce dans le noir.', 'info');
  endTurn();
  return true;
}

function waitTurn() {
  if (isOver()) return false;
  endTurn();
  return true;
}

function playerDescend() {
  if (isOver() || !onStairs()) return false;
  Bus.emit('descend');
  descend();
  return true;
}

function playerAttack(m) {
  const d = MONSTERS[m.type];
  let dmg = calcDamage(playerAtk(), m.def);
  let note = '';
  if (m.asleep) {
    dmg *= 2;
    note = ' Attaque sournoise !';
  } else if (chance(0.1)) {
    dmg = Math.ceil(dmg * 1.5);
    note = ' Coup critique !';
  }
  m.hp -= dmg;
  m.asleep = false;
  m.hunting = true;
  Bus.emit('attack', S.player, m);
  Bus.emit('damage', m, dmg, note ? 'crit' : 'hit', d.blood);
  if (m.hp <= 0) killMonster(m, dmg, note);
  else log(`Tu frappes ${d.the} (${dmg}).${note}`);
}

function killMonster(m, dmg, note) {
  const d = MONSTERS[m.type];
  S.monsters = S.monsters.filter((o) => o !== m);
  S.player.kills += 1;
  log(`Tu terrasses ${d.the} (${dmg}).${note}`, 'good');
  Bus.emit('kill', m, d);
  if (d.boss) {
    win();
    return;
  }
  if (chance(0.3)) dropItem('gold', m.x, m.y, randInt(2, 6) + S.floor * 2);
  else if (chance(0.1)) dropItem(randomItemId(S.floor), m.x, m.y);
  gainXp(m.xp);
}

function gainXp(n) {
  const p = S.player;
  p.xp += n;
  while (p.xp >= xpNext(p.lvl)) {
    p.xp -= xpNext(p.lvl);
    p.lvl += 1;
    p.maxHp += 5;
    p.hp = Math.min(p.maxHp, p.hp + 5 + Math.ceil(p.maxHp * 0.2));
    p.atk += 1;
    if (p.lvl % 2 === 0) p.def += 1;
    log(`Niveau ${p.lvl} ! Ta puissance grandit.`, 'gold');
    Bus.emit('levelup');
  }
}

function openChest(it) {
  S.items = S.items.filter((o) => o !== it);
  if (it.mimic) {
    const m = spawnMonster('mimic', it.x, it.y, { asleep: false, hunting: true });
    log('Le coffre ouvre une gueule pleine de crocs : une mimique !', 'bad');
    Bus.emit('mimic', m);
    return;
  }
  log('Tu ouvres le coffre.', 'good');
  Bus.emit('chest', it);
  dropItem(randomItemId(S.floor + 1), it.x, it.y);
  if (chance(0.6)) dropItem('gold', it.x, it.y, randInt(8, 16) + S.floor * 4);
  if (chance(0.35)) dropItem(randomItemId(S.floor + 1), it.x, it.y);
}

function pickUp() {
  const p = S.player;
  const it = itemAt(p.x, p.y);
  if (!it) return;
  const def = itemDef(it.id);
  if (it.id === 'gold') {
    p.gold += it.n;
    log(`+${it.n} pièces d’or.`, 'gold');
  } else if (def.kind === 'weapon' || def.kind === 'armor') {
    const slot = def.kind === 'weapon' ? 'weapon' : 'armor';
    const bonus = def.kind === 'weapon' ? `+${def.atk} ATQ` : `+${def.def} DEF`;
    if (def.tier > p[slot]) {
      p[slot] = def.tier;
      log(`Tu t’équipes : ${def.name} (${bonus}).`, 'good');
    } else {
      const g = 3 + def.tier * 4;
      p.gold += g;
      log(`${def.name} : tu as déjà mieux. Tu en tires ${g} or.`);
    }
  } else {
    if ((S.inv[it.id] || 0) >= STACK_MAX) {
      log(`Ta besace est pleine : ${def.name} reste au sol.`);
      return;
    }
    S.inv[it.id] = (S.inv[it.id] || 0) + 1;
    log(`Tu ramasses : ${def.name}.`, 'good');
  }
  S.items = S.items.filter((o) => o !== it);
  Bus.emit('pickup', it);
}

function useItem(id) {
  if (isOver() || !S.inv[id]) return false;
  const p = S.player;
  switch (id) {
    case 'potion': {
      if (p.hp >= p.maxHp) {
        log('Tu es déjà en pleine santé.');
        return false;
      }
      const got = Math.min(Math.max(8, Math.ceil(p.maxHp * 0.4)), p.maxHp - p.hp);
      p.hp += got;
      log(`Tu bois la potion : +${got} PV.`, 'good');
      Bus.emit('heal', got);
      break;
    }
    case 'elixirStr':
      p.atk += 1;
      log('La force afflue dans tes bras : +1 ATQ.', 'good');
      Bus.emit('buff');
      break;
    case 'elixirVit':
      p.maxHp += 6;
      p.hp += 6;
      log('Ton cœur bat plus fort : +6 PV max.', 'good');
      Bus.emit('heal', 6);
      break;
    case 'scrollFire': {
      const targets = visibleMonsters();
      if (!targets.length) {
        log('Aucun ennemi en vue : tu gardes le parchemin.');
        return false;
      }
      log('Le parchemin s’embrase ! Les flammes déferlent.', 'warn');
      Bus.emit('fire', targets);
      const dmg = 8 + S.floor * 2;
      for (const m of targets) {
        m.hp -= dmg;
        m.asleep = false;
        m.hunting = true;
        Bus.emit('damage', m, dmg, 'fire', '#ff8a3d');
        if (m.hp <= 0) killMonster(m, dmg, '');
        else log(`Les flammes brûlent ${MONSTERS[m.type].the} (${dmg}).`);
      }
      break;
    }
    case 'scrollTele': {
      const from = { x: p.x, y: p.y };
      const pos = freeSpot(10) || freeSpot(3);
      if (pos) {
        p.x = pos.x;
        p.y = pos.y;
      }
      log('L’espace se plie autour de toi…', 'info');
      Bus.emit('teleport', from);
      pickUp();
      break;
    }
    case 'scrollMap':
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          if (DIRS8.some(([dx, dy]) => walkable(x + dx, y + dy)) || walkable(x, y)) S.explored[idx(x, y)] = 1;
        }
      }
      log('Le plan de l’étage se grave dans ton esprit.', 'info');
      Bus.emit('reveal');
      break;
    default:
      return false;
  }
  S.inv[id] -= 1;
  endTurn();
  return true;
}

// ---- Turn resolution -------------------------------------------------------------------------

function endTurn() {
  S.turn += 1;
  updateFov();
  if (!isOver()) monstersTurn();
  if (!isOver()) {
    const p = S.player;
    p.regen += p.maxHp / 180;
    while (p.regen >= 1) {
      p.regen -= 1;
      if (p.hp < p.maxHp) p.hp += 1;
    }
    if (S.floor < MAX_FLOOR && chance(1 / 140)) wanderingMonster();
    checkBoss();
  }
  Bus.emit('turn');
}

function monstersTurn() {
  const p = S.player;
  dmap = bfs(p.x, p.y, walkable, 30);
  for (const m of S.monsters.slice()) {
    if (m.hp <= 0) continue;
    const d = MONSTERS[m.type];
    if (d.regen && !m.asleep && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + d.regen);
    m.energy += d.speed;
    while (m.energy >= 10) {
      m.energy -= 10;
      monsterAct(m, d);
      if (S.dead) return;
    }
  }
}

function monsterAct(m, d) {
  const p = S.player;
  const seen = isVisible(m.x, m.y);
  const dist = cheb(m.x, m.y, p.x, p.y);
  if (m.asleep) {
    if (seen && dist <= 6 && chance(dist <= 2 ? 0.5 : 0.15)) {
      m.asleep = false;
      m.hunting = true;
      Bus.emit('alert', m);
    }
    return;
  }
  if (seen) {
    if (!m.hunting) Bus.emit('alert', m);
    m.hunting = true;
    m.lost = 0;
  } else if (m.hunting && ++m.lost > 25) {
    m.hunting = false;
  }
  if (m.cd > 0) m.cd -= 1;

  if (dist === 1) return monsterMelee(m, d);
  const inRange = d.ranged && seen && dist <= d.ranged.range && clearShot(m.x, m.y, p.x, p.y);
  if (inRange && m.cd === 0) return monsterRanged(m, d);
  if (inRange && d.kite) return; // archers hold their ground while reloading
  if (d.erratic && chance(d.erratic)) return randomStep(m, d);
  if (m.hunting) return stepToward(m, d);
  if (chance(0.25)) randomStep(m, d);
}

function clearShot(x0, y0, x1, y1) {
  const pts = bresenham(x0, y0, x1, y1);
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    if (!walkable(x, y) || monsterAt(x, y)) return false;
  }
  return true;
}

function canEnter(x, y, d) {
  if (d.phase ? x < 1 || y < 1 || x > MAP_W - 2 || y > MAP_H - 2 : !walkable(x, y)) return false;
  if (x === S.player.x && y === S.player.y) return false;
  if (monsterAt(x, y)) return false;
  const it = itemAt(x, y);
  return !(it && it.id === 'chest');
}

function moveMonster(m, x, y) {
  m.x = x;
  m.y = y;
  Bus.emit('move', m);
}

function randomStep(m, d) {
  for (const [dx, dy] of shuffle(DIRS8.slice())) {
    if (canEnter(m.x + dx, m.y + dy, d)) return moveMonster(m, m.x + dx, m.y + dy);
  }
}

function stepToward(m, d) {
  const p = S.player;
  const here = dmap[idx(m.x, m.y)];
  const greedy = d.phase || here < 0;
  const score = (x, y) => (greedy ? Math.hypot(x - p.x, y - p.y) : dmap[idx(x, y)]);
  const current = score(m.x, m.y);
  let best = [], bestScore = Infinity;
  for (const [dx, dy] of DIRS8) {
    const nx = m.x + dx, ny = m.y + dy;
    if (!canEnter(nx, ny, d)) continue;
    const s = score(nx, ny);
    if (s < 0) continue;
    if (s < bestScore - 1e-6) { bestScore = s; best = [[nx, ny]]; }
    else if (Math.abs(s - bestScore) < 1e-6) best.push([nx, ny]);
  }
  // an equal score lets a blocked monster slide around its allies
  if (best.length && bestScore <= current) {
    const [nx, ny] = pick(best);
    moveMonster(m, nx, ny);
  }
}

function monsterMelee(m, d) {
  const dmg = calcDamage(m.atk, playerDef());
  Bus.emit('attack', m, S.player);
  hurtPlayer(dmg, `${cap(d.the)} ${d.verb} (${dmg}).`, d);
}

function monsterRanged(m, d) {
  const r = d.ranged;
  m.cd = r.cd;
  const dmg = calcDamage(Math.round(m.atk * (r.mult || 1)), playerDef());
  Bus.emit('shot', m, S.player, r.color);
  hurtPlayer(dmg, `${cap(d.the)} ${r.verb} (${dmg}).`, d);
}

function hurtPlayer(dmg, message, d) {
  const p = S.player;
  p.hp -= dmg;
  log(message, 'bad');
  Bus.emit('damage', p, dmg, 'hurt', '#d8454f');
  if (p.hp <= 0) {
    p.hp = 0;
    S.dead = true;
    S.cause = d.the;
    log('Tu t’effondres sur les dalles froides…', 'bad');
    Bus.emit('death');
  }
}

function wanderingMonster() {
  for (let i = 0; i < 20; i++) {
    const pos = freeSpot(10);
    if (pos && !isVisible(pos.x, pos.y)) {
      spawnMonster(pickMonsterType(S.floor), pos.x, pos.y, { asleep: false });
      return;
    }
  }
}

function win() {
  S.won = true;
  log('Le Wyrm s’effondre dans un fracas de tonnerre. Les Abysses sont vaincues !', 'gold');
  Bus.emit('victory');
}

// ---- Score, save, load ---------------------------------------------------------------------

function computeScore() {
  const p = S.player;
  const parts = [
    ['Or amassé', p.gold],
    [`Profondeur (${S.deepest} × 100)`, S.deepest * 100],
    [`Ennemis vaincus (${p.kills} × 10)`, p.kills * 10],
  ];
  if (S.won) parts.push(['Victoire sur le Wyrm', 2000]);
  return { parts, total: parts.reduce((sum, [, v]) => sum + v, 0) };
}

function recordScore() {
  const score = computeScore();
  const p = S.player;
  const entry = {
    score: score.total, floor: S.deepest, lvl: p.lvl, kills: p.kills,
    won: S.won, cause: S.cause, date: new Date().toISOString().slice(0, 10),
  };
  const list = store.get(SCORES_KEY, []);
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, 8);
  store.set(SCORES_KEY, top);
  return { score, rank: top.indexOf(entry) };
}

const B64 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
function encodeBytes(arr) {
  let s = '';
  for (let i = 0; i < arr.length; i++) s += B64[arr[i]];
  return s;
}
function decodeBytes(str) {
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = B64.indexOf(str[i]);
  return arr;
}

function saveGame() {
  if (isOver()) return;
  store.set(SAVE_KEY, {
    ...S,
    tiles: encodeBytes(S.tiles),
    explored: encodeBytes(S.explored),
    deco: encodeBytes(S.deco),
    log: S.log.slice(-6),
  });
}

function peekSave() {
  const o = store.get(SAVE_KEY, null);
  return o && o.v === SAVE_VERSION && !o.dead && !o.won ? { floor: o.floor, lvl: o.player.lvl } : null;
}

function loadGame() {
  const o = store.get(SAVE_KEY, null);
  if (!o || o.v !== SAVE_VERSION) return false;
  try {
    o.tiles = decodeBytes(o.tiles);
    o.explored = decodeBytes(o.explored);
    o.deco = decodeBytes(o.deco);
    if (o.tiles.length !== MAP_W * MAP_H) return false;
    S = o;
    visible = new Uint8Array(MAP_W * MAP_H);
    updateFov();
    Bus.emit('floor');
    log('Tu reprends ta descente.', 'info');
    return true;
  } catch {
    return false;
  }
}

function clearSave() {
  store.remove(SAVE_KEY);
}
