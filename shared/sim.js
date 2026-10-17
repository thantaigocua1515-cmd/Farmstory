/* shared/sim.js
 * Pure game simulation for Sunny Farm — ZERO browser/Node dependencies.
 * All game rules live here so the same file can run:
 *   - locally in the browser (single-player, current)
 *   - authoritatively on a server later (multiplayer: client sends INPUT,
 *     server runs stepGame and broadcasts snapshots — see protocol.js)
 *
 * Design rules:
 *  - state is plain JSON (no Map/Set/class instances) → serializable for
 *    save files and network snapshots.
 *  - randomness and time are injected (rng, dtMs) → deterministic + testable.
 *  - rendering NEVER mutates state; input is a plain object per tick.
 */

export const TILE = 16;
export const MAP_W = 48;
export const MAP_H = 36;

// Tiles (indices into the 16px tileset are resolved client-side;
// sim only cares about logical tile kinds)
export const T_GRASS = 0;
export const T_PATH = 1;
export const T_WATER = 2;
export const T_FLOWER = 3;

// Tools
export const TOOL_HOE = 'hoe';
export const TOOL_SEEDS = 'seeds';
export const TOOL_WATER = 'water';
export const TOOL_HAND = 'hand';
export const TOOLS = [TOOL_HOE, TOOL_SEEDS, TOOL_WATER, TOOL_HAND];

// Crops: 6 of the pack's 12 types for a tight MVP (data model supports all)
export const CROPS = {
  carrot:    { name: 'Cà rốt',     seed: 10, sell: 28 },
  potato:    { name: 'Khoai tây',  seed: 14, sell: 36 },
  cabbage:   { name: 'Bắp cải',    seed: 18, sell: 46 },
  wheat:     { name: 'Lúa mì',      seed: 12, sell: 30 },
  sunflower: { name: 'Hướng dương',seed: 22, sell: 55 },
  pumpkin:   { name: 'Bí ngô',      seed: 28, sell: 70 },
};
export const CROP_IDS = Object.keys(CROPS);
export const GROWTH_STAGES = 6;          // files *_00 .. *_05
export const STAGE_MS = 45_000;          // real ms per stage while watered
export const DAY_MS = 360_000;           // 6 real minutes = 1 game day
export const EGG_SELL = 10;
export const PLAYER_SPEED = 95;          // px per second

// Field zone where tilling is allowed (keeps the farm tidy by design)
export const FIELD = { x0: 6, y0: 22, x1: 17, y1: 30 };
// Coop zone where chickens roam
export const COOP = { x0: 30, y0: 24, x1: 40, y1: 32 };

// Deterministic RNG (mulberry32)
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tileAt(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return T_WATER; // treat OOB as blocked
  return map[ty * MAP_W + tx];
}
export function isBlocked(map, tx, ty) {
  const t = tileAt(map, tx, ty);
  return t === T_WATER;
}

// Hand-authored farm layout (deterministic; same for every player/server)
export function buildMap(rng) {
  const map = new Array(MAP_W * MAP_H).fill(T_GRASS);
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) map[y * MAP_W + x] = t; };

  // Pond (ellipse)
  const pcx = 38, pcy = 10, rx = 6, ry = 4;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const dx = (x - pcx) / rx, dy = (y - pcy) / ry;
      if (dx * dx + dy * dy <= 1) set(x, y, T_WATER);
    }

  // Dirt paths: horizontal + vertical cross
  for (let x = 4; x <= 43; x++) set(x, 18, T_PATH);
  for (let y = 4; y <= 31; y++) set(24, y, T_PATH);
  // Path to pond
  for (let x = 30; x <= 36; x++) set(x, 12, T_PATH);

  // Flower patches (decor, deterministic)
  for (let i = 0; i < 26; i++) {
    const x = 2 + Math.floor(rng() * (MAP_W - 4));
    const y = 2 + Math.floor(rng() * (MAP_H - 4));
    if (map[y * MAP_W + x] === T_GRASS) set(x, y, T_FLOWER);
  }
  return map;
}

// Fixed decoration anchors (client draws them; sim blocks them).
// Rects in tile units, inclusive: { x0, y0, x1, y1, kind }
export function buildBlockers() {
  const B = [];
  const tree = (x, y) => B.push({ x0: x, y0: y, x1: x, y1: y, kind: 'tree' });
  [
    [2, 2], [44, 3], [45, 16], [3, 33], [20, 4], [28, 30], [44, 28],
    [10, 14], [14, 8], [33, 20], [8, 34], [26, 8],
  ].forEach(([x, y]) => tree(x, y));
  B.push({ x0: 5, y0: 2, x1: 12, y1: 10, kind: 'house' });    // farmhouse
  B.push({ x0: 19, y0: 19, x1: 21, y1: 29, kind: 'tower' });  // silo
  B.push({ x0: 32, y0: 5, x1: 33, y1: 6, kind: 'windmill' }); // windmill
  return B;
}

