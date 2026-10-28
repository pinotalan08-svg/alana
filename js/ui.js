'use strict';

const SETTINGS_KEY = 'abysses.settings.v2';

const UI = {
  settings: { sound: true, vibrate: true, quality: 'high' },
  screen: 'title', // the open full-screen panel, or null while playing
  back: 'title', // where the help screen returns to
  choice: null,
  last: {}, // last values written to the HUD, to avoid needless DOM writes
  bannerTimer: 0,
  toastTimer: 0,
};

const $ = (id) => document.getElementById(id);
const isPaused = () => UI.screen !== null || !$('confirm').hidden;
const inRun = () => !!(Run && Ch && !Ch.over);

function glyphImg(glyph, color, size = 96, plain = false, alt = '') {
  const img = document.createElement('img');
  img.src = emblemURL(glyph, color, size, plain);
  img.alt = alt;
  return img;
}

function boonEmblem(id, size = 96) {
  const A = ANCIENTS[BOONS[id].anc];
  return glyphImg(A.glyph, A.color, size, false, BOONS[id].name);
}

function initUI() {
  UI.settings = { ...UI.settings, ...store.get(SETTINGS_KEY, {}) };
  Sfx.on = UI.settings.sound;
  document.querySelectorAll('img[data-glyph]').forEach((img) => {
    img.src = emblemURL(img.dataset.glyph, img.dataset.color || '#f1e6d0', 96, true);
  });
  $('shop-emblem').src = emblemURL('coin', '#f7c948', 160);
  refreshToggles();

  $('btn-play').onclick = openHub;
  $('btn-continue').onclick = () => {
    if (resumeRun()) startPlaying();
  };
  $('btn-help').onclick = () => showScreen('help', 'title');
  $('btn-help2').onclick = () => showScreen('help', 'pause');
  document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => showScreen(UI.back)));
  $('btn-sound-title').onclick = toggleSound;
  $('btn-sound').onclick = toggleSound;
  $('btn-vibrate').onclick = toggleVibrate;
  $('btn-quality').onclick = toggleQuality;
  $('btn-pause').onclick = openPause;
  $('btn-resume').onclick = () => showScreen(null);
  $('btn-abandon').onclick = () => askConfirm('Abandonner la descente ? Tes éclats d’âme restent acquis.', 'Abandonner', () => {
    showScreen(null);
    endRun(false);
  });
  $('btn-descend').onclick = () => {
    startRun();
    startPlaying();
  };
  $('btn-hub-title').onclick = showTitle;
  $('btn-shop-leave').onclick = () => showScreen(null);
  $('btn-end').onclick = openHub;
  $('confirm-no').onclick = closeConfirm;
  document.addEventListener('click', (e) => {
    if (e.target.closest('button')) Sfx.play('click');
  });

  Bus.on('chamber', onChamber);
  Bus.on('cleared', () => banner('', 'Salle conquise', 'short'));
  Bus.on('doors', () => toast('Les portes s’ouvrent'));
  Bus.on('boon', (b) => toast(BOONS[b.id].name, ANCIENTS[BOONS[b.id].anc].color));
  Bus.on('choose', openChoice);
  Bus.on('shop', openShop);
  Bus.on('runEnd', showEnd);
  Bus.on('defiance', () => banner('La mort attendra', 'Sursis'));
  Bus.on('fountain', (n) => toast(`La fontaine te rend ${n} PV`, '#7cd8ff'));
  Bus.on('noAmmo', () => toast('Ton éclat est au sol : va le ramasser'));
  Bus.on('dodged', () => toast('Esquivé !', '#a6ec7e'));
  Bus.on('toast', toast);
  Bus.on('bossDown', (e) => banner('Gardien vaincu', e.def.name, 'boss'));
  Bus.on('hurt', () => {
    const v = $('vignette');
    v.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => v.classList.remove('on')));
  });
}

function startPlaying() {
  Sfx.unlock();
  showScreen(null);
}

function onChamber() {
  const biome = BIOMES[Ch.biome];
  UI.last = {};
  $('attack-icon').src = emblemURL(Run.weapon === 'bow' ? 'bow' : 'sword', '#f1e6d0', 96, true);
  renderBoonsHud();
  if (Ch.kind === 'boss') {
    const d = ENEMIES[biome.boss];
    banner(d.title, d.name, 'boss');
  } else if (Ch.kind === 'rest') {
    banner('Un moment de répit', 'Halte');
  } else if (Ch.step === 0) {
    banner(`Profondeur ${Ch.biome + 1}`, biome.name);
  }
}

