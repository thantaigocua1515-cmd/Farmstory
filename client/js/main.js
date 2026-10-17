/* client/js/main.js — boot, game loop, HUD, shop, save/load */
import * as sim from './shared/sim.js';
import { makeLocalLink } from './shared/protocol.js';
import { createRenderer, CROP_EMOJI, HAIRS } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const SAVE_KEY = 'sunnyfarm.v1';
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

const renderer = await createRenderer();
const audio = createAudio();
await renderer.loadBase();

let game = null;
let link = null;
let running = false;

const input = createInput({
  onAction: () => { if (running) doPlayerAction(); },
  onTool: (t) => { if (running) setTool(t); },
  onToolCycle: () => { if (running) setTool(sim.cycleTool(game)); },
  onSeed: () => { if (running) { sim.cycleSeed(game); audio.play('ui'); updateHUD(); } },
  onShop: () => { if (running) toggleShop(); },
  onEscape: () => { if (!$('shopModal').classList.contains('hidden')) toggleShop(false); },
});

// ---------- start screen ----------
const hairPick = $('hairPick');
let selHair = 'shorthair';
for (const h of HAIRS) {
  const b = document.createElement('button');
  b.dataset.hair = h;
  if (h === selHair) b.classList.add('sel');
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const strip = renderer.strips['prev_' + h];
  c.getContext('2d').drawImage(strip.img, 0, 0, 96, 64, 0, 0, 96, 64);
  b.appendChild(c);
  b.addEventListener('click', () => {
    selHair = h; audio.play('ui');
    hairPick.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
  });
  hairPick.appendChild(b);
}
if (localStorage.getItem(SAVE_KEY)) $('btnContinue').classList.remove('hidden');

$('btnNew').addEventListener('click', async () => {
  audio.unlock(); audio.play('ui');
  await startGame(sim.createGame((Math.random() * 1e9) | 0), selHair);
});
$('btnContinue').addEventListener('click', async () => {
  audio.unlock(); audio.play('ui');
  await startGame(loadSave() || sim.createGame((Math.random() * 1e9) | 0), null);
});

async function startGame(g, hair) {
  game = g;
  sim.attachMap(game);
  if (hair) game.player.hair = hair;
  link = makeLocalLink(game, sim);
  $('loading').classList.remove('hidden');
  await renderer.loadAnimSet(game.player.hair);
  $('loading').classList.add('hidden');
  $('startOverlay').style.display = 'none';
  for (const id of ['hud', 'toolbar', 'muteBtn']) $(id).classList.remove('hidden');
  if (input.isTouch) $('touchUI').classList.remove('hidden');
  wireToolbar();
  updateHUD();
  audio.startBgm();
  running = true;
  requestAnimationFrame(frame);
  toast('Chào mừng đến nông trại! ⛏️');
  setInterval(save, 15000);
}

// ---------- game loop ----------
let last = performance.now();
function frame(now) {
  if (!running) return;
  const dt = now - last;
  last = now;
  link.sendInput(input.vector(), dt, Math.random);
  renderer.draw(ctx, game, now);
  updateClock();
  requestAnimationFrame(frame);
}

// ---------- actions / HUD ----------
function doPlayerAction() {
  const r = link.doAction();
  if (!r.ok) {
    audio.play('deny');
    toast(directedHint());
    return;
  }
  audio.play(r.type);
  if (r.type === 'harvest') {
    renderer.spawnGlint(game.player.x, game.player.y - 20);
    toast(`+1 ${CROP_EMOJI[r.crop] || '🌾'}`);
  } else if (r.type === 'pickup') {
    toast('🥚 +1 trứng!');
  }
  updateHUD();
}

function directedHint() {
  const t = game.player.tool;
  if (t === 'hoe') return 'Hãy cuốc trên bãi cỏ trong khu ruộng nhé ⛏️';
  if (t === 'seeds') {
    if (game.inv.seeds[game.player.seedSel] <= 0) return 'Hết hạt giống rồi, vào 🛒 mua thêm!';
    return 'Gieo vào ô đất đã cuốc nhé 🌱';
  }
  if (t === 'water') return 'Cây cần tưới là cây chưa ướt 💧';
  return 'Chưa có gì để thu hoạch ✋';
}

