'use strict';

const META_KEY = 'abysses.meta.v2';
const RUN_KEY = 'abysses.run.v2';
const RUN_VERSION = 2;

// Meta: permanent progression (saved). Run: the current descent (saved at each chamber).
// Ch: the live chamber simulation (never saved; a resumed run restarts its chamber).
let Meta = loadMeta();
let Run = null;
let Ch = null;

// ---- Persistence -------------------------------------------------------------------------------

function loadMeta() {
  const m = store.get(META_KEY, {}) || {};
  return {
    shards: 0, upgrades: {}, bow: false, weapon: 'sword', runs: 0, wins: 0, bestRoom: 0, kills: 0, ...m,
  };
}
const saveMeta = () => store.set(META_KEY, Meta);
const upgradeLevel = (id) => Meta.upgrades[id] || 0;

function saveRun() {
  if (Run) store.set(RUN_KEY, Run);
}
function clearRun() {
  store.remove(RUN_KEY);
}
function peekRun() {
  const r = store.get(RUN_KEY, null);
  return r && r.v === RUN_VERSION ? r : null;
}
function resumeRun() {
  const r = peekRun();
  if (!r) return false;
  Run = r;
  enterChamber();
  return true;
}

function buyUpgrade(id) {
  const def = UPGRADES.find((u) => u.id === id);
  const lvl = upgradeLevel(id), cost = def.costs[lvl];
  if (cost === undefined || Meta.shards < cost) return false;
  Meta.shards -= cost;
  Meta.upgrades[id] = lvl + 1;
  saveMeta();
  return true;
}

function unlockBow() {
  if (Meta.bow || Meta.shards < WEAPONS.bow.cost) return false;
  Meta.shards -= WEAPONS.bow.cost;
  Meta.bow = true;
  Meta.weapon = 'bow';
  saveMeta();
  return true;
}

// ---- Blessings -------------------------------------------------------------------------------------

function boonValue(b) {
  const def = BOONS[b.id];
  if (def.fixed) return def.v;
  const v = def.v * RARITIES[b.rarity].mult * (1 + 0.35 * (b.level - 1));
  return def.v < 3 && !Number.isInteger(def.v) ? Math.round(v * 10) / 10 : Math.round(v);
}
const ownedBoon = (id) => Run.boons.find((b) => b.id === id);
const boonVal = (id) => {
  const b = ownedBoon(id);
  return b ? boonValue(b) : 0;
};
const slotBoon = (slot) => Run.boons.find((b) => BOONS[b.id].slot === slot);
const boonText = (b) => BOONS[b.id].text.replace('{v}', boonValue(b));

function ancientsWithBoons(exclude = new Set()) {
  const owned = new Set(Run.boons.map((b) => b.id));
  return Object.keys(ANCIENTS).filter((a) => !exclude.has(a) && Object.keys(BOONS).some((id) => BOONS[id].anc === a && !owned.has(id)));
}

function rollRarity() {
  const f = upgradeLevel('favor'), r = Math.random();
  if (r < 0.02 + 0.01 * f) return 3;
  if (r < 0.11 + 0.04 * f) return 2;
  if (r < 0.38 + 0.08 * f) return 1;
  return 0;
}

function offerBoons(anc) {
  const owned = new Set(Run.boons.map((b) => b.id));
  const pool = shuffle(Object.keys(BOONS).filter((id) => BOONS[id].anc === anc && !owned.has(id)));
  return pool.slice(0, 3).map((id) => {
    const slot = BOONS[id].slot;
    return { id, rarity: BOONS[id].fixed ? 0 : rollRarity(), level: 1, replaces: slot !== 'passive' ? slotBoon(slot) : null };
  });
}

function addBoon(opt) {
  const slot = BOONS[opt.id].slot;
  if (slot !== 'passive') Run.boons = Run.boons.filter((b) => BOONS[b.id].slot !== slot);
  Run.boons.push({ id: opt.id, rarity: opt.rarity, level: 1 });
  refreshStats();
  Bus.emit('boon', opt);
}

function fruitOptions() {
  return shuffle(Run.boons.filter((b) => !BOONS[b.id].fixed)).slice(0, 3);
}

function levelBoon(b) {
  b.level += 1;
  refreshStats();
  Bus.emit('boon', b);
}

// ---- Run flow --------------------------------------------------------------------------------------

function startRun() {
  const maxHp = HERO.hp + 8 * upgradeLevel('vitality');
  Run = {
    v: RUN_VERSION, weapon: Meta.weapon === 'bow' && Meta.bow ? 'bow' : 'sword', room: 0,
    hp: maxHp, maxHp, gold: 25 * upgradeLevel('fortune'), boons: [], defiance: upgradeLevel('reprieve'), forge: 0,
    kills: 0, time: 0, shards: 0, reward: { type: 'boon', anc: pick(Object.keys(ANCIENTS)) },
  };
  enterChamber();
}

const combatIndex = () => Math.floor(Run.room / ROOMS_PER_BIOME) * REST_STEP + Math.min(Run.room % ROOMS_PER_BIOME, REST_STEP);

function enterChamber() {
  const biome = Math.floor(Run.room / ROOMS_PER_BIOME), step = Run.room % ROOMS_PER_BIOME;
  const kind = step === BOSS_STEP ? 'boss' : step === REST_STEP ? 'rest' : 'combat';
  const doorRewards = rollDoorRewards(Run.room + 1);
  const room = genRoom(biome, kind, doorRewards.length);
  room.doors.forEach((d, i) => (d.reward = doorRewards[i]));
  Ch = {
    room, kind, biome, step, t: 0, nextId: 1,
    enemies: [], projectiles: [], hazards: [], pickups: [], bolts: [],
    waves: kind === 'combat' ? planWaves(biome, combatIndex()) : [], waveIdx: 0, waveDelay: 1.1,
    cleared: kind === 'rest', rewardTaken: kind === 'rest', doorsOpen: kind === 'rest',
    hitstop: 0, lavaTick: 0, fountainUsed: false, nearMerchant: false, boss: null,
    shop: kind === 'rest' ? shuffle(SHOP_ITEMS.slice()).slice(0, 3).map((it) => ({ ...it, sold: false })) : null,
    over: false,
  };
  Ch.player = makePlayer();
  saveRun();
  Bus.emit('chamber');
  // the guardian appears once the chamber is built, so its model is not swept away with the last one
  if (kind === 'boss') Ch.boss = spawnEnemy(BIOMES[biome].boss, 0, -room.D / 2 + 4.5, { spawnT: 1.4 });
}

function rollDoorRewards(next) {
  if (next >= TOTAL_ROOMS) return [];
  const step = next % ROOMS_PER_BIOME;
  if (step === BOSS_STEP) return [{ type: 'boss' }];
  if (step === REST_STEP) return [{ type: 'rest' }];
  const count = chance(0.2) ? 3 : chance(0.12) ? 1 : 2;
  const out = [], used = new Set();
  for (let guard = 0; out.length < count && guard < 40; guard++) {
    const type = pickWeighted([
      ['boon', 46], ['gold', 14], ['heart', 10], ['shard', 13], ['forge', 5],
      ['fruit', Run.boons.some((b) => !BOONS[b.id].fixed) ? 12 : 0],
    ]);
    if (type === 'boon') {
      const choices = ancientsWithBoons(used);
      if (!choices.length) continue;
      const anc = pick(choices);
      used.add(anc);
      out.push({ type, anc });
    } else if (!out.some((r) => r.type === type)) {
      out.push({ type });
    }
  }
  return out.length ? out : [{ type: 'gold' }];
}

function planWaves(biome, idx) {
  const pool = BIOMES[biome].enemies;
  const n = idx === 0 ? 1 : idx < 3 ? 2 : chance(0.45) ? 3 : 2;
  const waves = [];
  for (let w = 0; w < n; w++) {
    const count = 3 + Math.floor(idx * 0.35) + rand(2) + (w > 0 ? 1 : 0);
    const wave = [];
    for (let i = 0; i < count; i++) wave.push({ type: pickWeighted(pool), elite: biome > 0 && chance(0.06 + 0.02 * idx) });
    waves.push(wave);
  }
  return waves;
}

function nextChamber(reward) {
  Run.room += 1;
  Run.reward = reward;
  Bus.emit('leave');
  enterChamber();
}

function endRun(won) {
  if (!Ch || Ch.over) return;
  Meta.runs += 1;
  if (won) Meta.wins += 1;
  Meta.bestRoom = Math.max(Meta.bestRoom, Run.room + 1);
  Meta.kills += Run.kills;
  saveMeta();
  clearRun();
  Ch.over = true;
  Bus.emit('runEnd', won);
}

// ---- Hero ----------------------------------------------------------------------------------------