// ---- HUD ----------------------------------------------------------------------------------------

function setText(id, value) {
  if (UI.last[id] === value) return false;
  UI.last[id] = value;
  $(id).textContent = value;
  return true;
}

function updateHud() {
  if (!inRun()) return;
  const P = Ch.player;
  if (setText('hp-text', `${Math.max(0, Run.hp)} / ${Run.maxHp}`)) {
    const r = Math.max(0, Run.hp) / Run.maxHp;
    $('hp-fill').style.width = `${r * 100}%`;
    $('hp-meter').classList.toggle('low', r <= 0.3);
  }
  setText('gold', String(Run.gold));
  setText('shards', String(Meta.shards));
  if (UI.last.defiance !== Run.defiance) {
    UI.last.defiance = Run.defiance;
    const box = $('defiance');
    box.textContent = '';
    for (let i = 0; i < Run.defiance; i++) box.append(glyphImg('ankh', '#ffd98a', 64, true, 'Sursis'));
  }
  const pips = `${P.dashes}/${P.dashMax}`;
  if (UI.last.pips !== pips) {
    UI.last.pips = pips;
    const box = $('dash-pips');
    box.textContent = '';
    for (let i = 0; i < P.dashMax; i++) {
      const pip = document.createElement('i');
      if (i >= P.dashes) pip.className = 'off';
      box.append(pip);
    }
  }
  setText('cast-ammo', String(P.castAmmo));
  document.querySelector('.act-cast').classList.toggle('empty', P.castAmmo === 0);
  const where = Ch.kind === 'boss' ? 'Gardien' : Ch.kind === 'rest' ? 'Halte' : `Salle ${Ch.step + 1} / ${ROOMS_PER_BIOME}`;
  setText('where-biome', BIOMES[Ch.biome].name);
  setText('where-room', where);
  const boss = Ch.boss;
  const showBoss = !!boss && boss.alive && boss.spawnT <= 0;
  $('bossbar').hidden = !showBoss;
  if (showBoss) {
    setText('boss-name', boss.def.name);
    const w = `${(boss.hp / boss.maxHp) * 100}%`;
    if (UI.last.bossW !== w) {
      UI.last.bossW = w;
      $('boss-fill').style.width = w;
    }
  }
}

function renderBoonsHud() {
  const box = $('boons');
  box.textContent = '';
  for (const b of Run.boons) box.append(boonEmblem(b.id, 64));
}

function banner(sub, main, cls = '') {
  $('banner-sub').textContent = sub;
  $('banner-main').textContent = main;
  const b = $('banner');
  b.className = `show ${cls}`;
  clearTimeout(UI.bannerTimer);
  UI.bannerTimer = setTimeout(() => (b.className = cls), cls === 'short' ? 1100 : 2200);
}

function toast(text, color = '#f1e6d0') {
  const t = $('toast');
  t.textContent = text;
  t.style.color = color;
  t.classList.add('show');
  clearTimeout(UI.toastTimer);
  UI.toastTimer = setTimeout(() => t.classList.remove('show'), 1700);
}

// ---- Screens ------------------------------------------------------------------------------------

function showScreen(name, back) {
  if (back) UI.back = back;
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== `scr-${name}`));
  UI.screen = name || null;
  const overlayOnRun = name === null || name === 'pause' || name === 'choice' || name === 'shop' || (name === 'help' && UI.back === 'pause');
  $('hud').hidden = !(inRun() && overlayOnRun);
  $('controls').hidden = !(inRun() && name === null);
  Input.reset();
  if (name === null) renderBoonsHud();
}

function showTitle() {
  $('btn-continue').hidden = !peekRun();
  $('btn-play').classList.toggle('primary', !peekRun());
  showScreen('title');
}

