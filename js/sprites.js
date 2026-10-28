'use strict';

// Every sprite is pixel art written as strings: one character per pixel, '.' is transparent.
// Letters map to PAL, and a sprite can override letters with its own `pal`.
const PAL = {
  K: '#140f1a', W: '#f6f0e2', w: '#c9c1b1', R: '#d8454f', r: '#8e2430',
  O: '#f2a03d', Y: '#f7d154', G: '#79c26a', g: '#3d7a3e', B: '#5b8ee0',
  b: '#2f4f8f', P: '#a46fd8', p: '#5b3a85', S: '#f0c49a', s: '#c98f63',
  N: '#8a5a3a', n: '#5a3a26', L: '#d5d9e2', M: '#9298a8', D: '#555a68',
  C: '#9fe6f2', E: '#ff4a3d', q: '#e9d9ae', k: '#9c8556',
};

const POTION_PX = [
  '...nn...',
  '...ww...',
  '..wXXw..',
  '.wXWXXw.',
  '.wXXXXw.',
  '.wXXXXw.',
  '.wxxxxw.',
  '..wwww..',
];

const SCROLL_PX = [
  '........',
  'NqqqqqqN',
  '.qkkkkq.',
  '.qqqqqq.',
  '.qkkkqq.',
  '.qqqqXX.',
  'NqqqqXXN',
  '........',
];

const ARMOR_PX = [
  'XX....XX',
  'XXX..XXX',
  'XXXXXXXX',
  '.XXXXXX.',
  '.xXXXXx.',
  '.XXXXXX.',
  '.xxxxxx.',
  '..XXXX..',
];

const SWORD_PX = [
  '.......W',
  '......WL',
  '.....WL.',
  '....WL..',
  '.Y.WL...',
  '..Y.....',
  '.N.Y....',
  'N.......',
];