function refreshStats() {
  const P = Ch && Ch.player;
  if (!P) return;
  P.dmgMult = (1 + 0.06 * upgradeLevel('might')) * (1 + 0.15 * Run.forge);
  P.crit = 0.04 * upgradeLevel('insight');
  P.dashMax = 1 + upgradeLevel('swift') + boonVal('wind_dash');
  const castMax = 1 + upgradeLevel('echo') + boonVal('wind_cast');
  if (castMax > P.castMax) P.castAmmo += castMax - P.castMax;
  P.castMax = castMax;
  P.speed = HERO.speed * (1 + boonVal('wind_passive') / 100);
  P.dodge = boonVal('wind_dodge') / 100;
  P.atkSpeed = 1 + boonVal('wind_attack') / 100;
  P.specSpeed = 1 + boonVal('wind_special') / 100;
}

function makePlayer() {
  const s = Ch.room.spawn;
  const P = {
    id: 0, x: s.x, z: s.z, vx: 0, vz: 0, kx: 0, kz: 0, r: HERO.radius, face: { x: 0, z: -1 },
    state: 'idle', st: 0, combo: 0, comboT: 0, queued: false, hits: new Set(), atk: null,
    dashes: 1, dashMax: 1, dashT: 0, dashDir: null, iframes: 0, dashStrikeT: 0, critT: 0, trailT: 0,
    castAmmo: 0, castMax: 0, charge: 0, charging: false, shotCd: 0,
  };
  Ch.player = P;
  refreshStats();
  P.dashes = P.dashMax;
  P.castAmmo = P.castMax;
  return P;
}

// Aim along the stick, snapping to the best enemy inside a forgiving cone.
function aimDir(range, cone = 1.15) {
  const P = Ch.player, mv = Input.move;
  let dx = P.face.x, dz = P.face.z;
  if (Math.hypot(mv.x, mv.z) > 0.25) {
    const l = Math.hypot(mv.x, mv.z);
    dx = mv.x / l;
    dz = mv.z / l;
  } else {
    // thumb off the stick: any nearby enemy is fair game, the closest one in front first
    cone = Math.PI;
  }
  let best = null, bestScore = Infinity;
  for (const e of Ch.enemies) {
    if (!e.alive || e.spawnT > 0) continue;
    const ex = e.x - P.x, ez = e.z - P.z, d = Math.hypot(ex, ez);
    if (d > range + e.r || d < 1e-3) continue;
    const cos = (ex * dx + ez * dz) / d;
    if (cos < Math.cos(cone)) continue;
    const score = d * (2.2 - cos);
    if (score < bestScore) { bestScore = score; best = { x: ex / d, z: ez / d }; }
  }
  return best || { x: dx, z: dz };
}

const busy = (P) => P.state === 'attack' || P.state === 'special' || P.state === 'cast' || P.state === 'dash' || P.state === 'volley';

function updatePlayer(dt) {
  const P = Ch.player;
  if (P.state === 'dead') {
    P.st += dt;
    return;
  }
  P.iframes = Math.max(0, P.iframes - dt);
  P.dashStrikeT = Math.max(0, P.dashStrikeT - dt);
  P.critT = Math.max(0, P.critT - dt);
  P.comboT = Math.max(0, P.comboT - dt);
  P.shotCd = Math.max(0, P.shotCd - dt);
  if (P.dashes < P.dashMax) {
    P.dashT += dt;
    if (P.dashT >= HERO.dashRegen) { P.dashes = P.dashMax; P.dashT = 0; }
  }
  const mv = Input.move, mag = Math.min(1, Math.hypot(mv.x, mv.z));

  // inputs: a dash cancels anything; the rest waits for the hero to be free
  if (P.state !== 'dash' && P.dashes > 0 && Input.take('dash')) startDash(mv, mag);
  else if (!busy(P)) {
    if (Input.take('special')) startSpecial();
    else if (Input.take('cast')) startCast();
    else if (Input.take('attack') || (Input.held.attack && Run.weapon === 'sword')) startAttack();
  }
  if (Run.weapon === 'bow') updateBowCharge(dt);

  switch (P.state) {
    case 'idle':
    case 'run': {
      const speed = P.speed * (P.charging ? 0.55 : 1);
      P.vx = mv.x * speed;
      P.vz = mv.z * speed;
      if (mag > 0.1) {
        P.face = { x: mv.x / mag, z: mv.z / mag };
        P.state = 'run';
      } else P.state = 'idle';
      break;
    }
    case 'attack': updateSwing(P, dt); break;
    case 'special': updateSpecial(P, dt); break;
    case 'volley': updateVolley(P, dt); break;
    case 'cast': {
      P.st += dt;
      P.vx *= 0.8;
      P.vz *= 0.8;
      if (P.st >= CAST.recover) P.state = 'idle';
      break;
    }
    case 'dash': {
      P.st += dt;
      const v = HERO.dashDist / HERO.dashTime;
      P.vx = P.dashDir.x * v;
      P.vz = P.dashDir.z * v;
      const trail = ownedBoon('ember_dash');
      if (trail && (P.trailT -= dt) <= 0) {
        P.trailT = 0.045;
        addHazard({ kind: 'pool', owner: 'player', x: P.x, z: P.z, r: 0.75, life: 2.4, dps: boonValue(trail), look: 'ember' });
      }
      if (P.st >= HERO.dashTime) {
        P.state = 'idle';
        P.dashStrikeT = 0.3;
        const sh = ownedBoon('shadow_dash');
        if (sh) P.critT = boonValue(sh);
      }
      break;
    }
    default: break;
  }
  // move, with a little knockback when hit
  P.kx *= Math.exp(-dt * 10);
  P.kz *= Math.exp(-dt * 10);
  P.x += (P.vx + P.kx) * dt;
  P.z += (P.vz + P.kz) * dt;
  collide(Ch.room, P, P.r);
  if (P.state !== 'dash') {
    for (const e of Ch.enemies) {
      if (!e.alive || e.spawnT > 0 || e.def.flying) continue;
      const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz), min = P.r + e.r;
      if (d < min && d > 1e-4) {
        const push = (min - d) * (e.def.heavy ? 1 : 0.5);
        P.x += (dx / d) * push;
        P.z += (dz / d) * push;
      }
    }
    collide(Ch.room, P, P.r);
  }
  // lava burns the hero (a dash skims over it)
  if (P.state !== 'dash' && Ch.room.lava.some((l) => Math.hypot(P.x - l.x, P.z - l.z) < l.r)) {
    if ((Ch.lavaTick -= dt) <= 0) {
      Ch.lavaTick = 0.5;
      hurtPlayer(5, null, true);
    }
  } else Ch.lavaTick = 0;
}

function startDash(mv, mag) {
  const P = Ch.player;
  const dir = mag > 0.2 ? { x: mv.x / mag, z: mv.z / mag } : { ...P.face };
  P.state = 'dash';
  P.st = 0;
  P.dashDir = dir;
  P.face = dir;
  P.dashes -= 1;
  P.dashT = 0;
  P.iframes = Math.max(P.iframes, HERO.dashTime + 0.1);
  P.charging = false;
  Bus.emit('dash', P);
  const b = slotBoon('dash');
  if (!b) return;
  const v = boonValue(b);
  if (b.id === 'storm_dash') {
    const t = nearestEnemy(P.x, P.z, 7);
    if (t) lightningStrike(t, v);
  } else if (b.id === 'tide_dash') {
    const wx = P.x + dir.x * 2, wz = P.z + dir.z * 2;
    for (const e of enemiesNear(wx, wz, 2.6)) dealDamage(e, v, { src: 'splash', dx: dir.x, dz: dir.z, knock: 9, noCrit: true });
    Bus.emit('wave', wx, wz, 2.6);
  } else if (b.id === 'frost_dash') {
    for (const e of enemiesNear(P.x, P.z, 3)) addChill(e, v);
    Bus.emit('nova', P.x, P.z, 3);
  }
}

function startAttack() {
  const P = Ch.player;
  if (Run.weapon === 'bow') {
    if (P.shotCd > 0) return;
    const w = WEAPONS.bow;
    const dir = aimDir(w.shot.range);
    P.face = dir;
    fireArrow(dir, w.shot.dmg * P.dmgMult, w.shot.speed, false);
    P.shotCd = w.shot.cooldown / P.atkSpeed;
    P.charging = true;
    P.charge = 0;
    return;
  }
  const W = WEAPONS.sword;
  let step;
  if (P.dashStrikeT > 0) {
    step = W.dashStrike;
    P.dashStrikeT = 0;
    P.combo = 0;
    P.strikeKind = 'dash';
  } else {
    if (P.comboT <= 0) P.combo = 0;
    step = W.combo[P.combo];
    P.strikeKind = P.combo;
  }
  P.atk = { windup: 0.07, active: 0.1, recover: 0.2, ...step };
  P.state = 'attack';
  P.st = 0;
  P.queued = false;
  P.lunged = false;
  P.hits = new Set();
  P.face = aimDir(4.5);
  Bus.emit('swing', P);
}

