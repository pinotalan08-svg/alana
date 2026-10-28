'use strict';

// Touch, mouse and keyboard. "auto" covers multi-turn actions: walking to a tapped tile, resting.
const Input = { down: null, longTimer: 0, auto: null, autoT: 0 };

const canAct = () => !isOver() && !UI.modal;
const awakeInSight = () => visibleMonsters().some((m) => !m.asleep);

const SWIPE_DIRS = {
  0: [1, 0], 1: [1, 1], 2: [0, 1], 3: [-1, 1], 4: [-1, 0],
  '-4': [-1, 0], '-3': [-1, -1], '-2': [0, -1], '-1': [1, -1],
};

// WASD and ZQSD (AZERTY) both work, plus arrows and the numeric keypad.
const KEYS = {
  arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0],
  w: [0, -1], z: [0, -1], a: [-1, 0], q: [-1, 0], s: [0, 1], d: [1, 0],
  Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
  Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
};

function initInput(canvas) {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', cancelPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey);
  Bus.on('alert', stopAuto);
  Bus.on('floor', stopAuto);
}

function cancelPointer() {
  clearTimeout(Input.longTimer);
  Input.down = null;
}

function onPointerDown(e) {
  if (UI.popFor) {
    // the first tap outside the satchel popover only closes it
    closePop();
    return;
  }
  if (!canAct()) return;
  if (Input.auto) {
    // a tap while walking or resting just stops
    stopAuto();
    return;
  }
  Input.down = { x: e.clientX, y: e.clientY, long: false };
  clearTimeout(Input.longTimer);
  Input.longTimer = setTimeout(() => {
    if (!Input.down) return;
    Input.down.long = true;
    examine(screenToTile(Input.down.x, Input.down.y));
  }, 450);
}

function onPointerMove(e) {
  const d = Input.down;
  if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) clearTimeout(Input.longTimer);
}

function onPointerUp(e) {
  clearTimeout(Input.longTimer);
  const d = Input.down;
  Input.down = null;
  if (!d || d.long || !canAct()) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  if (Math.hypot(dx, dy) > 24) {
    // in third person, swiping up means straight ahead of the camera
    const [mx, my] = V3.active ? relativeDir(dx, dy) : SWIPE_DIRS[Math.round(Math.atan2(dy, dx) / (Math.PI / 4))];
    doMove(mx, my);
  } else {
    tapTile(screenToTile(e.clientX, e.clientY));
  }
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (!$('confirm').hidden) closeConfirm();
    else if (UI.modal === 'pause') showScreen(null);
    else if (UI.modal === 'help' || UI.modal === 'scores') showScreen(UI.back);
    else if (!UI.modal) openPause();
    return;
  }
  if (!canAct()) return;
  Sfx.unlock();
  const dir = KEYS[e.code] || KEYS[e.key.toLowerCase()];
  if (dir) {
    e.preventDefault();
    const [mx, my] = V3.active ? relativeDir(dir[0], dir[1]) : dir;
    doMove(mx, my);
  } else if (e.key === ' ' || e.code === 'Numpad5') {
    e.preventDefault();
    doWait(false);
  } else if (e.key === '.') {
    doWait(true);
  } else if (e.key === '>' || e.key === 'Enter') {
    if (onStairs()) doDescend();
  } else if (/^[1-6]$/.test(e.key) && !e.code.startsWith('Numpad')) {
    doUse(INV_ORDER[+e.key - 1]);
  }
}

// ---- Actions ---------------------------------------------------------------------------------

function doMove(dx, dy) {
  stopAuto();
  closePop();
  playerMove(dx, dy);
}

function doWait(single) {
  stopAuto();
  const p = S.player;
  if (single || p.hp >= p.maxHp || awakeInSight()) {
    waitTurn();
    return;
  }
  log('Tu te reposes un moment…');
  Input.auto = { kind: 'rest', n: 0 };
  Input.autoT = 0;
}

function doDescend() {
  stopAuto();
  playerDescend();
}

function doUse(id) {
  stopAuto();
  if (id) useItem(id);
}

function tapTile(t) {
  const p = S.player;
  const dx = t.x - p.x, dy = t.y - p.y;
  if (!dx && !dy) {
    if (onStairs()) doDescend();
    else doWait(true);
  } else if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
    doMove(dx, dy);
  } else {
    startTravel(t.x, t.y);
  }
}

function isChest(x, y) {
  const it = itemAt(x, y);
  return !!it && it.id === 'chest';
}

