'use strict';

const SETTINGS_KEY = 'abysses.settings.v1';

const UI = {
  settings: { sound: true, vibrate: true, view: '3d' },
  modal: 'title', // name of the open screen, or null while playing
  back: 'title', // where "Retour" goes from the help and score screens
  popFor: null,
  bannerTimer: 0,
  saveTimer: 0,
};

const $ = (id) => document.getElementById(id);

function initUI() {
  UI.settings = { ...UI.settings, ...store.get(SETTINGS_KEY, {}) };
  Sfx.on = UI.settings.sound;
  document.querySelectorAll('img[data-icon]').forEach((img) => (img.src = spriteURL(img.dataset.icon)));
  buildInventory();
  if (!V3.ok) {
    // no WebGL (or three.js failed to load): the top-down view is the only one
    $('btn-view').hidden = true;
    $('btn-view-title').hidden = true;
  }
  applyViewMode();
  refreshToggles();

  $('btn-menu').onclick = openPause;
  $('btn-act').onclick = actionButton;
  $('pop-use').onclick = () => {
    const id = UI.popFor;
    closePop();
    doUse(id);
  };
  $('btn-continue').onclick = continueRun;
  $('btn-new').onclick = () => {
    if (peekSave()) askConfirm('Une partie est en cours. La remplacer par une nouvelle ?', 'Nouvelle partie', startNewRun);
    else startNewRun();
  };
  $('btn-help').onclick = () => showScreen('help', 'title');
  $('btn-help2').onclick = () => showScreen('help', 'pause');
  $('btn-scores').onclick = () => {
    renderScores();
    showScreen('scores', 'title');
  };
  document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => showScreen(UI.back)));
  $('btn-resume').onclick = () => showScreen(null);
  $('btn-view').onclick = toggleView;
  $('btn-view-title').onclick = toggleView;
  $('btn-sound').onclick = toggleSound;
  $('btn-sound-title').onclick = toggleSound;
  $('btn-vibrate').onclick = toggleVibrate;
  $('btn-quit').onclick = () => {
    saveGame();
    showTitle();
  };
  $('btn-abandon').onclick = () =>
    askConfirm('Abandonner ? La partie sera perdue et comptera comme une défaite.', 'Abandonner', abandonRun);
  $('btn-again').onclick = startNewRun;
  $('btn-title').onclick = showTitle;
  $('confirm-no').onclick = closeConfirm;
  document.addEventListener('click', (e) => {
    if (e.target.closest('button')) Sfx.play('click');
  });

  Bus.on('turn', () => {
    updateHUD();
    renderLog();
    scheduleSave();
  });
  Bus.on('log', renderLog);
  Bus.on('floor', () => {
    updateHUD();
    if (S.floor === MAX_FLOOR) banner(`Étage ${S.floor}`, 'Le Repaire du Wyrm', 'boss');
    else banner(`Étage ${S.floor}`, THEMES[S.theme].name);
    scheduleSave();
  });
  Bus.on('levelup', () => banner('Ta puissance grandit', `Niveau ${S.player.lvl}`, 'gold'));
  Bus.on('boss', () => banner('Le gardien des Abysses', 'Vorgath, le Wyrm', 'boss'));
  // permadeath: drop the save at once, so closing the app during the death animation cannot undo it
  Bus.on('death', () => {
    clearSave();
    setTimeout(showEnd, 1400);
  });
  Bus.on('victory', () => {
    clearSave();
    setTimeout(showEnd, 2200);
  });
}

// ---- HUD -------------------------------------------------------------------------------------

function setIcon(img, name) {
  if (img.dataset.icon === name) return;
  img.dataset.icon = name;
  img.src = spriteURL(name);
}