function updateSwing(P, dt) {
  const a = P.atk;
  P.st += dt * P.atkSpeed;
  const t1 = a.windup, t2 = t1 + a.active, t3 = t2 + a.recover;
  if (P.st < t1) {
    P.vx *= 0.6;
    P.vz *= 0.6;
  } else if (P.st < t2) {
    if (!P.lunged) {
      P.lunged = true;
      P.vx = P.face.x * a.lunge;
      P.vz = P.face.z * a.lunge;
    }
    meleeHits(P, a.range, a.arc, a.dmg * P.dmgMult, 'attack', P.strikeKind === 2 || P.strikeKind === 'dash');
  } else if (P.st < t3) {
    P.vx *= Math.exp(-dt * 14);
    P.vz *= Math.exp(-dt * 14);
    if (Input.take('attack') || Input.held.attack) P.queued = true;
  } else {
    P.state = 'idle';
    if (P.strikeKind !== 'dash') P.combo = (P.combo + 1) % 3;
    P.comboT = 0.4;
    if (P.queued) startAttack();
  }
}

function meleeHits(P, range, arc, dmg, src, stagger) {
  for (const e of Ch.enemies) {
    if (!e.alive || e.spawnT > 0 || P.hits.has(e)) continue;
    const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz);
    if (d - e.r > range) continue;
    const cos = d > 1e-3 ? (dx * P.face.x + dz * P.face.z) / d : 1;
    if (d > e.r + 0.6 && cos < Math.cos(arc / 2)) continue;
    P.hits.add(e);
    dealDamage(e, dmg, { src, dx: P.face.x, dz: P.face.z, knock: stagger ? 7 : 3.5, stagger });
    Ch.hitstop = Math.max(Ch.hitstop, 0.035);
  }
  breakUrns(P.x + P.face.x * range * 0.6, P.z + P.face.z * range * 0.6, range * 0.7);
}

function startSpecial() {
  const P = Ch.player;
  P.st = 0;
  P.fired = false;
  if (Run.weapon === 'bow') {
    P.state = 'volley';
    P.face = aimDir(14, 1.3);
    return;
  }
  P.state = 'special';
  P.hits = new Set();
  Bus.emit('spinStart', P);
}

function updateSpecial(P, dt) {
  const s = WEAPONS.sword.special;
  P.st += dt * P.specSpeed;
  P.vx *= 0.7;
  P.vz *= 0.7;
  if (!P.fired && P.st >= s.windup) {
    P.fired = true;
    const radius = s.radius * (1 + (P.specSpeed - 1) * 0.6);
    const tide = ownedBoon('tide_special');
    for (const e of enemiesNear(P.x, P.z, radius)) {
      const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz) || 1;
      if (P.hits.has(e)) continue;
      P.hits.add(e);
      dealDamage(e, s.dmg * P.dmgMult, { src: 'special', dx: dx / d, dz: dz / d, knock: tide ? 16 : s.knock, stagger: true });
    }
    breakUrns(P.x, P.z, radius);
    Ch.hitstop = Math.max(Ch.hitstop, 0.05);
    Bus.emit('spin', P, radius);
  }
  if (P.st >= s.windup + s.recover) P.state = 'idle';
}

function updateVolley(P, dt) {
  const s = WEAPONS.bow.special;
  P.st += dt * P.specSpeed;
  if (!P.fired && P.st >= 0.12) {
    P.fired = true;
    const base = Math.atan2(P.face.z, P.face.x);
    const spread = s.spread * (1 + (P.specSpeed - 1) * 0.6);
    for (let i = 0; i < s.count; i++) {
      const a = base + (i / (s.count - 1) - 0.5) * spread;
      fireArrow({ x: Math.cos(a), z: Math.sin(a) }, s.dmg * P.dmgMult, s.speed, false, 'special');
    }
  }
  if (P.st >= s.recover) P.state = 'idle';
}

function updateBowCharge(dt) {
  const P = Ch.player;
  if (!P.charging) return;
  if (Input.held.attack && (P.state === 'idle' || P.state === 'run')) {
    P.charge += dt;
    return;
  }
  const c = WEAPONS.bow.charged;
  if (P.charge >= c.time && P.state !== 'dash') {
    const dir = aimDir(18, 0.6);
    P.face = dir;
    fireArrow(dir, c.dmg * P.dmgMult, c.speed, true);
  }
  P.charging = false;
  P.charge = 0;
}

function fireArrow(dir, dmg, speed, pierce, src = 'attack') {
  const P = Ch.player;
  Ch.projectiles.push({
    owner: 'player', kind: pierce ? 'bolt' : 'arrow', src, x: P.x + dir.x * 0.6, z: P.z + dir.z * 0.6, y: 1.1,
    vx: dir.x * speed, vz: dir.z * speed, r: pierce ? 0.35 : 0.25, dmg, pierce, life: 0.75, hit: new Set(),
  });
  Bus.emit('shoot', P, pierce);
}

function startCast() {
  const P = Ch.player;
  if (P.castAmmo <= 0) {
    Bus.emit('noAmmo');
    return;
  }
  const dir = aimDir(CAST.range, 1.0);
  P.face = dir;
  P.castAmmo -= 1;
  P.state = 'cast';
  P.st = 0;
  Ch.projectiles.push({
    owner: 'player', kind: 'crystal', src: 'cast', x: P.x + dir.x * 0.6, z: P.z + dir.z * 0.6, y: 1.1,
    vx: dir.x * CAST.speed, vz: dir.z * CAST.speed, r: 0.32, dmg: CAST.dmg * P.dmgMult, pierce: false,
    life: CAST.range / CAST.speed, hit: new Set(),
  });
  Bus.emit('cast', P);
}

// Where a thrown crystal lands, its blessing goes off.
function crystalImpact(p, target) {
  const b = slotBoon('cast');
  if (b) {
    const v = boonValue(b);
    if (b.id === 'storm_cast') {
      Bus.emit('strike', p.x, p.z);
      for (const e of enemiesNear(p.x, p.z, 2.8)) dealDamage(e, v * stormMult(), { src: 'storm', noCrit: true });
    } else if (b.id === 'ember_cast') {
      addHazard({ kind: 'pool', owner: 'player', x: p.x, z: p.z, r: 2, life: 3, dps: v, look: 'ember' });
    } else if (b.id === 'tide_cast') {
      Bus.emit('wave', p.x, p.z, 3);
      for (const e of enemiesNear(p.x, p.z, 3)) {
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) || 1;
        dealDamage(e, v, { src: 'splash', dx: dx / d, dz: dz / d, knock: 12, noCrit: true, stagger: true });
      }
    } else if (target && b.id === 'frost_cast') {
      target.frozen = Math.max(target.frozen, target.def.boss ? v * 0.4 : v);
      target.chill = 0;
      Bus.emit('freeze', target);
    } else if (target && b.id === 'shadow_cast') {
      target.mark = 6;
    }
  }
  if (target && target.alive) target.lodged = (target.lodged || 0) + 1;
  else dropCrystal(p.x, p.z);
}

function dropCrystal(x, z) {
  const room = Ch.room;
  const pt = { x: clamp(x, -room.W / 2 + 0.6, room.W / 2 - 0.6), z: clamp(z, -room.D / 2 + 0.6, room.D / 2 - 0.6) };
  collide(room, pt, 0.4);
  Ch.pickups.push({ kind: 'crystal', x: pt.x, z: pt.z, t: 0 });
}

function hurtPlayer(dmg, from, ignoreDash = false) {
  const P = Ch.player;
  if (Ch.over || P.state === 'dead') return false;
  if (ignoreDash ? P.iframes > HERO.iframes - 0.15 : P.iframes > 0) return false;
  if (P.dodge && !ignoreDash && Math.random() < P.dodge) {
    P.iframes = 0.3;
    Bus.emit('dodged', P);
    return false;
  }
  dmg = Math.max(1, Math.round(dmg));
  Run.hp -= dmg;
  P.iframes = HERO.iframes;
  if (from) {
    const dx = P.x - from.x, dz = P.z - from.z, d = Math.hypot(dx, dz) || 1;
    P.kx = (dx / d) * 6;
    P.kz = (dz / d) * 6;
  }
  Ch.hitstop = Math.max(Ch.hitstop, 0.07);
  Bus.emit('hurt', dmg);
  if (Run.hp <= 0) {
    if (Run.defiance > 0) {
      Run.defiance -= 1;
      Run.hp = Math.round(Run.maxHp * 0.4);
      P.iframes = 2;
      Bus.emit('defiance');
    } else {
      Run.hp = 0;
      P.state = 'dead';
      P.st = 0;
      P.charging = false;
      Bus.emit('death');
      setTimeout(() => endRun(false), 1700);
    }
  }
  return true;
}

// ---- Damage, statuses and blessing effects ---------------------------------------------------------

const stormMult = () => 1 + boonVal('storm_passive') / 100;