function startTravel(tx, ty) {
  const p = S.player;
  const known = inBounds(tx, ty) && S.explored[idx(tx, ty)] && walkable(tx, ty);
  const pass = (x, y) =>
    (x === tx && y === ty) ||
    (S.explored[idx(x, y)] && walkable(x, y) && !(isVisible(x, y) && monsterAt(x, y)) && !isChest(x, y));
  const path = known ? findPath(p.x, p.y, tx, ty, pass) : null;
  if (!path) {
    stepTowards(tx, ty);
    return;
  }
  Input.auto = { kind: 'travel', path };
  Input.autoT = 0;
  View.marker = { x: tx, y: ty };
  autoStep();
}

// For taps on walls or unexplored darkness: one step in that general direction.
function stepTowards(tx, ty) {
  const p = S.player;
  const sx = Math.sign(tx - p.x), sy = Math.sign(ty - p.y);
  for (const [dx, dy] of [[sx, sy], [sx, 0], [0, sy]]) {
    if (!dx && !dy) continue;
    const nx = p.x + dx, ny = p.y + dy;
    if (walkable(nx, ny) || monsterAt(nx, ny)) {
      doMove(dx, dy);
      return;
    }
  }
}

function findPath(sx, sy, tx, ty, pass) {
  const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
  const start = idx(sx, sy), goal = idx(tx, ty);
  const queue = [start];
  prev[start] = start;
  for (let h = 0; h < queue.length && prev[goal] === -1; h++) {
    const i = queue[h], x = i % MAP_W, y = (i / MAP_W) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const j = idx(nx, ny);
      if (prev[j] !== -1 || !pass(nx, ny)) continue;
      prev[j] = i;
      queue.push(j);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let i = goal; i !== start; i = prev[i]) path.push({ x: i % MAP_W, y: (i / MAP_W) | 0 });
  return path.reverse();
}

function stopAuto() {
  Input.auto = null;
  View.marker = null;
}

function tickAuto(dt) {
  if (!Input.auto) return;
  Input.autoT += dt;
  const delay = Input.auto.kind === 'rest' ? 0.03 : 0.085;
  while (Input.auto && Input.autoT >= delay) {
    Input.autoT -= delay;
    autoStep();
  }
}

function autoStep() {
  const a = Input.auto;
  if (!a) return;
  if (!canAct()) return stopAuto();
  const p = S.player, hpBefore = p.hp;
  if (a.kind === 'travel') {
    const next = a.path.shift();
    if (!next || cheb(next.x, next.y, p.x, p.y) !== 1) return stopAuto();
    if (!playerMove(next.x - p.x, next.y - p.y) || !a.path.length) return stopAuto();
  } else {
    if (p.hp >= p.maxHp) {
      log('Tes forces sont revenues.', 'good');
      return stopAuto();
    }
    if (++a.n > 300) return stopAuto();
    waitTurn();
  }
  if (!canAct() || p.hp < hpBefore || awakeInSight()) stopAuto();
}

// Long press: describe what is on a tile.
function examine(t) {
  buzz(10);
  if (!inBounds(t.x, t.y) || !S.explored[idx(t.x, t.y)]) {
    log('Les ténèbres, rien que les ténèbres.');
    return;
  }
  const p = S.player;
  if (t.x === p.x && t.y === p.y) {
    log(`C’est toi : ${p.hp}/${p.maxHp} PV, ATQ ${playerAtk()}, DEF ${playerDef()}.`, 'info');
    return;
  }
  const m = isVisible(t.x, t.y) && monsterAt(t.x, t.y);
  if (m) {
    const d = MONSTERS[m.type];
    log(`${cap(d.name || d.the)} : ${m.hp}/${m.maxHp} PV, ATQ ${m.atk}, DEF ${m.def}.${m.asleep ? ' Zzz…' : ''}`, 'info');
    return;
  }
  const it = itemAt(t.x, t.y);
  if (it && (it.seen || isVisible(t.x, t.y))) {
    const def = itemDef(it.id);
    let text = `${def.name}.`;
    if (it.id === 'gold') text = `${it.n} pièces d’or.`;
    else if (it.id === 'chest') text = 'Un coffre. Que peut-il bien contenir ?';
    else if (def.kind === 'weapon') text = `${def.name} : +${def.atk} ATQ.`;
    else if (def.kind === 'armor') text = `${def.name} : +${def.def} DEF.`;
    else if (def.desc) text = `${def.name} : ${def.desc}`;
    log(text, 'info');
    return;
  }
  const tile = tileAt(t.x, t.y);
  if (tile === T_STAIRS) log('L’escalier vers l’étage suivant.', 'info');
  else if (tile === T_WALL) log('De la pierre, froide et suintante.');
  else log('Le sol, couvert de poussière.');
}