function updateHUD() {
  if (!S) return;
  const p = S.player;
  const ratio = p.hp / p.maxHp;
  $('hp-fill').style.width = `${ratio * 100}%`;
  $('hp-text').textContent = `${p.hp} / ${p.maxHp}`;
  const meter = $('hp-meter');
  meter.classList.toggle('low', ratio <= 0.3);
  meter.setAttribute('aria-valuenow', p.hp);
  meter.setAttribute('aria-valuemin', 0);
  meter.setAttribute('aria-valuemax', p.maxHp);
  $('atk').textContent = playerAtk();
  $('def').textContent = playerDef();
  $('lvl').textContent = `Niv. ${p.lvl}`;
  $('xp-fill').style.width = `${(p.xp / xpNext(p.lvl)) * 100}%`;
  $('depth').textContent = `Étage ${S.floor}/${MAX_FLOOR}`;
  $('gold').textContent = p.gold;

  for (const b of $('inv').children) {
    const n = S.inv[b.dataset.id] || 0;
    b.classList.toggle('empty', !n);
    b.querySelector('.count').textContent = n > 1 ? n : '';
    b.setAttribute('aria-label', `${CONSUMABLES[b.dataset.id].name} : ${n}`);
  }
  if (UI.popFor) fillPop(UI.popFor);

  const stairs = onStairs() && !isOver();
  $('btn-act').classList.toggle('stairs', stairs);
  $('act-label').textContent = stairs ? 'Descendre' : 'Attendre';
  setIcon($('act-icon'), stairs ? 'stairs' : 'hourglass');

  const boss = S.monsters.find((m) => MONSTERS[m.type].boss);
  $('boss').hidden = !(boss && S.bossSeen);
  if (boss) $('boss-fill').style.width = `${(boss.hp / boss.maxHp) * 100}%`;
}

function renderLog() {
  const ol = $('log');
  ol.textContent = '';
  if (!S) return;
  for (const e of S.log.slice(-4)) {
    const age = S.turn - e.turn;
    if (age > 6) continue;
    const li = document.createElement('li');
    li.textContent = e.text;
    if (e.kind) li.className = e.kind;
    li.style.opacity = age <= 1 ? 1 : age <= 3 ? 0.7 : 0.4;
    ol.appendChild(li);
  }
}

function banner(sub, main, cls = '') {
  $('banner-sub').textContent = sub;
  $('banner-main').textContent = main;
  const b = $('banner');
  b.className = `show ${cls}`;
  clearTimeout(UI.bannerTimer);
  UI.bannerTimer = setTimeout(() => (b.className = cls), 2000);
}

function scheduleSave() {
  clearTimeout(UI.saveTimer);
  UI.saveTimer = setTimeout(saveGame, 250);
}

// ---- Satchel ---------------------------------------------------------------------------------

function buildInventory() {
  const inv = $('inv');
  for (const id of INV_ORDER) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot empty';
    b.dataset.id = id;
    const img = document.createElement('img');
    img.alt = '';
    img.src = spriteURL(CONSUMABLES[id].spr);
    const count = document.createElement('span');
    count.className = 'count';
    b.append(img, count);
    b.addEventListener('click', () => togglePop(id, b));
    inv.appendChild(b);
  }
}

function fillPop(id) {
  const def = CONSUMABLES[id], n = (S && S.inv[id]) || 0;
  $('pop-icon').src = spriteURL(def.spr);
  $('pop-name').textContent = def.name;
  $('pop-count').textContent = n ? `Tu en as ${n}` : 'Tu n’en as aucun';
  $('pop-desc').textContent = def.desc;
  $('pop-use').disabled = !n;
}

function togglePop(id, btn) {
  if (!canAct()) return;
  if (UI.popFor === id) return closePop();
  UI.popFor = id;
  fillPop(id);
  const pop = $('pop');
  pop.hidden = false;
  const sr = $('stage').getBoundingClientRect(), br = btn.getBoundingClientRect();
  const left = clamp(br.left + br.width / 2 - sr.left - pop.offsetWidth / 2, 12, sr.width - pop.offsetWidth - 12);
  pop.style.left = `${left}px`;
  for (const s of $('inv').children) s.classList.toggle('open', s === btn);
}

function closePop() {
  if (!UI.popFor) return;
  UI.popFor = null;
  $('pop').hidden = true;
  for (const s of $('inv').children) s.classList.remove('open');
}

function actionButton() {
  if (!canAct()) return;
  closePop();
  if (onStairs()) doDescend();
  else doWait(false);
}

// ---- Screens ---------------------------------------------------------------------------------

function showScreen(name, back) {
  if (back) UI.back = back;
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== `scr-${name}`));
  UI.modal = name || null;
  closePop();
  View.lastDraw = 0;
}

function showTitle() {
  const save = peekSave();
  const c = $('btn-continue');
  c.hidden = !save;
  if (save) c.textContent = `Continuer · étage ${save.floor}, niv. ${save.lvl}`;
  $('btn-new').classList.toggle('primary', !save);
  showScreen('title');
}

function drawTitle(time) {
  const c = $('title-art');
  const w = Math.round(c.clientWidth * View.dpr), h = Math.round(c.clientHeight * View.dpr);
  if (!w || !h) return;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  drawTitleArt(c, time);
}

function startNewRun() {
  closeConfirm();
  stopAuto();
  clearSave();
  newRun();
  showScreen(null);
  updateHUD();
  renderLog();
  saveGame();
}