function nearestEnemy(x, z, range, skip) {
  let best = null, bd = range;
  for (const e of Ch.enemies) {
    if (!e.alive || e.spawnT > 0 || (skip && skip.has(e))) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

const enemiesNear = (x, z, r) => Ch.enemies.filter((e) => e.alive && e.spawnT <= 0 && Math.hypot(e.x - x, e.z - z) < r + e.r);

function dealDamage(e, base, o = {}) {
  if (!e.alive || e.spawnT > 0) return 0;
  const P = Ch.player;
  let dmg = base, crit = false;
  const direct = o.src === 'attack' || o.src === 'special' || o.src === 'dash' || o.src === 'cast';
  if (!o.noCrit) {
    let c = P.crit;
    if (o.src === 'attack') c += boonVal('shadow_attack') / 100;
    if (o.src === 'special') c += boonVal('shadow_special') / 100;
    if (e.mark > 0) c += boonVal('shadow_cast') / 100;
    if (P.critT > 0 && direct) c = 1;
    if (Math.random() < c) {
      crit = true;
      dmg *= 3 * (1 + boonVal('shadow_passive') / 100);
    }
  }
  if (o.src === 'special') {
    if (e.chill > 0 || e.frozen > 0) dmg *= 1 + boonVal('frost_special') / 100;
    dmg *= 1 + boonVal('tide_special') / 100;
  }
  dmg = Math.max(1, Math.round(dmg));
  e.hp -= dmg;
  e.flash = 1;
  if (o.knock && !e.def.heavy) {
    e.kx += (o.dx || 0) * o.knock;
    e.kz += (o.dz || 0) * o.knock;
    e.slamCheck = 0.4;
  }
  if (o.stagger && !e.def.heavy) {
    e.stun = 0.3;
    e.tele = null;
    if (e.state === 'windup' || e.state === 'aim' || e.state === 'cast' || e.state === 'strike') {
      e.state = 'recover';
      e.st = 0;
    }
  }
  Bus.emit('hit', e, dmg, crit, o.src);
  if (direct) applyOnHit(e, o.src, o);
  if (e.hp <= 0 && e.alive) killEnemy(e);
  return dmg;
}

function applyOnHit(e, src, o) {
  const b = slotBoon(src);
  if (!b) return;
  const v = boonValue(b);
  switch (b.id) {
    case 'storm_attack': chainLightning(e, v * stormMult(), 2); break;
    case 'storm_special': lightningStrike(e, v); break;
    case 'ember_attack': addBurn(e, v); break;
    case 'ember_special':
      if (e.burn > 0 && e.alive) {
        const n = e.burn;
        e.burn = 0;
        Bus.emit('burst', e);
        dealDamage(e, n * v, { src: 'burst', noCrit: true });
      }
      break;
    case 'frost_attack': addChill(e, 1); break;
    case 'tide_attack':
      for (const other of enemiesNear(e.x, e.z, 2)) {
        if (other === e) continue;
        const dx = other.x - e.x, dz = other.z - e.z, d = Math.hypot(dx, dz) || 1;
        dealDamage(other, v, { src: 'splash', dx: dx / d, dz: dz / d, knock: 6, noCrit: true });
      }
      if (!e.def.heavy) {
        e.kx += (o.dx || 0) * 4;
        e.kz += (o.dz || 0) * 4;
      }
      Bus.emit('splash', e);
      break;
    default: break;
  }
}

function lightningStrike(e, dmg) {
  Bus.emit('strike', e.x, e.z);
  dealDamage(e, dmg * stormMult(), { src: 'storm', noCrit: true });
}

function chainLightning(from, dmg, jumps) {
  const hit = new Set([from]);
  let cur = from;
  for (let i = 0; i < jumps; i++) {
    const next = nearestEnemy(cur.x, cur.z, 5, hit);
    if (!next) break;
    Ch.bolts.push({ x0: cur.x, z0: cur.z, x1: next.x, z1: next.z, t: 0 });
    hit.add(next);
    dealDamage(next, dmg, { src: 'storm', noCrit: true });
    cur = next;
  }
  Bus.emit('zap', from);
}

function addBurn(e, n) {
  e.burn = Math.min(12, e.burn + n);
  e.burnT = 4;
}

function addChill(e, n) {
  if (e.frozen > 0) return;
  e.chill = Math.min(4, e.chill + n);
  e.chillT = 3;
  if (e.chill >= 4) {
    e.chill = 0;
    e.frozen = e.def.boss ? 0.6 : 1.4;
    e.tele = null;
    Bus.emit('freeze', e);
  }
}

function killEnemy(e) {
  e.alive = false;
  e.hp = 0;
  e.tele = null;
  Run.kills += 1;
  Bus.emit('kill', e);
  const shatter = boonVal('frost_passive');
  if (shatter && (e.chill > 0 || e.frozen > 0)) {
    Bus.emit('nova', e.x, e.z, 2.4);
    for (const o of enemiesNear(e.x, e.z, 2.4)) dealDamage(o, shatter, { src: 'shatter', noCrit: true });
  }
  if (e.def.split) {
    for (const s of [-1, 1]) spawnEnemy(e.def.split, e.x + s * 0.5, e.z, { spawnT: 0.15 });
  }
  for (let i = 0; i < (e.lodged || 0); i++) dropCrystal(e.x + (Math.random() - 0.5), e.z + (Math.random() - 0.5));
  if (e.def.boss) bossDefeated(e);
}

function bossDefeated(e) {
  for (const o of Ch.enemies) if (o !== e && o.alive) killEnemy(o);
  Ch.hazards = [];
  Ch.projectiles = Ch.projectiles.filter((p) => p.owner === 'player');
  Ch.cleared = true;
  Meta.shards += e.def.shards;
  Run.shards += e.def.shards;
  saveMeta();
  Bus.emit('bossDown', e);
  if (Run.room >= TOTAL_ROOMS - 1) {
    setTimeout(() => endRun(true), 2600);
  } else {
    Ch.pickups.push({ kind: 'reward', x: e.x, z: Math.min(e.z + 2, 0), t: 0, reward: { type: 'heart' } });
  }
}

function breakUrns(x, z, r) {
  for (const o of Ch.room.obstacles) {
    if (o.kind !== 'urn' || o.broken || Math.hypot(o.x - x, o.z - z) > r + o.r) continue;
    o.broken = true;
    Bus.emit('urn', o);
    if (chance(0.65)) Ch.pickups.push({ kind: 'gold', x: o.x, z: o.z, t: 0, value: randInt(4, 9) });
    else Ch.pickups.push({ kind: 'heal', x: o.x, z: o.z, t: 0, value: 6 });
  }
}

function addHazard(h) {
  Ch.hazards.push({ t: 0, delay: 0, tick: 0, ...h });
}

// ---- Enemies --------------------------------------------------------------------------------------

function spawnEnemy(type, x, z, opts = {}) {
  const def = ENEMIES[type], idx = combatIndex();
  const elite = !!opts.elite;
  const hp = Math.round(def.hp * (def.boss ? 1 : 1 + 0.08 * idx) * (elite ? 1.8 : 1));
  const P = Ch.player;
  const e = {
    id: Ch.nextId++, type, def, x, z, y: 0, kx: 0, kz: 0, r: def.radius * (elite ? 1.15 : 1), hp, maxHp: hp, elite,
    dmgMult: (def.boss ? 1 : 1 + 0.05 * idx) * (elite ? 1.25 : 1), state: 'spawn', st: 0, cd: 0.5 + Math.random() * 0.8,
    ang: P ? Math.atan2(P.z - z, P.x - x) : -Math.PI / 2, spawnT: opts.spawnT ?? 0.9, alive: true,
    burn: 0, burnT: 0, burnTick: 0.5, chill: 0, chillT: 0, frozen: 0, mark: 0, stun: 0, flash: 0, tele: null,
    lodged: 0, hitPlayer: false, data: {}, speedNow: 0, slamCheck: 0,
  };
  Ch.enemies.push(e);
  Bus.emit('spawn', e);
  return e;
}

function spawnWave(wave) {
  for (const w of wave) {
    const p = freePoint(Ch.room, Ch.player, 4.5, 1) || freePoint(Ch.room, Ch.player, 2, 0.8);
    if (p) spawnEnemy(w.type, p.x, p.z, { elite: w.elite });
  }
}

function updateEnemies(dt) {
  const P = Ch.player;
  for (const e of Ch.enemies) {
    if (!e.alive) continue;
    e.flash = Math.max(0, e.flash - dt * 6);
    if (e.spawnT > 0) {
      e.spawnT -= dt;
      if (e.spawnT <= 0) e.state = e.def.ai === 'swoop' ? 'hover' : e.def.ai === 'wraith' ? 'float' : 'chase';
      continue;
    }
    if (e.burn > 0) {
      e.burnT -= dt;
      e.burnTick -= dt;
      if (e.burnTick <= 0) {
        e.burnTick = 0.5;
        dealDamage(e, Math.max(1, e.burn * 1.5 * (1 + boonVal('ember_passive') / 100)), { src: 'burn', noCrit: true });
        if (!e.alive) continue;
      }
      if (e.burnT <= 0) e.burn = 0;
    }
    if (e.chill > 0 && (e.chillT -= dt) <= 0) e.chill = 0;
    e.mark = Math.max(0, e.mark - dt);
    // knockback, and the Écueil blessing when it slams into something
    if (Math.abs(e.kx) + Math.abs(e.kz) > 0.05) {
      e.x += e.kx * dt;
      e.z += e.kz * dt;
      const fast = Math.hypot(e.kx, e.kz) > 5;
      e.kx *= Math.exp(-dt * 7);
      e.kz *= Math.exp(-dt * 7);
      if (collide(Ch.room, e, e.r) && fast && e.slamCheck > 0) {
        e.slamCheck = 0;
        const v = boonVal('tide_passive');
        if (v) {
          Bus.emit('splash', e);
          dealDamage(e, v, { src: 'wall', noCrit: true });
          if (!e.alive) continue;
        }
      }
    }
    e.slamCheck = Math.max(0, e.slamCheck - dt);
    if (e.frozen > 0) {
      e.frozen -= dt;
      e.tele = null;
      continue;
    }
    if (e.stun > 0) {
      e.stun -= dt;
      continue;
    }
    const k = 1 - Math.min(0.7, e.chill * ((boonVal('frost_attack') || 14) / 100));
    const ox = e.x, oz = e.z;
    AI[e.def.ai](e, dt * k, k, P);
    if (!e.alive) continue;
    if (!e.def.flying) collide(Ch.room, e, e.r);
    e.speedNow = Math.hypot(e.x - ox, e.z - oz) / Math.max(dt, 1e-4);
  }
  // keep enemies from stacking on each other
  const list = Ch.enemies.filter((e) => e.alive && e.spawnT <= 0);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!!a.def.flying !== !!b.def.flying) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.r + b.r;
      if (d < min && d > 1e-4) {
        const nx = dx / d, nz = dz / d;
        const wa = a.def.boss ? 0 : b.def.boss ? 1 : 0.5, wb = b.def.boss ? 0 : a.def.boss ? 1 : 0.5;
        a.x -= nx * (min - d) * wa;
        a.z -= nz * (min - d) * wa;
        b.x += nx * (min - d) * wb;
        b.z += nz * (min - d) * wb;
      }
    }
  }
  Ch.enemies = Ch.enemies.filter((e) => e.alive);
}