const SPRITES = {
  hero: [
    '..MLLM.W',
    '..LKKL.W',
    '..MSSM.W',
    '.BBBBB.W',
    'S.BBB.YY',
    '..bYb.SN',
    '..B.B...',
    '.nn.nn..',
  ],
  // seen from behind, for the third-person camera
  heroBack: [
    '..MLLM.W',
    '..LLLL.W',
    '..MLLM.W',
    '.BbbbB.W',
    'S.bbb.YY',
    '..bbb.SN',
    '..B.B...',
    '.nn.nn..',
  ],
  rat: [
    '........',
    '........',
    '........',
    '.MM.....',
    'MKMMMM..',
    'MMMMMMM.',
    'K.MMMMMR',
    '..D..D.R',
  ],
  bat: [
    '........',
    'p.P..P.p',
    'ppPPPPpp',
    'pPEPPEPp',
    'p.PPPP.p',
    '..PWWP..',
    '........',
    '........',
  ],
  goblin: [
    '..GGGG..',
    'GGYGGYGG',
    '..GKKG..',
    '.nNNNNn.',
    'G.NNNN.L',
    '..NNNN.G',
    '..G..G..',
    '.gg..gg.',
  ],
  slime: [
    '........',
    '........',
    '...GG...',
    '..GWGG..',
    '.GGGGGG.',
    '.GKGGKG.',
    'GGGGGGGG',
    '.gggggg.',
  ],
  skeleton: [
    '..wwww..',
    '.wKwwKw.',
    '..wKKw..',
    '.wwwwww.',
    'w.wKKw.w',
    '..wwww..',
    '..w..w..',
    '.ww..ww.',
  ],
  wolf: [
    '........',
    'M.M.....',
    'MMM.....',
    'MYMMMMM.',
    'KMMMMMMM',
    '..MMMMM.',
    '..D.D.D.',
    '..D.D.D.',
  ],
  orc: [
    '..gggg..',
    '.gRggRg.',
    '.gWggWg.',
    'DDDDDDDD',
    'g.DDDD.g',
    '..DNND..',
    '..D..D..',
    '.nn..nn.',
  ],
  ghost: {
    pal: { c: '#cdeef5', C: '#9fd8e6' },
    px: [
      '..cccc..',
      '.cccccc.',
      '.cKccKc.',
      '.cccccc.',
      'cccKKccc',
      'cccccccc',
      'cCcCCcCc',
      'C..C..C.',
    ],
  },
  troll: {
    pal: { t: '#7f9f8c', T: '#566f60' },
    px: [
      '..tttt..',
      '.tYttYt.',
      '.ttWWtt.',
      'tTTTTTTt',
      't.TTTT.t',
      't.TnnT.t',
      '..TTTT..',
      '.tt..tt.',
    ],
  },
  demon: [
    'w......w',
    '.wRRRRw.',
    '.RYRRYR.',
    '..RKKR..',
    'rRRRRRRr',
    'r.RRRR.r',
    '..R..R..',
    '.rr..rr.',
  ],
  mimic: [
    '........',
    '.nNNNNn.',
    'nNNNNNNn',
    'WKWKWKWK',
    'KRRRRRRK',
    'KWKWKWKW',
    'nNNYYNNn',
    '.nnnnnn.',
  ],
  wyrm: {
    pal: { R: '#c8323f', r: '#7d1c2a', O: '#f2a03d', o: '#b8661c' },
    px: [
      '....r......r....',
      '...rR......Rr...',
      '...RR......RR...',
      '....RRRRRRRR....',
      '...RRRRRRRRRR...',
      '..RRYKRRRRKYRR..',
      '..RRRRRRRRRRRR..',
      'r.RRRRWRRWRRRR.r',
      'rr.RRRRRRRRRR.rr',
      'rRr.RRRRRRRR.rRr',
      'rRRrRROOOORRrRRr',
      '.rRRRROOOORRRRr.',
      '..rRRRoOOoRRRr..',
      '...RR.oOOo.RR...',
      '..rRR..oo..RRr..',
      '..rr........rr..',
    ],
  },

  potion: { pal: { X: '#d8454f', x: '#8e2430' }, px: POTION_PX },
  elixirStr: { pal: { X: '#f2a03d', x: '#b8661c' }, px: POTION_PX },
  elixirVit: { pal: { X: '#79c26a', x: '#3d7a3e' }, px: POTION_PX },
  scrollFire: { pal: { X: '#d8454f' }, px: SCROLL_PX },
  scrollTele: { pal: { X: '#a46fd8' }, px: SCROLL_PX },
  scrollMap: { pal: { X: '#5b8ee0' }, px: SCROLL_PX },
  gold: [
    '........',
    '........',
    '........',
    '...YY...',
    '..YWYY..',
    '.YYYYOY.',
    'YOYYYYOY',
    '.OOOOOO.',
  ],
  chest: [
    '........',
    '........',
    '.nNNNNn.',
    'nNNNNNNn',
    'YYYYYYYY',
    'nNNYYNNn',
    'nNNNNNNn',
    '.nnnnnn.',
  ],

  dagger: [
    '........',
    '........',
    '......W.',
    '.....W..',
    '..Y.W...',
    '...Y....',
    '..N.Y...',
    '.N......',
  ],
  shortsword: [
    '.......W',
    '......W.',
    '.....W..',
    '....W...',
    '.Y.W....',
    '..Y.....',
    '.N.Y....',
    'N.......',
  ],
  longsword: SWORD_PX,
  axe: [
    '....MLL.',
    '...MLLLL',
    '....NLLL',
    '...N.ML.',
    '..N.....',
    '.N......',
    'N.......',
    '........',
  ],
  runeblade: { pal: { W: '#c9f6ff', L: '#7fd6ea', Y: '#a46fd8', N: '#5b3a85' }, px: SWORD_PX },
  armor0: { pal: { X: '#9a6a3f', x: '#6b4426' }, px: ARMOR_PX },
  armor1: { pal: { X: '#a8adb8', x: '#6f7480' }, px: ARMOR_PX },
  armor2: { pal: { X: '#5d9a6e', x: '#3a6447' }, px: ARMOR_PX },
  armor3: { pal: { X: '#d5d9e2', x: '#8a8fa0' }, px: ARMOR_PX },
  armor4: { pal: { X: '#7a6ad8', x: '#9fe6f2' }, px: ARMOR_PX },

  // HUD and button icons
  heart: [
    '........',
    '.RR..RR.',
    'RWRRRRRR',
    'RRRRRRRR',
    '.RRRRRr.',
    '..RRRr..',
    '...Rr...',
    '........',
  ],
  sword: SWORD_PX,
  shield: [
    'LLLLLLLL',
    'LBBBBBBL',
    'LBBYYBBL',
    'LBYYYYBL',
    'LBBYYBBL',
    '.LBBBBL.',
    '..LBBL..',
    '...LL...',
  ],
  hourglass: [
    'NNNNNNNN',
    '.w....w.',
    '.wYYYYw.',
    '..wYYw..',
    '..w.Yw..',
    '.w..Y.w.',
    '.wYYYYw.',
    'NNNNNNNN',
  ],
  stairs: [
    '........',
    'LLL.....',
    'DDLLL...',
    'KKDDLLL.',
    'KKKKDDLL',
    'KKKKKKDD',
    'KKKKKKKK',
    '........',
  ],
  crown: [
    '........',
    'Y..Y..Y.',
    'YY.Y.YY.',
    'YYYYYYY.',
    'YRYBYRY.',
    'YYYYYYY.',
    'OOOOOOO.',
    '........',
  ],
  skull: [
    '..wwww..',
    '.wwwwww.',
    '.wKwwKw.',
    '.wKwwKw.',
    '..wwww..',
    '..wKwK..',
    '..wwww..',
    '........',
  ],
};

// name -> { img, white, w, h }. `white` is a flat silhouette used for hit flashes.
const SPR = {};

