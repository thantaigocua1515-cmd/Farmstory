/* client/js/render.js — Canvas 2D pixel-art renderer. Reads sim state, never mutates. */
import { TILE, MAP_W, MAP_H, T_GRASS, T_PATH, T_WATER, T_FLOWER, CROP_IDS, GROWTH_STAGES } from './shared/sim.js';

const TS_TILE = 16; // source tileset tile size
// Verified uniform tiles in spr_tileset_sunnysideworld_16px.png (tx, ty)
const TILE_SRC = {
  [T_GRASS]: [2, 2],
  [T_WATER]: [4, 1],
  [T_PATH]: [3, 1],
};
const HAIRS = ['bowlhair', 'curlyhair', 'longhair', 'mophair', 'shorthair', 'spikeyhair'];
// anim key -> [dir, file suffix]  (verified filenames in the pack)
const ANIM_FILES = {
  idle: ['IDLE', 'idle_strip9'],
  walk: ['WALKING', 'walk_strip8'],
  dig: ['DIG', 'dig_strip13'],
  watering: ['WATERING', 'watering_strip5'],
  doing: ['DOING', 'doing_strip8'],
};
const CROP_EMOJI = { carrot: '🥕', potato: '🥔', cabbage: '🥬', wheat: '🌾', sunflower: '🌻', pumpkin: '🎃' };