function openHub() {
  $('hub-shards').textContent = Meta.shards;
  const wbox = $('hub-weapons');
  wbox.textContent = '';
  for (const id of ['sword', 'bow']) {
    const w = WEAPONS[id], locked = id === 'bow' && !Meta.bow;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `weapon${Meta.weapon === id && !locked ? ' on' : ''}`;
    card.append(glyphImg(id, locked ? '#6a5a60' : '#ffd98a', 96, true));
    const name = document.createElement('strong');
    name.textContent = w.name;
    const desc = document.createElement('span');
    desc.textContent = locked ? `Débloquer : ${w.cost} éclats` : w.desc;
    card.append(name, desc);
    card.disabled = locked && Meta.shards < w.cost;
    card.onclick = () => {
      if (locked) unlockBow();
      else {
        Meta.weapon = id;
        saveMeta();
      }
      openHub();
    };
    wbox.append(card);
  }
  const ubox = $('hub-upgrades');
  ubox.textContent = '';
  for (const u of UPGRADES) {
    const lvl = upgradeLevel(u.id), cost = u.costs[lvl];
    const row = document.createElement('div');
    row.className = 'upgrade';
    const name = document.createElement('strong');
    name.textContent = u.name;
    const p = document.createElement('p');
    p.textContent = u.text;
    const levels = document.createElement('div');
    levels.className = 'levels';
    for (let i = 0; i < u.costs.length; i++) {
      const pip = document.createElement('i');
      if (i < lvl) pip.className = 'on';
      levels.append(pip);
    }
    const buy = document.createElement('button');
    buy.type = 'button';
    if (cost === undefined) {
      buy.textContent = 'Max';
      buy.disabled = true;
    } else {
      buy.append(glyphImg('shard', '#c9a8ff', 48, true), document.createTextNode(String(cost)));
      buy.disabled = Meta.shards < cost;
      buy.setAttribute('aria-label', `${u.name} : acheter pour ${cost} éclats`);
      buy.onclick = () => {
        if (buyUpgrade(u.id)) Sfx.play('boon');
        openHub();
      };
    }
    row.append(name, p, levels, buy);
    ubox.append(row);
  }
  $('hub-stats').textContent = Meta.runs
    ? `${Meta.runs} descente${Meta.runs > 1 ? 's' : ''} · ${Meta.wins} victoire${Meta.wins > 1 ? 's' : ''} · record : salle ${Meta.bestRoom} sur ${TOTAL_ROOMS}`
    : 'Ta première descente t’attend.';
  showScreen('hub');
}

function boonCard(opt, kind) {
  const def = BOONS[opt.id], rarity = RARITIES[opt.rarity];
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.style.setProperty('--rarity', rarity.color);
  card.append(boonEmblem(opt.id));
  const tags = document.createElement('div');
  tags.className = 'tags';
  const r = document.createElement('span');
  r.textContent = kind === 'fruit' ? `Niveau ${opt.level} → ${opt.level + 1}` : def.fixed ? 'Unique' : rarity.name;
  const s = document.createElement('span');
  s.textContent = SLOT_NAMES[def.slot];
  tags.append(r, s);
  const name = document.createElement('strong');
  name.textContent = def.name;
  const p = document.createElement('p');
  p.textContent = boonText(kind === 'fruit' ? { ...opt, level: opt.level + 1 } : opt);
  card.append(tags, name, p);
  if (opt.replaces) {
    const rep = document.createElement('span');
    rep.className = 'replace';
    rep.textContent = `Remplace : ${BOONS[opt.replaces.id].name}`;
    card.append(rep);
  }
  return card;
}

function openChoice(choice) {
  UI.choice = choice;
  if (choice.kind === 'boon') {
    const A = ANCIENTS[choice.anc];
    $('choice-emblem').src = emblemURL(A.glyph, A.color, 160);
    $('choice-title').textContent = A.name;
    $('choice-line').textContent = `« ${A.line} »`;
  } else {
    $('choice-emblem').src = emblemURL('fruit', '#ff9b3a', 160);
    $('choice-title').textContent = 'Fruit d’ambre';
    $('choice-line').textContent = 'Choisis la bénédiction à renforcer.';
  }
  const box = $('choice-cards');
  box.textContent = '';
  for (const opt of choice.options) {
    const card = boonCard(opt, choice.kind);
    // a short guard so a thumb still pressing an attack cannot pick a card by accident
    card.disabled = true;
    setTimeout(() => (card.disabled = false), 450);
    card.onclick = () => {
      chooseOption(choice, opt);
      Sfx.play('boon');
      buzz(25);
      if (choice.fromShop) openShop();
      else showScreen(null);
    };
    box.append(card);
  }
  Sfx.play('reward');
  showScreen('choice');
}