// Helpers shared by the behaviours
function toP(e, P) {
  const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz) || 1e-4;
  return { dx: dx / d, dz: dz / d, d, ang: Math.atan2(dz, dx) };
}
function turnTo(a, b, max) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + clamp(d, -max, max);
}
function walk(e, dirX, dirZ, speed, dt) {
  e.x += dirX * speed * dt;
  e.z += dirZ * speed * dt;
  if (Math.abs(dirX) + Math.abs(dirZ) > 0.01) e.ang = turnTo(e.ang, Math.atan2(dirZ, dirX), dt * 8);
}
function inCone(e, P, ang, r, arc) {
  const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz);
  if (d > r + P.r) return false;
  if (d < e.r + 0.3) return true;
  const a = Math.atan2(dz, dx);
  return Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang))) < arc / 2;
}
const inCircle = (x, z, r, P) => Math.hypot(P.x - x, P.z - z) < r + P.r * 0.6;

function enemyShot(e, ang, speed, kind, dmg, extra = {}) {
  Ch.projectiles.push({
    owner: 'enemy', kind, x: e.x + Math.cos(ang) * (e.r + 0.2), z: e.z + Math.sin(ang) * (e.r + 0.2), y: 1,
    vx: Math.cos(ang) * speed, vz: Math.sin(ang) * speed, r: kind === 'orb' ? 0.35 : 0.24, dmg: dmg * e.dmgMult, life: 3, ...extra,
  });
}