function setTool(t) {
  game.player.tool = t;
  audio.play('ui');
  updateHUD();
}

function wireToolbar() {
  document.querySelectorAll('#toolbar .tool').forEach((b) => {
    b.onclick = () => setTool(b.dataset.tool);
  });
  $('seedpick').onclick = () => { sim.cycleSeed(game); audio.play('ui'); updateHUD(); };
}

const SEED_NAME = { carrot: '🥕 Cà rốt', potato: '🥔 Khoai tây', cabbage: '🥬 Bắp cải', wheat: '🌾 Lúa mì', sunflower: '🌻 Hướng dương', pumpkin: '🎃 Bí ngô' };

function updateHUD() {
  $('coins').textContent = game.coins;
  $('day').textContent = game.day;
  document.querySelectorAll('#toolbar .tool').forEach((b) =>
    b.classList.toggle('sel', b.dataset.tool === game.player.tool));
  const s = game.player.seedSel;
  $('seedpick').textContent = `${SEED_NAME[s]} ×${game.inv.seeds[s]}`;
  updateClock();
}
function updateClock() {
  if (!game) return;
  $('clockfill').style.width = Math.round(game.dayTime * 100) + '%';
  const dark = renderer.nightFactor(game.dayTime) > 0.4;
  $('clockicon').textContent = dark ? '🌙' : '☀️';
}

// ---------- toast ----------
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1600);
}

// ---------- shop ----------
function toggleShop(force) {
  const m = $('shopModal');
  const show = force !== undefined ? force : m.classList.contains('hidden');
  m.classList.toggle('hidden', !show);
  if (show) { renderShop(); audio.play('ui'); }
}
$('shopClose').addEventListener('click', () => toggleShop(false));
$('shopModal').addEventListener('click', (e) => { if (e.target.id === 'shopModal') toggleShop(false); });

function renderShop() {
  $('shopCoins').textContent = game.coins;
  const list = $('shopList');
  list.innerHTML = '';
  for (const id of sim.CROP_IDS) {
    const c = sim.CROPS[id];
    const row = document.createElement('div');
    row.className = 'shop-row';
    const can = game.coins >= c.seed;
    row.innerHTML = `<span class="nm">${CROP_EMOJI[id]} ${c.name}</span>
      <span class="own">hạt ×${game.inv.seeds[id]} • thu hoạch ×${game.inv.produce[id]}</span>`;
    const btn = document.createElement('button');
    btn.textContent = `Mua ${c.seed}💰`;
    btn.disabled = !can;
    btn.onclick = () => {
      if (sim.buySeed(game, id)) { audio.play('buy'); renderShop(); updateHUD(); }
      else audio.play('deny');
    };
    row.appendChild(btn);
    list.appendChild(row);
  }
  const eggRow = document.createElement('div');
  eggRow.className = 'shop-row';
  eggRow.innerHTML = `<span class="nm">🥚 Trứng gà</span><span class="own">×${game.inv.eggs}</span>`;
  list.appendChild(eggRow);
  let val = game.inv.eggs * sim.EGG_SELL;
  for (const id of sim.CROP_IDS) val += game.inv.produce[id] * sim.CROPS[id].sell;
  $('sellVal').textContent = val;
  $('sellAll').onclick = () => {
    const gain = sim.sellAll(game);
    if (gain > 0) { audio.play('coin'); toast(`+${gain} 💰`); }
    else { audio.play('deny'); toast('Chưa có gì để bán'); }
    renderShop(); updateHUD();
  };
}

// ---------- mute ----------
$('muteBtn').addEventListener('click', () => {
  const m = audio.toggleMute();
  $('muteBtn').textContent = m ? '🔇' : '🔊';
});

// ---------- save / load ----------
function save() {
  if (!game || !running) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(sim.stripForSave(game))); } catch (e) {}
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const g = sim.createGame(data.seed || 1234);
    Object.assign(g, data);
    return g;
  } catch (e) { return null; }
}
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------- resize ----------
function onResize() { renderer.resize(canvas); }
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
onResize();