export function createGame(seed = 1234) {
  const rng = makeRng(seed);
  const map = buildMap(rng);
  const animals = [];
  for (let i = 0; i < 4; i++) {
    animals.push({
      kind: 'chicken',
      x: (COOP.x0 + 2 + rng() * (COOP.x1 - COOP.x0 - 4)) * TILE,
      y: (COOP.y0 + 2 + rng() * (COOP.y1 - COOP.y0 - 4)) * TILE,
      tx: 0, ty: 0, retarget: rng() * 3000,
      eggTimer: 45_000 + rng() * 60_000,
      flip: false,
    });
  }
  const game = {
    v: 1,
    seed,
    day: 1,
    dayTime: 0.3, // start mid-morning (0..1)
    coins: 120,
    player: {
      x: 24 * TILE + 8, y: 16 * TILE + 8,
      facing: 1, // 1 = right, -1 = left (sprite is single-direction; we flip)
      moving: false,
      tool: TOOL_HOE,
      seedSel: 'carrot',
      hair: 'shorthair',
      actionT: 0, // >0 while playing an action animation
      actionKind: '',
    },
    plots: {}, // "tx,ty" -> { crop: null | { type, stage, growth, watered } }
    inv: {
      seeds: { carrot: 4, potato: 0, cabbage: 0, wheat: 0, sunflower: 0, pumpkin: 0 },
      produce: { carrot: 0, potato: 0, cabbage: 0, wheat: 0, sunflower: 0, pumpkin: 0 },
      eggs: 0,
    },
    animals,
    eggs: [], // {x, y} on the ground
    stats: { harvested: 0, earned: 0 },
  };
  return game;
}

const key = (tx, ty) => tx + ',' + ty;
const inField = (tx, ty) =>
  tx >= FIELD.x0 && tx <= FIELD.x1 && ty >= FIELD.y0 && ty <= FIELD.y1;

/** Tile the player is acting on: tile in front, else tile under feet. */
export function actionTile(game) {
  const p = game.player;
  const cx = p.x + (p.facing === 1 ? 14 : -14);
  const tx = Math.floor(cx / TILE), ty = Math.floor(p.y / TILE);
  if (!isBlocked(game.map, tx, ty)) return { tx, ty };
  return { tx: Math.floor(p.x / TILE), ty: Math.floor(p.y / TILE) };
}

/**
 * Context action for the currently selected tool.
 * Returns { ok, type } — client maps type → sound/toast. Pure state mutation.
 */
export function doAction(game) {
  const p = game.player;
  const { tx, ty } = actionTile(game);
  const k = key(tx, ty);

  if (p.tool === TOOL_HOE) {
    if (!inField(tx, ty) || game.plots[k] || tileAt(game.map, tx, ty) !== T_GRASS)
      return { ok: false, type: 'deny' };
    game.plots[k] = { crop: null };
    p.actionT = 450; p.actionKind = 'dig';
    return { ok: true, type: 'till' };
  }

  if (p.tool === TOOL_SEEDS) {
    const plot = game.plots[k];
    if (!plot || plot.crop || game.inv.seeds[p.seedSel] <= 0)
      return { ok: false, type: 'deny' };
    game.inv.seeds[p.seedSel]--;
    plot.crop = { type: p.seedSel, stage: 0, growth: 0, watered: false };
    p.actionT = 450; p.actionKind = 'doing';
    return { ok: true, type: 'plant' };
  }

  if (p.tool === TOOL_WATER) {
    const plot = game.plots[k];
    if (!plot || !plot.crop || plot.crop.watered || plot.crop.stage >= GROWTH_STAGES - 1)
      return { ok: false, type: 'deny' };
    plot.crop.watered = true;
    p.actionT = 600; p.actionKind = 'watering';
    return { ok: true, type: 'water' };
  }

  // hand: harvest mature crop, else pick up nearby egg
  const plot = game.plots[k];
  if (plot && plot.crop && plot.crop.stage >= GROWTH_STAGES - 1) {
    const type = plot.crop.type;
    game.inv.produce[type]++;
    game.stats.harvested++;
    plot.crop = null; // keep tilled soil for replanting
    p.actionT = 450; p.actionKind = 'doing';
    return { ok: true, type: 'harvest', crop: type };
  }
  const egg = nearestEgg(game, 20);
  if (egg) {
    game.eggs.splice(game.eggs.indexOf(egg), 1);
    game.inv.eggs++;
    p.actionT = 350; p.actionKind = 'doing';
    return { ok: true, type: 'pickup' };
  }
  return { ok: false, type: 'deny' };
}