function loadImg(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('missing ' + src));
    // binary assets ship embedded (see tools/embed-assets.mjs); fall back to file
    img.src = (globalThis.SUNNY_DATA && SUNNY_DATA[src]) || src;
  });
}
function framesOf(name) {
  const m = name.match(/strip(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

export async function createRenderer() {
  const R = {
    strips: {}, imgs: {},
    particles: [],
    scale: 2, vw: 0, vh: 0,

    async loadBase() {
      const L = async (key, src) => { R.imgs[key] = await loadImg(src); };
      const S = async (key, src) => {
        const img = await loadImg(src);
        R.strips[key] = { img, frames: framesOf(src), cw: img.width / framesOf(src), ch: img.height };
      };
      await L('tileset', 'assets/tileset16.png');
      await S('chicken', 'assets/Animals/spr_deco_chicken_01_strip4.png');
      await S('tree1', 'assets/Plants/spr_deco_tree_01_strip4.png');
      await S('tree2', 'assets/Plants/spr_deco_tree_02_strip4.png');
      await S('windmill', 'assets/spr_deco_windmill_strip9.png');
      await S('glint', 'assets/VFX/spr_deco_glint_01_strip6.png');
      await L('egg', 'assets/Crops/egg.png');
      for (const id of CROP_IDS)
        for (let s = 0; s < GROWTH_STAGES; s++)
          await L(`crop_${id}_${s}`, `assets/Crops/${id}_0${s}.png`);
      // hair previews for the start screen (idle frame 0)
      for (const h of HAIRS) await S(`prev_${h}`, `assets/Human/IDLE/${h}_idle_strip9.png`);
    },

    // action animations depend on chosen hair — load after start screen
    async loadStrip(src) {
      try {
        const img = await loadImg(src);
        const n = framesOf(src);
        return { img, frames: n, cw: img.width / n, ch: img.height };
      } catch (e) { return null; } // hair layer may be absent for some anims
    },
    async loadAnimSet(hair) {
      for (const [anim, [dir, suf]] of Object.entries(ANIM_FILES)) {
        R.strips['base_' + anim] = await R.loadStrip(`assets/Human/${dir}/base_${suf}.png`);
        R.strips['hair_' + anim] = await R.loadStrip(`assets/Human/${dir}/${hair}_${suf}.png`);
      }
    },

    resize(canvas) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vw = window.innerWidth, vh = window.innerHeight;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      R.vw = vw; R.vh = vh; R.dpr = dpr;
      R.scale = Math.max(2, Math.round(Math.min(vw, vh) / 300));
    },

    spawnGlint(x, y) {
      for (let i = 0; i < 6; i++)
        R.particles.push({ x: x + (Math.random() - 0.5) * 20, y: y - Math.random() * 10, t: 0, life: 500 + Math.random() * 300 });
    },

    draw(ctx, game, timeMs) {
      const S = R.scale, dpr = R.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      // background beyond map
      ctx.fillStyle = '#233d1e';
      ctx.fillRect(0, 0, R.vw, R.vh);

      const viewW = R.vw / S, viewH = R.vh / S;
      const p = game.player;
      let camx = Math.max(0, Math.min(MAP_W * TILE - viewW, p.x - viewW / 2));
      let camy = Math.max(0, Math.min(MAP_H * TILE - viewH, p.y - viewH / 2));
      ctx.scale(S, S);
      ctx.translate(-Math.round(camx), -Math.round(camy));

      const x0 = Math.max(0, Math.floor(camx / TILE) - 1), x1 = Math.min(MAP_W - 1, Math.ceil((camx + viewW) / TILE) + 1);
      const y0 = Math.max(0, Math.floor(camy / TILE) - 1), y1 = Math.min(MAP_H - 1, Math.ceil((camy + viewH) / TILE) + 1);
      const ts = R.imgs.tileset;

      // --- ground tiles ---
      for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++) {
          const t = game.map[ty * MAP_W + tx];
          const src = TILE_SRC[t] || TILE_SRC[T_GRASS];
          ctx.drawImage(ts, src[0] * TS_TILE, src[1] * TS_TILE, TS_TILE, TS_TILE, tx * TILE, ty * TILE, TILE, TILE);
          if (t === T_FLOWER) R.drawFlower(ctx, tx, ty);
        }

      // --- farm plots ---
      for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++) {
          const plot = game.plots[tx + ',' + ty];
          if (plot) R.drawPlot(ctx, game, tx, ty, plot, timeMs);
        }

      // --- eggs on ground ---
      const egg = R.imgs.egg;
      for (const e of game.eggs) {
        if (e.x < camx - 20 || e.x > camx + viewW + 20) continue;
        ctx.drawImage(egg, Math.round(e.x - 5), Math.round(e.y - 6), 10, 10);
      }

      // --- y-sorted: trees, windmill, chickens, player ---
      const ents = [];
      for (const b of game.blockers) {
        if (b.kind === 'tree') ents.push({ y: b.ty * TILE + 14, kind: 'tree', b });
        if (b.kind === 'windmill') ents.push({ y: b.ty * TILE + 16, kind: 'windmill', b });
      }
      game.animals.forEach((a, i) => ents.push({ y: a.y, kind: 'chicken', a, i }));
      ents.push({ y: p.y, kind: 'player' });
      ents.sort((a, b) => a.y - b.y);
      for (const e of ents) {
        if (e.kind === 'tree') R.drawTree(ctx, e.b, timeMs);
        else if (e.kind === 'windmill') R.drawWindmill(ctx, e.b, timeMs);
        else if (e.kind === 'chicken') R.drawChicken(ctx, e.a, e.i, timeMs);
        else R.drawPlayer(ctx, game, timeMs);
      }

      // --- particles ---
      R.particles = R.particles.filter((pt) => pt.t < pt.life);
      const gl = R.strips.glint;
      for (const pt of R.particles) {
        pt.t += 16;
        const f = Math.floor(pt.t / 90) % gl.frames;
        const a = 1 - pt.t / pt.life;
        ctx.globalAlpha = a;
        ctx.drawImage(gl.img, f * gl.cw, 0, gl.cw, gl.ch, pt.x - 10, pt.y - 10 - pt.t * 0.03, 21, 21);
      }
      ctx.globalAlpha = 1;

      // --- night tint ---
      const dark = R.nightFactor(game.dayTime);
      if (dark > 0.02) {
        ctx.fillStyle = `rgba(10, 12, 46, ${(dark * 0.5).toFixed(3)})`;
        ctx.fillRect(camx, camy, viewW, viewH);
      }
    },

    nightFactor(dt) {
      // dayTime 0..1 ; daylight roughly 0.2..0.8
      if (dt < 0.2) return 1 - dt / 0.2;
      if (dt > 0.8) return (dt - 0.8) / 0.2;
      return 0;
    },

    drawFlower(ctx, tx, ty) {
      const h = (tx * 31 + ty * 17) % 4;
      const cols = ['#ff6b81', '#ffd94d', '#ffffff', '#c58aff'];
      const cx = tx * TILE + 4 + (h * 3), cy = ty * TILE + 5 + ((tx + ty) % 3) * 2;
      ctx.fillStyle = '#3f8f2f';
      ctx.fillRect(cx, cy, 1, 4);
      ctx.fillStyle = cols[h];
      ctx.fillRect(cx - 1, cy - 2, 3, 3);
    },

    drawPlot(ctx, game, tx, ty, plot, timeMs) {
      const x = tx * TILE, y = ty * TILE;
      // tilled soil: full-tile mound so it frames the crop
      ctx.fillStyle = plot.crop && plot.crop.watered ? '#5e3a24' : '#7d4c2d';
      ctx.fillRect(x, y + 2, TILE, TILE - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x, y + 2, TILE, 2);
      ctx.fillRect(x, y + TILE - 2, TILE, 2);
      const h = (tx * 13 + ty * 7) % 5;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x + 3 + h, y + 6, 3, 2);
      ctx.fillRect(x + 9 - h, y + 10, 3, 2);
      const c = plot.crop;
      if (!c) return;
      const img = R.imgs[`crop_${c.type}_${c.stage}`];
      if (!img) return;
      // young crops smaller so the soil shows; mature ones overlap a bit
      const k = c.stage < 3 ? 1.5 : 2;
      const dw = img.width * k, dh = img.height * k;
      ctx.drawImage(img, Math.round(x + 8 - dw / 2), Math.round(y + 15 - dh), dw, dh);
      if (c.stage >= GROWTH_STAGES - 1) {
        // sparkle on mature crops
        const gl = R.strips.glint;
        const f = Math.floor(timeMs / 280) % gl.frames;
        const bob = Math.sin(timeMs / 300 + tx) * 2;
        ctx.drawImage(gl.img, f * gl.cw, 0, gl.cw, gl.ch, x + 4, y - 8 + bob, 14, 14);
      } else if (!c.watered) {
        // thirsty hint: tiny blue drop pulsing
        const a = 0.5 + 0.4 * Math.sin(timeMs / 350 + ty);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#4db8ff';
        ctx.fillRect(x + 12, y + 1, 3, 4);
        ctx.globalAlpha = 1;
      }
    },

    drawShadow(ctx, x, y, w) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath();
      ctx.ellipse(x, y, w, w * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    },

    drawPlayer(ctx, game, timeMs) {
      const p = game.player;
      let anim = 'idle';
      if (p.actionT > 0) anim = p.actionKind;
      else if (p.moving) anim = 'walk';
      const base = R.strips['base_' + anim] || R.strips.base_idle;
      const hair = R.strips['hair_' + anim];
      const f = Math.floor(timeMs / (anim === 'walk' ? 110 : 150)) % base.frames;
      const flip = p.facing < 0;
      R.drawShadow(ctx, p.x, p.y + 2, 12);
      ctx.save();
      ctx.translate(Math.round(p.x), Math.round(p.y - 54));
      if (flip) ctx.scale(-1, 1);
      ctx.drawImage(base.img, f * base.cw, 0, base.cw, base.ch, -48, 0, 96, 64);
      if (hair) ctx.drawImage(hair.img, f * hair.cw, 0, hair.cw, hair.ch, -48, 0, 96, 64);
      ctx.restore();
    },

    drawChicken(ctx, a, i, timeMs) {
      const c = R.strips.chicken;
      const f = Math.floor(timeMs / 220 + i * 2) % c.frames;
      R.drawShadow(ctx, a.x, a.y + 4, 8);
      ctx.save();
      ctx.translate(Math.round(a.x), Math.round(a.y - 26));
      if (a.flip) ctx.scale(-1, 1);
      ctx.drawImage(c.img, f * c.cw, 0, c.cw, c.ch, -16, 0, 32, 32);
      ctx.restore();
    },

    drawTree(ctx, b, timeMs) {
      const t = (b.tx + b.ty) % 2 === 0 ? R.strips.tree1 : R.strips.tree2;
      const f = Math.floor(timeMs / 700 + b.tx) % t.frames;
      const x = b.tx * TILE + 8, y = b.ty * TILE + 14;
      ctx.drawImage(t.img, f * t.cw, 0, t.cw, t.ch, Math.round(x - 16), Math.round(y - 30), 32, 34);
    },

    drawWindmill(ctx, b, timeMs) {
      const w = R.strips.windmill;
      const f = Math.floor(timeMs / 160) % w.frames;
      const x = (b.tx + 0.5) * TILE, y = (b.ty + 1) * TILE;
      ctx.drawImage(w.img, f * w.cw, 0, w.cw, w.ch, Math.round(x - 56), Math.round(y - 108), 112, 112);
    },
  };
  return R;
}

export { CROP_EMOJI, HAIRS };