function openShop() {
  if (!inRun() || !Ch.shop) return;
  $('shop-gold').textContent = Run.gold;
  const box = $('shop-cards');
  box.textContent = '';
  for (const item of Ch.shop) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.style.setProperty('--rarity', item.color);
    card.append(glyphImg(item.glyph, item.color));
    const tags = document.createElement('div');
    tags.className = 'tags';
    const cost = document.createElement('span');
    cost.className = 'cost';
    cost.textContent = item.sold ? 'Vendu' : `${item.cost} or`;
    tags.append(cost);
    const name = document.createElement('strong');
    name.textContent = item.name;
    const p = document.createElement('p');
    p.textContent = item.text;
    card.append(tags, name, p);
    card.disabled = item.sold || Run.gold < item.cost;
    card.onclick = () => {
      const follow = buyItem(item);
      Sfx.play('buy');
      if (follow) openChoice(follow);
      else openShop();
    };
    box.append(card);
  }
  showScreen('shop');
}

function openPause() {
  if (!inRun() || UI.screen) return;
  $('pause-info').textContent = `${BIOMES[Ch.biome].name} · salle ${Run.room + 1} sur ${TOTAL_ROOMS} · ${Run.kills} ennemis vaincus`;
  const box = $('pause-boons');
  box.textContent = '';
  if (!Run.boons.length) {
    const none = document.createElement('p');
    none.className = 'none';
    none.textContent = 'Aucune bénédiction pour l’instant.';
    box.append(none);
  }
  for (const b of Run.boons) {
    const item = document.createElement('div');
    item.className = 'item';
    const name = document.createElement('strong');
    name.textContent = `${BOONS[b.id].name} · ${SLOT_NAMES[BOONS[b.id].slot]}${b.level > 1 ? ` · niv. ${b.level}` : ''}`;
    name.style.color = RARITIES[b.rarity].color;
    const p = document.createElement('p');
    p.textContent = boonText(b);
    item.append(boonEmblem(b.id, 64), name, p);
    box.append(item);
  }
  showScreen('pause', 'pause');
}

function formatTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m} min ${String(r).padStart(2, '0')} s`;
}

function showEnd(won) {
  const title = $('end-title');
  title.textContent = won ? 'Victoire' : 'Fin de la descente';
  title.classList.toggle('won', won);
  $('end-line').textContent = won
    ? 'Vorgath s’effondre. Les Abysses se taisent, pour un temps.'
    : `${Ch.kind === 'boss' ? `Face à ${ENEMIES[BIOMES[Ch.biome].boss].name}` : Ch.kind === 'rest' ? `${BIOMES[Ch.biome].name}, à la halte` : `${BIOMES[Ch.biome].name}, salle ${Ch.step + 1}`} : les Abysses ont eu le dernier mot. Pas pour longtemps.`;
  const dl = $('end-stats');
  dl.textContent = '';
  const rows = [
    ['Salle atteinte', `${Run.room + 1} sur ${TOTAL_ROOMS}`],
    ['Ennemis vaincus', Run.kills],
    ['Durée', formatTime(Run.time)],
    ['Éclats d’âme gagnés', Run.shards],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const strip = $('end-boons');
  strip.textContent = '';
  for (const b of Run.boons) strip.append(boonEmblem(b.id, 64));
  Sfx.play(won ? 'victory' : 'gameover');
  showScreen('end');
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

function saveSettings() {
  store.set(SETTINGS_KEY, UI.settings);
  refreshToggles();
}

function toggleSound() {
  UI.settings.sound = !UI.settings.sound;
  Sfx.on = UI.settings.sound;
  Sfx.unlock();
  saveSettings();
}

function toggleVibrate() {
  UI.settings.vibrate = !UI.settings.vibrate;
  saveSettings();
  buzz(30);
}

function toggleQuality() {
  UI.settings.quality = UI.settings.quality === 'high' ? 'low' : 'high';
  if (SC.ok) setQuality(UI.settings.quality);
  saveSettings();
}

function refreshToggles() {
  const sound = `Son : ${UI.settings.sound ? 'activé' : 'coupé'}`;
  $('btn-sound').textContent = sound;
  $('btn-sound-title').textContent = sound;
  $('btn-vibrate').textContent = `Vibrations : ${UI.settings.vibrate ? 'activées' : 'coupées'}`;
  $('btn-quality').textContent = `Graphismes : ${UI.settings.quality === 'high' ? 'élevés' : 'économes'}`;
}