function makeSprite(def) {
  const px = Array.isArray(def) ? def : def.px;
  const pal = Array.isArray(def) ? PAL : { ...PAL, ...def.pal };
  const h = px.length, w = px[0].length;
  const img = document.createElement('canvas');
  const white = document.createElement('canvas');
  img.width = white.width = w;
  img.height = white.height = h;
  const g = img.getContext('2d'), gw = white.getContext('2d');
  gw.fillStyle = '#ffffff';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = px[y][x];
      if (ch === '.' || ch === undefined) continue;
      g.fillStyle = pal[ch] || '#ff00ff';
      g.fillRect(x, y, 1, 1);
      gw.fillRect(x, y, 1, 1);
    }
  }
  return { img, white, w, h };
}

function buildSprites() {
  for (const name of Object.keys(SPRITES)) SPR[name] = makeSprite(SPRITES[name]);
}

const spriteUrlCache = {};
function spriteURL(name, scale = 8) {
  const key = name + '@' + scale;
  if (spriteUrlCache[key]) return spriteUrlCache[key];
  const s = SPR[name];
  const c = document.createElement('canvas');
  c.width = s.w * scale;
  c.height = s.h * scale;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(s.img, 0, 0, c.width, c.height);
  return (spriteUrlCache[key] = c.toDataURL());
}

// ---- Procedural tiles, one set per theme -------------------------------------------------

function buildTileset(themeIndex) {
  const T = THEMES[themeIndex];
  let seed = 1000 + themeIndex * 97;
  const mk = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d');
    draw(g, mulberry32(seed++));
    return c;
  };
  const dot = (g, x, y, color) => {
    g.fillStyle = color;
    g.fillRect(x, y, 1, 1);
  };

  const floorBase = (g, r, alt) => {
    g.fillStyle = alt ? T.floorAlt : T.floor;
    g.fillRect(0, 0, 8, 8);
    if (T.flagstones) {
      g.fillStyle = T.grout;
      g.fillRect(0, 7, 8, 1);
      g.fillRect(7, 0, 1, 8);
    }
    for (let i = 0; i < 4; i++) dot(g, Math.floor(r() * 7), Math.floor(r() * 7), T.speck);
  };

  const floors = [
    mk((g, r) => floorBase(g, r, false)),
    mk((g, r) => floorBase(g, r, true)),
    mk((g, r) => {
      floorBase(g, r, false);
      // a crack
      g.fillStyle = T.grout;
      g.fillRect(1, 2, 2, 1);
      g.fillRect(3, 3, 1, 1);
      g.fillRect(4, 4, 2, 1);
    }),
    mk((g, r) => {
      floorBase(g, r, true);
      // theme decoration: bones, moss, embers, gold dust
      dot(g, 2, 3, T.decoA);
      dot(g, 3, 3, T.decoB);
      dot(g, 4, 4, T.decoA);
      dot(g, 5, 2, T.decoB);
      dot(g, 1, 5, T.decoB);
    }),
  ];

  const wallTop = mk((g, r) => {
    g.fillStyle = T.wallTop;
    g.fillRect(0, 0, 8, 8);
    for (let i = 0; i < 5; i++) dot(g, Math.floor(r() * 8), Math.floor(r() * 8), T.wallTopHi);
  });

  const face = (torch) => mk((g, r) => {
    g.fillStyle = T.wallFace;
    g.fillRect(0, 0, 8, 8);
    if (T.flagstones) {
      g.fillStyle = T.mortar;
      g.fillRect(0, 3, 8, 1);
      g.fillRect(0, 7, 8, 1);
      g.fillRect(4, 0, 1, 3);
      g.fillRect(1, 4, 1, 3);
    } else {
      for (let i = 0; i < 6; i++) dot(g, Math.floor(r() * 8), 1 + Math.floor(r() * 7), T.mortar);
      for (let i = 0; i < 4; i++) dot(g, Math.floor(r() * 8), 1 + Math.floor(r() * 6), T.wallHi);
    }
    g.fillStyle = T.wallHi;
    g.fillRect(0, 0, 8, 1);
    if (torch) {
      dot(g, 3, 5, '#5a3a26');
      dot(g, 4, 5, '#5a3a26');
      dot(g, 3, 4, '#8a5a3a');
      dot(g, 4, 4, '#8a5a3a');
      dot(g, 3, 3, '#f2a03d');
      dot(g, 4, 3, '#f7d154');
      dot(g, 4, 2, '#f2a03d');
    }
  });

  const stairs = mk((g, r) => {
    floorBase(g, r, false);
    g.fillStyle = '#060409';
    g.fillRect(1, 1, 6, 6);
    g.fillStyle = T.wallHi;
    g.fillRect(1, 1, 6, 1);
    g.fillStyle = T.wallFace;
    g.fillRect(2, 3, 5, 1);
    g.fillStyle = T.mortar;
    g.fillRect(3, 5, 4, 1);
  });

  return { floors, wallTop, face: face(false), faceTorch: face(true), stairs };
}