const AI = {
  melee(e, dt, k, P) {
    const t = toP(e, P), d = e.def;
    if (e.state === 'chase') {
      walk(e, t.dx, t.dz, d.speed * k, dt);
      e.cd -= dt;
      if (t.d < d.reach + P.r + 0.2 && e.cd <= 0) { e.state = 'windup'; e.st = 0; e.lock = t.ang; }
    } else if (e.state === 'windup') {
      e.st += dt;
      e.ang = turnTo(e.ang, e.lock, dt * 6);
      e.tele = { shape: 'cone', x: e.x, z: e.z, ang: e.lock, r: d.reach + 0.6, arc: d.arc, p: e.st / d.windup };
      if (e.st >= d.windup) {
        e.state = 'strike';
        e.st = 0;
        e.tele = null;
        e.hitPlayer = false;
        Bus.emit('enemyAttack', e);
      }
    } else if (e.state === 'strike') {
      e.st += dt;
      const v = d.lunge * Math.max(0, 1 - e.st / 0.2);
      e.x += Math.cos(e.lock) * v * dt;
      e.z += Math.sin(e.lock) * v * dt;
      if (!e.hitPlayer && e.st < 0.14 && inCone(e, P, e.lock, d.reach * 0.75 + e.r, d.arc + 0.3)) e.hitPlayer = hurtPlayer(d.dmg * e.dmgMult, e);
      if (e.st >= 0.22) { e.state = 'recover'; e.st = 0; }
    } else {
      e.state = 'recover';
      e.st += dt;
      if (e.st >= 0.5) { e.state = 'chase'; e.cd = d.cooldown * (0.7 + Math.random() * 0.6); }
    }
  },

  swoop(e, dt, k, P) {
    const t = toP(e, P), d = e.def;
    if (e.state === 'windup') {
      e.st += dt;
      e.ang = t.ang;
      e.lock = t.ang;
      e.tele = { shape: 'line', x: e.x, z: e.z, ang: e.lock, len: 5, w: 0.7, p: e.st / 0.45 };
      if (e.st >= 0.45) { e.state = 'dive'; e.st = 0; e.tele = null; e.hitPlayer = false; Bus.emit('enemyAttack', e); }
    } else if (e.state === 'dive') {
      e.st += dt;
      walk(e, Math.cos(e.lock), Math.sin(e.lock), d.speed * 2.6 * k, dt);
      collide(Ch.room, e, e.r);
      if (!e.hitPlayer && Math.hypot(P.x - e.x, P.z - e.z) < e.r + P.r + 0.1) e.hitPlayer = hurtPlayer(d.dmg * e.dmgMult, e);
      if (e.st >= 0.5) { e.state = 'hover'; e.cd = d.cooldown * (0.7 + Math.random() * 0.6); }
    } else {
      e.state = 'hover';
      e.data.orbit = (e.data.orbit ?? Math.random() * 6) + dt * 1.3;
      const tx = P.x + Math.cos(e.data.orbit) * 3.6, tz = P.z + Math.sin(e.data.orbit) * 3.6;
      const dx = tx - e.x, dz = tz - e.z, l = Math.hypot(dx, dz) || 1;
      walk(e, dx / l, dz / l, Math.min(d.speed * k, l * 3), dt);
      collide(Ch.room, e, e.r);
      e.ang = t.ang;
      e.cd -= dt;
      if (e.cd <= 0 && t.d < 6) { e.state = 'windup'; e.st = 0; }
    }
  },

  archer(e, dt, k, P) {
    const t = toP(e, P), d = e.def;
    if (e.state === 'aim') {
      e.st += dt;
      if (e.st < d.aim * 0.7) e.lock = turnTo(e.lock, t.ang, dt * 4);
      e.ang = e.lock;
      e.tele = { shape: 'line', x: e.x, z: e.z, ang: e.lock, len: 13, w: 0.3, p: e.st / d.aim };
      if (e.st >= d.aim) {
        e.tele = null;
        enemyShot(e, e.lock, d.projSpeed, 'arrow', d.dmg);
        Bus.emit('enemyShoot', e);
        e.state = 'recover';
        e.st = 0;
      }
    } else if (e.state === 'recover') {
      e.st += dt;
      if (e.st >= 0.45) { e.state = 'chase'; e.cd = d.cooldown * (0.8 + Math.random() * 0.5); e.data.strafe = -(e.data.strafe || 1); }
    } else {
      e.data.strafe = e.data.strafe || (chance(0.5) ? 1 : -1);
      let mx = 0, mz = 0;
      if (t.d > 9) { mx = t.dx; mz = t.dz; } else if (t.d < 5) { mx = -t.dx; mz = -t.dz; } else { mx = -t.dz * e.data.strafe * 0.6; mz = t.dx * e.data.strafe * 0.6; }
      walk(e, mx, mz, d.speed * k, dt);
      e.ang = t.ang;
      e.cd -= dt;
      if (e.cd <= 0 && t.d < 13 && clearLine(Ch.room, e.x, e.z, P.x, P.z)) { e.state = 'aim'; e.st = 0; e.lock = t.ang; }
    }
  },

  hopper(e, dt, k, P) {
    const t = toP(e, P), d = e.def;
    if (e.state === 'hop') {
      e.st += dt;
      const dur = 0.5;
      walk(e, Math.cos(e.lock), Math.sin(e.lock), e.data.dist / dur, dt);
      e.y = Math.sin(Math.PI * Math.min(1, e.st / dur)) * 0.9;
      if (e.st >= dur) {
        e.y = 0;
        e.state = 'chase';
        e.cd = d.cooldown * (0.8 + Math.random() * 0.4);
        Bus.emit('land', e);
        if (Math.hypot(P.x - e.x, P.z - e.z) < e.r + P.r + 0.35) hurtPlayer(d.dmg * e.dmgMult, e);
      }
    } else {
      e.state = 'chase';
      e.y = 0;
      e.cd -= dt;
      e.ang = turnTo(e.ang, t.ang, dt * 4);
      if (e.cd <= 0) {
        e.state = 'hop';
        e.st = 0;
        e.lock = t.ang;
        e.data.dist = Math.min(2.4, t.d + 0.3);
      }
    }
  },

  wraith(e, dt, k, P) {
    const t = toP(e, P), d = e.def;
    if (e.state === 'cast') {
      e.st += dt;
      e.tele = { shape: 'circle', x: e.x, z: e.z, r: 1.1, p: e.st / 0.7 };
      if (e.st >= 0.7) {
        e.tele = null;
        enemyShot(e, t.ang, 4.6, 'orb', d.dmg, { homing: 2.2, life: 5 });
        Bus.emit('enemyShoot', e);
        e.state = 'float';
        e.cd = d.cooldown * (0.8 + Math.random() * 0.4);
      }
    } else if (e.state === 'blink') {
      e.st += dt;
      if (e.st >= 0.35 && !e.data.moved) {
        const p = freePoint(Ch.room, P, 4.5, 1);
        if (p && Math.hypot(p.x - P.x, p.z - P.z) < 8) { e.x = p.x; e.z = p.z; }
        e.data.moved = true;
        Bus.emit('blink', e);
      }
      if (e.st >= 0.7) { e.data.moved = false; e.state = 'cast'; e.st = 0; }
    } else {
      e.state = 'float';
      const want = t.d > 7 ? 1 : t.d < 4.5 ? -1 : 0;
      walk(e, t.dx * want - t.dz * 0.3, t.dz * want + t.dx * 0.3, d.speed * k, dt);
      collide(Ch.room, e, e.r);
      e.ang = t.ang;
      e.cd -= dt;
      if (e.cd <= 0) { e.state = chance(0.3) ? 'blink' : 'cast'; e.st = 0; }
    }
  },

  slam(e, dt, k, P) {
    const t = toP(e, P), d = e.def;
    if (e.state === 'windup') {
      e.st += dt;
      e.ang = turnTo(e.ang, e.lock, dt * 3);
      const cx = e.x + Math.cos(e.lock) * 1.3, cz = e.z + Math.sin(e.lock) * 1.3;
      e.tele = { shape: 'circle', x: cx, z: cz, r: d.slamRadius, p: e.st / d.windup };
      if (e.st >= d.windup) {
        e.tele = null;
        if (inCircle(cx, cz, d.slamRadius, P)) hurtPlayer(d.dmg * e.dmgMult, { x: cx, z: cz });
        Bus.emit('slam', cx, cz, d.slamRadius);
        e.state = 'recover';
        e.st = 0;
      }
    } else if (e.state === 'recover') {
      e.st += dt;
      if (e.st >= 1) { e.state = 'chase'; e.cd = d.cooldown * (0.8 + Math.random() * 0.4); }
    } else {
      walk(e, t.dx, t.dz, d.speed * k, dt);
      e.cd -= dt;
      if (t.d < 2.9 && e.cd <= 0) { e.state = 'windup'; e.st = 0; e.lock = t.ang; }
    }
  },

  caster(e, dt, k, P) {
    const t = toP(e, P), d = e.def;
    if (e.state === 'windup') {
      e.st += dt;
      e.tele = { shape: 'circle', x: e.x, z: e.z, r: 1.3, p: e.st / 0.75 };
      if (e.st >= 0.75) {
        e.tele = null;
        const off = Math.random() * Math.PI;
        for (let i = 0; i < 10; i++) enemyShot(e, off + (i / 10) * Math.PI * 2, 6.2, 'ember', d.dmg, { life: 2.6 });
        Bus.emit('enemyShoot', e);
        e.state = 'recover';
        e.st = 0;
      }
    } else if (e.state === 'recover') {
      e.st += dt;
      if (e.st >= 0.5) { e.state = 'chase'; e.cd = d.cooldown * (0.8 + Math.random() * 0.4); e.data.strafe = -(e.data.strafe || 1); }
    } else {
      e.data.strafe = e.data.strafe || (chance(0.5) ? 1 : -1);
      const want = t.d > 8 ? 1 : t.d < 5.5 ? -1 : 0;
      walk(e, t.dx * want - t.dz * e.data.strafe * 0.5, t.dz * want + t.dx * e.data.strafe * 0.5, d.speed * k, dt);
      e.ang = t.ang;
      e.cd -= dt;
      if (e.cd <= 0) { e.state = 'windup'; e.st = 0; }
    }
  },

  // ---- Bosses ----

  sentinel(e, dt, k, P) {
    const t = toP(e, P), d = e.def, hpr = e.hp / e.maxHp;
    const summon = (n) => {
      for (let i = 0; i < n; i++) {
        const p = freePoint(Ch.room, P, 3.5, 1.2);
        if (p) spawnEnemy('wretch', p.x, p.z);
      }
      Bus.emit('roar', e);
    };
    if (!e.data.s1 && hpr < 0.66) { e.data.s1 = true; summon(3); }
    if (!e.data.s2 && hpr < 0.33) { e.data.s2 = true; summon(4); }
    switch (e.state) {
      case 'chase': {
        walk(e, t.dx, t.dz, d.speed * k, dt);
        e.cd -= dt;
        if (e.cd > 0) break;
        const wave = hpr < 0.6 && chance(0.35);
        e.state = wave ? 'wave' : t.d < 4.5 ? 'sweep' : chance(0.6) ? 'charge' : 'sweep';
        e.st = 0;
        e.lock = t.ang;
        break;
      }
      case 'sweep':
        e.st += dt;
        if (e.st < 0.3) e.lock = turnTo(e.lock, t.ang, dt * 3);
        e.ang = e.lock;
        if (e.st < 0.25 && t.d > 3) walk(e, t.dx, t.dz, d.speed * 1.5, dt);
        e.tele = { shape: 'cone', x: e.x, z: e.z, ang: e.lock, r: 4.8, arc: 2.6, p: e.st / 0.8 };
        if (e.st >= 0.8) {
          e.tele = null;
          if (inCone(e, P, e.lock, 4.8, 2.6)) hurtPlayer(d.dmg, e);
          Bus.emit('enemyAttack', e);
          Bus.emit('slam', e.x + Math.cos(e.lock) * 2.5, e.z + Math.sin(e.lock) * 2.5, 2);
          e.state = 'recover';
          e.st = 0;
        }
        break;
      case 'charge':
        e.st += dt;
        if (e.st < 0.65) e.lock = turnTo(e.lock, t.ang, dt * 3);
        e.ang = e.lock;
        e.tele = { shape: 'line', x: e.x, z: e.z, ang: e.lock, len: 16, w: 2, p: e.st / 0.95 };
        if (e.st >= 0.95) { e.tele = null; e.state = 'charging'; e.st = 0; e.hitPlayer = false; Bus.emit('enemyAttack', e); }
        break;
      case 'charging':
        e.st += dt;
        e.x += Math.cos(e.lock) * 15 * dt;
        e.z += Math.sin(e.lock) * 15 * dt;
        if (!e.hitPlayer && Math.hypot(P.x - e.x, P.z - e.z) < e.r + P.r + 0.2) e.hitPlayer = hurtPlayer(d.dmg * 1.2, e);
        if (collide(Ch.room, e, e.r) || e.st > 1.1) {
          Bus.emit('slam', e.x, e.z, 1.6);
          e.state = 'stunned';
          e.st = 0;
        }
        break;
      case 'stunned':
        e.st += dt;
        if (e.st >= 1.1) { e.state = 'chase'; e.cd = 0.6; }
        break;
      case 'wave':
        e.st += dt;
        e.tele = { shape: 'circle', x: e.x, z: e.z, r: 1.8, p: e.st / 0.8 };
        if (e.st >= 0.8) {
          e.tele = null;
          addHazard({ kind: 'ring', owner: 'enemy', x: e.x, z: e.z, speed: 6.5, max: 14, w: 0.8, dmg: 10 });
          Bus.emit('slam', e.x, e.z, 2.4);
          e.state = 'recover';
          e.st = 0;
        }
        break;
      default:
        e.state = 'recover';
        e.st += dt;
        if (e.st >= 0.75) { e.state = 'chase'; e.cd = 0.5 + Math.random() * 0.7; }
    }
  },

  troll(e, dt, k, P) {
    const t = toP(e, P), d = e.def, hpr = e.hp / e.maxHp;
    const rage = e.data.rage ? 0.7 : 1;
    if (!e.data.rage && hpr < 0.5) {
      e.data.rage = true;
      for (let i = 0; i < 4; i++) {
        const p = freePoint(Ch.room, P, 4, 1);
        if (p) spawnEnemy('bat', p.x, p.z);
      }
      Bus.emit('roar', e);
    }
    switch (e.state) {
      case 'chase': {
        walk(e, t.dx, t.dz, d.speed * k * (rage < 1 ? 1.25 : 1), dt);
        e.cd -= dt;
        if (e.cd > 0) break;
        e.state = t.d < 3.6 ? 'swipe' : chance(0.55) ? 'leap' : 'boulders';
        e.st = 0;
        e.lock = t.ang;
        break;
      }
      case 'swipe':
        e.st += dt;
        e.ang = e.lock;
        e.tele = { shape: 'cone', x: e.x, z: e.z, ang: e.lock, r: 3.9, arc: 2.4, p: e.st / (0.65 * rage) };
        if (e.st >= 0.65 * rage) {
          e.tele = null;
          if (inCone(e, P, e.lock, 3.9, 2.4)) hurtPlayer(d.dmg, e);
          Bus.emit('enemyAttack', e);
          e.state = 'recover';
          e.st = 0;
        }
        break;
      case 'leap': {
        e.st += dt;
        if (!e.data.target) e.data.target = { x: P.x, z: P.z, sx: e.x, sz: e.z };
        const tg = e.data.target, dur = 1.05, a = Math.min(1, e.st / dur);
        e.tele = { shape: 'circle', x: tg.x, z: tg.z, r: 3, p: a };
        e.x = tg.sx + (tg.x - tg.sx) * a;
        e.z = tg.sz + (tg.z - tg.sz) * a;
        e.y = Math.sin(Math.PI * a) * 4;
        e.ang = Math.atan2(tg.z - tg.sz, tg.x - tg.sx);
        if (a >= 1) {
          e.y = 0;
          e.tele = null;
          if (inCircle(tg.x, tg.z, 3, P)) hurtPlayer(d.dmg * 1.15, e);
          for (let i = 0; i < 8; i++) enemyShot(e, (i / 8) * Math.PI * 2, 7, 'rock', 9, { life: 1.4 });
          Bus.emit('slam', e.x, e.z, 3);
          e.data.target = null;
          e.state = 'recover';
          e.st = 0;
        }
        break;
      }
      case 'boulders':
        e.st += dt;
        e.ang = t.ang;
        if (e.st >= 0.5) {
          for (let i = 0; i < 3 + (rage < 1 ? 2 : 0); i++) {
            const ox = i ? (Math.random() - 0.5) * 6 : 0, oz = i ? (Math.random() - 0.5) * 6 : 0;
            addHazard({ kind: 'aoe', owner: 'enemy', x: P.x + ox, z: P.z + oz, r: 1.7, delay: 1.15, dmg: 14, look: 'rock' });
          }
          Bus.emit('enemyAttack', e);
          e.state = 'recover';
          e.st = 0;
        }
        break;
      default:
        e.state = 'recover';
        e.st += dt;
        if (e.st >= 0.8 * rage) { e.state = 'chase'; e.cd = (0.5 + Math.random() * 0.6) * rage; }
    }
  },

  wyrm(e, dt, k, P) {
    const t = toP(e, P), d = e.def, hpr = e.hp / e.maxHp, room = Ch.room;
    const fury = hpr < 0.5;
    if (fury && !e.data.fury) {
      e.data.fury = true;
      Bus.emit('roar', e);
    }
    const pace = fury ? 0.75 : 1;
    switch (e.state) {
      case 'chase': {
        // the Wyrm prowls the far side of its hall, tracking the hero sideways
        const homeZ = -room.D / 2 + 4.5;
        walk(e, clamp(P.x - e.x, -1, 1) * 0.8, clamp(homeZ - e.z, -1, 1), d.speed * k, dt);
        e.ang = turnTo(e.ang, t.ang, dt * 2);
        e.cd -= dt;
        if (e.cd > 0) break;
        const opts = [['breath', 4], ['volley', 3.5]];
        if (t.d < 4.8) opts.push(['tail', 6]);
        if (fury) opts.push(['dive', 2.5]);
        e.state = pickWeighted(opts);
        e.st = 0;
        e.lock = t.ang;
        break;
      }
      case 'breath':
        e.st += dt;
        if (e.st < 0.9 * pace) {
          e.lock = turnTo(e.lock, t.ang, dt * 2.5);
          e.ang = e.lock;
          e.tele = { shape: 'cone', x: e.x, z: e.z, ang: e.lock, r: 10, arc: 1.3, p: e.st / (0.9 * pace) };
        } else {
          e.tele = null;
          const s = (e.st - 0.9 * pace) / 1.5;
          e.data.breathAng = e.lock + (s - 0.5) * 0.9;
          e.ang = e.data.breathAng;
          e.data.breathing = true;
          if ((e.data.tick = (e.data.tick || 0) - dt) <= 0) {
            e.data.tick = 0.3;
            if (inCone(e, P, e.data.breathAng, 10, 0.7)) hurtPlayer(9, e);
          }
          if (s >= 1) { e.data.breathing = false; e.state = 'recover'; e.st = 0; }
        }
        break;
      case 'volley':
        e.st += dt;
        e.ang = t.ang;
        if (e.st >= 0.5 * pace) {
          for (let i = 0; i < 5; i++) {
            const ox = i ? (Math.random() - 0.5) * 7 : 0, oz = i ? (Math.random() - 0.5) * 7 : 0;
            addHazard({ kind: 'aoe', owner: 'enemy', x: P.x + ox, z: P.z + oz, r: 1.6, delay: 1.2, dmg: 14, look: 'fire', lava: fury });
          }
          Bus.emit('enemyShoot', e);
          e.state = 'recover';
          e.st = 0;
        }
        break;
      case 'tail':
        e.st += dt;
        e.tele = { shape: 'circle', x: e.x, z: e.z, r: 4.4, p: e.st / (0.7 * pace) };
        if (e.st >= 0.7 * pace) {
          e.tele = null;
          if (inCircle(e.x, e.z, 4.4, P)) hurtPlayer(d.dmg + 2, e);
          Bus.emit('slam', e.x, e.z, 4.4);
          e.state = 'recover';
          e.st = 0;
        }
        break;
      case 'dive': {
        e.st += dt;
        if (!e.data.target) e.data.target = { x: P.x, z: P.z, sx: e.x, sz: e.z };
        const tg = e.data.target, dur = 1.3, a = Math.min(1, e.st / dur);
        e.tele = { shape: 'circle', x: tg.x, z: tg.z, r: 3.5, p: a };
        e.x = tg.sx + (tg.x - tg.sx) * a;
        e.z = tg.sz + (tg.z - tg.sz) * a;
        e.y = Math.sin(Math.PI * a) * 6;
        if (a >= 1) {
          e.y = 0;
          e.tele = null;
          if (inCircle(tg.x, tg.z, 3.5, P)) hurtPlayer(d.dmg + 4, e);
          addHazard({ kind: 'ring', owner: 'enemy', x: e.x, z: e.z, speed: 7, max: 12, w: 0.8, dmg: 12 });
          Bus.emit('slam', e.x, e.z, 3.5);
          e.data.target = null;
          e.state = 'recover';
          e.st = 0;
        }
        break;
      }
      default:
        e.state = 'recover';
        e.data.breathing = false;
        e.st += dt;
        if (e.st >= 0.8 * pace) { e.state = 'chase'; e.cd = (0.6 + Math.random() * 0.8) * pace; }
    }
  },
};