function continueRun() {
  stopAuto();
  if (!loadGame()) return startNewRun();
  showScreen(null);
  updateHUD();
  renderLog();
}

function openPause() {
  if (!canAct()) return;
  stopAuto();
  const p = S.player;
  const weapon = p.weapon >= 0 ? `${WEAPONS[p.weapon].name} (+${WEAPONS[p.weapon].atk})` : 'mains nues';
  const armor = p.armor >= 0 ? `${ARMORS[p.armor].name} (+${ARMORS[p.armor].def})` : 'aucune armure';
  $('pause-info').textContent = `Étage ${S.floor} · ${weapon} · ${armor} · ${p.kills} ennemis vaincus`;
  showScreen('pause', 'pause');
}

function abandonRun() {
  S.dead = true;
  S.cause = 'abandon';
  showEnd();
}

function showEnd() {
  if (!S) return;
  const { score, rank } = recordScore();
  clearSave();
  const p = S.player;
  const title = $('end-title');
  title.textContent = S.won ? 'Victoire !' : 'La torche s’éteint';
  title.classList.toggle('won', S.won);
  $('end-cause').textContent = S.won
    ? `Vorgath est tombé. Tu remontes des Abysses après ${S.turn} tours.`
    : S.cause === 'abandon'
      ? `Tu rebrousses chemin à l’étage ${S.floor}.`
      : `${cap(S.cause)} a eu raison de toi à l’étage ${S.floor}.`;
  const dl = $('end-stats');
  dl.textContent = '';
  const rows = [...score.parts, ['Niveau atteint', p.lvl], ['Tours joués', S.turn]];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  $('end-score').textContent = score.total;
  $('end-record').hidden = rank !== 0;
  showScreen('end');
}

function renderScores() {
  const list = store.get(SCORES_KEY, []);
  const ol = $('scores-list');
  ol.textContent = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Aucune partie terminée pour l’instant. La première ligne t’attend.';
    ol.appendChild(li);
    return;
  }
  list.forEach((s, i) => {
    const li = document.createElement('li');
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = i + 1;
    const icon = document.createElement('img');
    icon.alt = s.won ? 'Victoire' : 'Défaite';
    icon.src = spriteURL(s.won ? 'crown' : 'skull');
    const detail = document.createElement('span');
    detail.className = 'detail';
    let date = s.date;
    try {
      date = new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    } catch {
      /* keep ISO date */
    }
    detail.textContent = `Étage ${s.floor} · niv. ${s.lvl} · ${date}`;
    const score = document.createElement('strong');
    score.textContent = s.score;
    li.append(rank, icon, detail, score);
    ol.appendChild(li);
  });
}

function askConfirm(text, okLabel, onOk) {
  $('confirm-text').textContent = text;
  const yes = $('confirm-yes');
  yes.textContent = okLabel;
  yes.onclick = () => {
    closeConfirm();
    onOk();
  };
  $('confirm').hidden = false;
}

function closeConfirm() {
  $('confirm').hidden = true;
}

function toggleSound() {
  UI.settings.sound = !UI.settings.sound;
  Sfx.on = UI.settings.sound;
  store.set(SETTINGS_KEY, UI.settings);
  refreshToggles();
}

function toggleVibrate() {
  UI.settings.vibrate = !UI.settings.vibrate;
  store.set(SETTINGS_KEY, UI.settings);
  refreshToggles();
  buzz(30);
}

function applyViewMode() {
  V3.active = V3.ok && UI.settings.view !== '2d';
  $('view3d').hidden = !V3.active;
  V3.dirty = true;
  V3.lastDraw = 0;
  View.lastDraw = 0;
  View.snap = true;
  if (S) {
    V3.px = S.player.x;
    V3.py = S.player.y;
  }
}

function toggleView() {
  UI.settings.view = UI.settings.view === '2d' ? '3d' : '2d';
  store.set(SETTINGS_KEY, UI.settings);
  applyViewMode();
  refreshToggles();
}

function refreshToggles() {
  const view = `Vue : ${UI.settings.view === '2d' ? 'du dessus' : 'troisième personne'}`;
  $('btn-view').textContent = view;
  $('btn-view-title').textContent = view;
  const sound = `Son : ${UI.settings.sound ? 'activé' : 'coupé'}`;
  $('btn-sound').textContent = sound;
  $('btn-sound-title').textContent = sound;
  $('btn-vibrate').textContent = `Vibrations : ${UI.settings.vibrate ? 'activées' : 'coupées'}`;
}