function nearestEgg(game, maxDist) {
  const p = game.player;
  let best = null, bd = maxDist;
  for (const e of game.eggs) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

export function cycleTool(game) {
  const p = game.player;
  p.tool = TOOLS[(TOOLS.indexOf(p.tool) + 1) % TOOLS.length];
  return p.tool;
}
export function cycleSeed(game) {
  const i = CROP_IDS.indexOf(game.player.seedSel);
  game.player.seedSel = CROP_IDS[(i + 1) % CROP_IDS.length];
  return game.player.seedSel;
}
export function buySeed(game, type) {
  const c = CROPS[type];
  if (!c || game.coins < c.seed) return false;
  game.coins -= c.seed;
  game.inv.seeds[type]++;
  return true;
}
export function sellAll(game) {
  let gain = 0;
  for (const id of CROP_IDS) {
    gain += game.inv.produce[id] * CROPS[id].sell;
    game.inv.produce[id] = 0;
  }
  gain += game.inv.eggs * EGG_SELL;
  game.inv.eggs = 0;
  game.coins += gain;
  game.stats.earned += gain;
  return gain;
}

// map is large-ish; attach lazily so createGame stays JSON-clean for saves.
// (save() strips it; load() rebuilds from seed.)
export function attachMap(game) {
  if (!game.map) game.map = buildMap(makeRng(game.seed));
  if (!game.blockers) game.blockers = buildBlockers();
  return game;
}
export function stripForSave(game) {
  const { map, blockers, ...rest } = game;
  return rest;
}

/**
 * Advance the simulation. input = { mx, my } movement vector (-1..1).
 * Everything time-based uses dtMs so tick rate doesn't matter
 * (local rAF today, fixed server tick tomorrow).
 */
export function stepGame(game, input, dtMs, rng = Math.random) {
  attachMap(game);
  const p = game.player;
  dtMs = Math.min(dtMs, 250); // clamp tab-switch jumps
  const dt = dtMs / 1000;

  // --- movement ---
  const mx = input.mx || 0, my = input.my || 0;
  const len = Math.hypot(mx, my);
  p.moving = len > 0.15;
  if (p.moving) {
    if (Math.abs(mx) > 0.2) p.facing = mx > 0 ? 1 : -1;
    const sp = PLAYER_SPEED * dt * Math.min(1, len);
    const nx = p.x + (mx / (len || 1)) * sp;
    const ny = p.y + (my / (len || 1)) * sp;
    if (!collides(game, nx, p.y)) p.x = nx;
    if (!collides(game, p.x, ny)) p.y = ny;
    p.x = Math.max(8, Math.min(MAP_W * TILE - 8, p.x));
    p.y = Math.max(12, Math.min(MAP_H * TILE - 4, p.y));
  }
  if (p.actionT > 0) p.actionT -= dtMs;

  // walk-over egg pickup (feels good, no button needed)
  const egg = nearestEgg(game, 12);
  if (egg) {
    game.eggs.splice(game.eggs.indexOf(egg), 1);
    game.inv.eggs++;
  }

  // --- crops ---
  for (const k of Object.keys(game.plots)) {
    const plot = game.plots[k];
    const c = plot.crop;
    if (c && c.watered && c.stage < GROWTH_STAGES - 1) {
      c.growth += dtMs;
      if (c.growth >= STAGE_MS) {
        c.growth = 0;
        c.stage++;
        c.watered = false; // each stage needs fresh watering
      }
    }
  }

  // --- day cycle ---
  game.dayTime += dtMs / DAY_MS;
  if (game.dayTime >= 1) {
    game.dayTime -= 1;
    game.day += 1;
  }

  // --- chickens ---
  for (const a of game.animals) {
    a.retarget -= dtMs;
    if (a.retarget <= 0) {
      a.retarget = 2000 + rng() * 4000;
      a.tx = (COOP.x0 + 1 + rng() * (COOP.x1 - COOP.x0 - 2)) * TILE;
      a.ty = (COOP.y0 + 1 + rng() * (COOP.y1 - COOP.y0 - 2)) * TILE;
    }
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      const sp = 32 * dt;
      a.x += (dx / d) * sp;
      a.y += (dy / d) * sp;
      a.flip = dx < 0;
    }
    a.eggTimer -= dtMs;
    if (a.eggTimer <= 0 && game.eggs.length < 12) {
      a.eggTimer = 60_000 + rng() * 60_000;
      game.eggs.push({ x: a.x, y: a.y + 6 });
    }
  }
  return game;
}

function collides(game, x, y) {
  // small player hitbox at feet
  const pts = [[x - 6, y - 2], [x + 6, y - 2], [x - 6, y + 4], [x + 6, y + 4]];
  for (const [px, py] of pts) {
    if (isBlocked(game.map, Math.floor(px / TILE), Math.floor(py / TILE))) return true;
  }
  for (const b of game.blockers) {
    const bx0 = b.x0 * TILE, by0 = b.y0 * TILE;
    const bx1 = (b.x1 + 1) * TILE, by1 = (b.y1 + 1) * TILE;
    if (x + 6 > bx0 && x - 6 < bx1 && y + 4 > by0 && y - 2 < by1) return true;
  }
  return false;
}
