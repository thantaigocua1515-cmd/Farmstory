/* client/js/input.js — keyboard + virtual joystick + touch buttons.
 * Exposes a movement vector; actions go through callbacks wired in main.js.
 */
export function createInput(opts) {
  const keys = new Set();
  const joy = { active: false, id: null, bx: 0, by: 0, dx: 0, dy: 0 };
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  const joyBase = document.getElementById('joyBase');
  const joyKnob = document.getElementById('joyKnob');

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyE') { e.preventDefault(); opts.onAction(); }
    if (e.code === 'Digit1') opts.onTool('hoe');
    if (e.code === 'Digit2') opts.onTool('seeds');
    if (e.code === 'Digit3') opts.onTool('water');
    if (e.code === 'Digit4') opts.onTool('hand');
    if (e.code === 'KeyQ') opts.onSeed();
    if (e.code === 'Escape') opts.onEscape();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // --- virtual joystick: touches starting on the left half (not on buttons) ---
  const RADIUS = 48;
  function onStart(e) {
    for (const t of e.changedTouches) {
      if (joy.active) continue;
      if (t.clientX > window.innerWidth * 0.45) continue;
      if (t.target.closest('#touchBtns, #toolbar, #hud, .modal, #startOverlay, button')) continue;
      joy.active = true; joy.id = t.identifier;
      joy.bx = t.clientX; joy.by = t.clientY; joy.dx = 0; joy.dy = 0;
      joyBase.style.display = 'block';
      joyBase.style.left = (joy.bx - 60) + 'px';
      joyBase.style.top = (joy.by - 60) + 'px';
      joyKnob.style.transform = 'translate(-50%,-50%)';
      e.preventDefault();
    }
  }
  function onMove(e) {
    for (const t of e.changedTouches) {
      if (!joy.active || t.identifier !== joy.id) continue;
      let dx = t.clientX - joy.bx, dy = t.clientY - joy.by;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) { dx = dx / d * RADIUS; dy = dy / d * RADIUS; }
      joy.dx = dx / RADIUS; joy.dy = dy / RADIUS;
      joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      e.preventDefault();
    }
  }
  function onEnd(e) {
    for (const t of e.changedTouches) {
      if (!joy.active || t.identifier !== joy.id) continue;
      joy.active = false; joy.id = null; joy.dx = 0; joy.dy = 0;
      joyBase.style.display = 'none';
    }
  }
  document.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);
  document.addEventListener('touchcancel', onEnd);

  // --- touch buttons ---
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    el.addEventListener('mousedown', (e) => { e.preventDefault(); fn(); });
  };
  bind('btnAct', opts.onAction);
  bind('btnTool', opts.onToolCycle);
  bind('btnSeed', opts.onSeed);
  bind('btnShop', opts.onShop);

  function vector() {
    let mx = 0, my = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my += 1;
    if (joy.active) { mx += joy.dx; my += joy.dy; }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    return { mx, my };
  }

  return { vector, isTouch };
}