// ---- Projectiles, hazards, pickups -------------------------------------------------------------------

function updateProjectiles(dt) {
  const P = Ch.player, room = Ch.room;
  for (const p of Ch.projectiles) {
    if (p.homing && P.state !== 'dead') {
      const cur = Math.atan2(p.vz, p.vx), want = Math.atan2(P.z - p.z, P.x - p.x), sp = Math.hypot(p.vx, p.vz);
      const a = turnTo(cur, want, p.homing * dt);
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.life -= dt;
    const lobbed = p.kind === 'rock' || p.kind === 'ember';
    let dead = p.life <= 0;
    if (!dead && !lobbed && blockedAt(room, p.x, p.z, 0.05)) {
      dead = true;
      if (p.owner === 'player') breakUrns(p.x, p.z, 0.3);
    }
    if (Math.abs(p.x) > room.W / 2 + 1 || Math.abs(p.z) > room.D / 2 + 1) dead = true;
    if (p.owner === 'enemy') {
      if (!dead && P.state !== 'dead' && Math.hypot(P.x - p.x, P.z - p.z) < p.r + P.r && hurtPlayer(p.dmg, p)) dead = true;
    } else if (!dead) {
      for (const e of Ch.enemies) {
        if (!e.alive || e.spawnT > 0 || p.hit.has(e)) continue;
        if (Math.hypot(e.x - p.x, e.z - p.z) > p.r + e.r) continue;
        p.hit.add(e);
        const len = Math.hypot(p.vx, p.vz) || 1, heavy = p.kind === 'crystal' || p.pierce;
        dealDamage(e, p.dmg, { src: p.src, dx: p.vx / len, dz: p.vz / len, knock: heavy ? 6 : 2.5, stagger: heavy });
        if (p.kind === 'crystal') {
          crystalImpact(p, e);
          p.landed = true;
        }
        if (!p.pierce) { dead = true; break; }
      }
    }
    if (dead) {
      p.dead = true;
      if (p.kind === 'crystal' && !p.landed) crystalImpact(p, null);
      Bus.emit('projectileEnd', p);
    }
  }
  Ch.projectiles = Ch.projectiles.filter((p) => !p.dead);
}

function updateHazards(dt) {
  const P = Ch.player;
  for (const h of Ch.hazards) {
    h.t += dt;
    if (h.kind === 'aoe') {
      if (!h.fired && h.t >= h.delay) {
        h.fired = true;
        if (h.owner === 'enemy' && inCircle(h.x, h.z, h.r, P)) hurtPlayer(h.dmg, h);
        Bus.emit('blast', h);
        if (h.lava) addHazard({ kind: 'pool', owner: 'enemy', x: h.x, z: h.z, r: h.r * 0.85, life: 4, dps: 10, look: 'lava' });
      }
      if (h.t >= h.delay + 0.25) h.dead = true;
    } else if (h.kind === 'ring') {
      const radius = h.speed * h.t, dp = Math.hypot(P.x - h.x, P.z - h.z);
      if (!h.hitP && Math.abs(dp - radius) < h.w / 2 + P.r * 0.5) h.hitP = hurtPlayer(h.dmg, h);
      if (radius > h.max) h.dead = true;
    } else if (h.kind === 'pool') {
      if ((h.tick -= dt) <= 0) {
        h.tick = 0.4;
        if (h.owner === 'enemy') {
          if (P.state !== 'dash' && inCircle(h.x, h.z, h.r, P)) hurtPlayer(h.dps * 0.4, null, true);
        } else {
          for (const e of enemiesNear(h.x, h.z, h.r)) if (!e.def.flying) dealDamage(e, h.dps * 0.4, { src: 'burn', noCrit: true });
        }
      }
      if (h.t >= h.life) h.dead = true;
    }
  }
  Ch.hazards = Ch.hazards.filter((h) => !h.dead);
  for (const b of Ch.bolts) b.t += dt;
  Ch.bolts = Ch.bolts.filter((b) => b.t < 0.3);
}

function updatePickups(dt) {
  const P = Ch.player;
  for (const k of Ch.pickups) {
    k.t += dt;
    const d = Math.hypot(P.x - k.x, P.z - k.z);
    if ((k.kind === 'gold' || k.kind === 'heal') && d < 2.6 && d > 0.01 && k.t > 0.3) {
      k.x += ((P.x - k.x) / d) * dt * 9;
      k.z += ((P.z - k.z) / d) * dt * 9;
    }
    const back = k.kind === 'crystal' && (k.t > CAST.returnAfter || Ch.cleared);
    if ((d < (k.kind === 'reward' ? 1.1 : 0.85) && k.t > 0.25) || back) {
      k.taken = true;
      collect(k);
    }
  }
  Ch.pickups = Ch.pickups.filter((k) => !k.taken);
}

function collect(k) {
  const P = Ch.player;
  if (k.kind === 'gold') Run.gold += k.value;
  else if (k.kind === 'heal') Run.hp = Math.min(Run.maxHp, Run.hp + k.value);
  else if (k.kind === 'crystal') P.castAmmo = Math.min(P.castMax, P.castAmmo + 1);
  Bus.emit('collect', k);
  if (k.kind === 'reward') takeReward(k.reward);
}

// Rewards that need a choice open a menu; the rest apply at once.
function takeReward(reward) {
  const biome = Ch.biome;
  switch (reward.type) {
    case 'boon': {
      const options = offerBoons(reward.anc);
      if (options.length) {
        Bus.emit('choose', { kind: 'boon', anc: reward.anc, options });
        return;
      }
      Run.gold += 60;
      break;
    }
    case 'fruit': {
      const options = fruitOptions();
      if (options.length) {
        Bus.emit('choose', { kind: 'fruit', options });
        return;
      }
      Run.gold += 60;
      break;
    }
    case 'gold': {
      const n = 45 + biome * 15 + rand(20);
      Run.gold += n;
      Bus.emit('toast', `+${n} or`, REWARDS.gold.color);
      break;
    }
    case 'heart':
      Run.maxHp += 15;
      Run.hp = Ch.kind === 'boss' ? Run.maxHp : Math.min(Run.maxHp, Run.hp + 15);
      Bus.emit('toast', Ch.kind === 'boss' ? '+15 PV max · PV restaurés' : '+15 PV max', REWARDS.heart.color);
      break;
    case 'shard': {
      const n = 8 + biome * 4 + rand(6);
      Meta.shards += n;
      Run.shards += n;
      saveMeta();
      Bus.emit('toast', `+${n} éclats d’âme`, REWARDS.shard.color);
      break;
    }
    case 'forge':
      Run.forge += 1;
      refreshStats();
      Bus.emit('toast', '+15 % de dégâts', REWARDS.forge.color);
      break;
    default:
      break;
  }
  rewardDone();
}

function rewardDone() {
  Ch.rewardTaken = true;
  if (!Ch.doorsOpen && Ch.room.doors.length) {
    Ch.doorsOpen = true;
    Bus.emit('doors');
  }
  saveRun();
}

function chooseOption(choice, opt) {
  if (choice.kind === 'boon' && opt) addBoon(opt);
  else if (choice.kind === 'fruit' && opt) levelBoon(opt);
  if (choice.fromShop) saveRun();
  else rewardDone();
}

function buyItem(item) {
  if (item.sold || Run.gold < item.cost) return null;
  Run.gold -= item.cost;
  item.sold = true;
  let follow = null;
  switch (item.id) {
    case 'heal': Run.hp = Math.min(Run.maxHp, Run.hp + Math.round(Run.maxHp * 0.35)); break;
    case 'heart': Run.maxHp += 15; Run.hp += 15; break;
    case 'defiance': Run.defiance += 1; break;
    case 'fruit': follow = { kind: 'fruit', options: fruitOptions(), fromShop: true }; break;
    case 'boon': {
      const anc = pick(ancientsWithBoons());
      if (anc) follow = { kind: 'boon', anc, options: offerBoons(anc), fromShop: true };
      break;
    }
    default: break;
  }
  Bus.emit('bought', item);
  saveRun();
  return follow && follow.options.length ? follow : null;
}

// ---- Chamber tick ---------------------------------------------------------------------------------

function updateChamber(dt) {
  if (!Ch || Ch.over) return;
  if (Ch.hitstop > 0) {
    Ch.hitstop -= dt;
    return;
  }
  Ch.t += dt;
  Run.time += dt;
  updatePlayer(dt);
  const P = Ch.player, room = Ch.room;
  if (P.state === 'dead') return;
  updateEnemies(dt);
  updateProjectiles(dt);
  updateHazards(dt);
  updatePickups(dt);

  if (Ch.kind === 'combat' && !Ch.cleared && !Ch.enemies.length) {
    Ch.waveDelay -= dt;
    if (Ch.waveDelay <= 0) {
      if (Ch.waveIdx < Ch.waves.length) {
        spawnWave(Ch.waves[Ch.waveIdx++]);
        Ch.waveDelay = 0.8;
      } else {
        Ch.cleared = true;
        Ch.projectiles = Ch.projectiles.filter((p) => p.owner === 'player');
        Ch.pickups.push({ kind: 'reward', x: clamp(P.x * 0.3, -2, 2), z: -1.5, t: 0, reward: Run.reward });
        Bus.emit('cleared');
      }
    }
  }
  if (Ch.kind === 'rest') {
    if (!Ch.fountainUsed && Math.hypot(P.x - room.fountain.x, P.z - room.fountain.z) < 2.1) {
      Ch.fountainUsed = true;
      const heal = Math.round(Run.maxHp * 0.4);
      Run.hp = Math.min(Run.maxHp, Run.hp + heal);
      Bus.emit('fountain', heal);
    }
    const near = Math.hypot(P.x - room.merchant.x, P.z - room.merchant.z) < 2.2;
    if (near && !Ch.nearMerchant) Bus.emit('shop');
    Ch.nearMerchant = near;
  }
  if (Ch.doorsOpen) {
    for (const door of room.doors) {
      if (P.z < -room.D / 2 + P.r + 0.35 && Math.abs(P.x - door.x) < 1.1) {
        nextChamber(door.reward);
        return;
      }
    }
  }
}
