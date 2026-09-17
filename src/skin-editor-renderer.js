'use strict';
/**
 * Skin Editor - its own window (main.js openSkinEditorWindow / the "Skin
 * Editor" nav item in the main window calls anvil.app.openSkinEditor()).
 *
 * Layout follows PMCSkin3D: one large "stage" that shows either the 3D
 * model (paint directly on it - left-click paints, right-drag rotates) or
 * the flat 2D texture grid, toggled, never both at once side by side. That
 * matters for more than looks: a WebGL canvas renders in its own GPU
 * compositing layer, and past experience here showed Chromium can let that
 * bleed visually over neighboring DOM content (e.g. the layers panel)
 * unless the container is explicitly isolated - see `.skin-stage-3d` /
 * `.skin-stage-2d` in skin-editor.css (isolation: isolate; contain: layout
 * paint;) and the fact there's only ever one stage element visible at a
 * time now, not several fighting for the same space.
 *
 * Init order matters here too: every DOM-only control (tools, colors,
 * layers, file actions) is wired up first and unconditionally; the 3D
 * viewer is set up afterward inside its own try/catch, so if WebGL/
 * skinview3d fails for any reason, the rest of the editor still works
 * instead of a single uncaught error silently killing every listener below
 * it in the script.
 *
 * Painting model: each layer is its own offscreen 64x64 canvas. All visible
 * layers are flattened into `compositeCanvas` on every change; that
 * composite is what's shown on screen, what's fed to the 3D preview
 * texture, and what gets exported/uploaded. Painting always targets the
 * active layer's own canvas, never the composite directly.
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return { r: 139, g: 92, b: 246 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function lighten({ r, g, b }, amount = 0.22) {
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

/** Matches this window's theme/accent to whatever the main window is currently set to, so it doesn't look like a different app. */
async function applyTheming() {
  try {
    const settings = await anvil.settings.get();
    document.documentElement.dataset.theme = settings.theme || 'dark';
    document.documentElement.dataset.rounded = settings.roundedUI === false ? 'false' : 'true';
    document.documentElement.dataset.density = settings.uiDensity === 'compact' ? 'compact' : 'comfortable';
    const accent = settings.accentColor || '#8b5cf6';
    const rgb = hexToRgb(accent);
    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--accent-bright', lighten(rgb));
    document.documentElement.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  } catch (err) {
    console.error('Could not load settings for theming - using CSS defaults:', err);
  }
}

// ------------------------------------------------------------- Night sky
function spawnNightSky() {
  const sky = $('#night-sky');
  if (!sky) return;
  for (let i = 0; i < 160; i++) {
    const dot = document.createElement('span');
    dot.className = 'star-dot';
    const size = Math.random() < 0.6 ? 1 : Math.random() < 0.85 ? 1.5 : 2;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.top = `${Math.random() * 100}%`;
    dot.style.left = `${Math.random() * 100}%`;
    dot.style.opacity = (0.35 + Math.random() * 0.65).toFixed(2);
    sky.appendChild(dot);
  }
  for (let i = 0; i < 6; i++) {
    const star = document.createElement('span');
    star.className = 'shooting-star';
    const dist = 260 + Math.random() * 220;
    const duration = 7 + Math.random() * 8;
    const delay = Math.random() * 14;
    let angle;
    if (Math.random() < 0.5) {
      angle = 40 + Math.random() * 40;
      star.style.left = '-6%';
      star.style.top = `${5 + Math.random() * 75}%`;
    } else {
      angle = 30 + Math.random() * 25;
      star.style.top = '-6%';
      star.style.left = `${10 + Math.random() * 45}%`;
    }
    star.style.setProperty('--angle', `${angle.toFixed(1)}deg`);
    star.style.setProperty('--dist', `${dist.toFixed(0)}px`);
    star.style.animationDuration = `${duration.toFixed(1)}s`;
    star.style.animationDelay = `${delay.toFixed(1)}s`;
    sky.appendChild(star);
  }
}

/**
 * Coarse, non-pixel-perfect bounding boxes for the standard 64x64 skin
 * template, used only to paint the "part guide" overlay in 2D mode so
 * people can tell which quadrant is which while they draw. Not used for
 * anything that affects the exported file.
 */
const SKIN_REGIONS = [
  { x: 0, y: 0, w: 32, h: 16, hue: 260 },   // head
  { x: 32, y: 0, w: 32, h: 16, hue: 260 },  // head overlay
  { x: 0, y: 16, w: 16, h: 16, hue: 20 },   // right leg
  { x: 16, y: 16, w: 24, h: 16, hue: 140 }, // body
  { x: 40, y: 16, w: 16, h: 16, hue: 200 }, // right arm
  { x: 0, y: 32, w: 16, h: 16, hue: 20 },   // right leg overlay
  { x: 16, y: 32, w: 24, h: 16, hue: 140 }, // body overlay
  { x: 40, y: 32, w: 16, h: 16, hue: 200 }, // right arm overlay
  { x: 0, y: 48, w: 16, h: 16, hue: 20 },   // left leg overlay
  { x: 16, y: 48, w: 16, h: 16, hue: 20 },  // left leg
  { x: 32, y: 48, w: 16, h: 16, hue: 200 }, // left arm
  { x: 48, y: 48, w: 16, h: 16, hue: 200 }, // left arm overlay
];

// ----------------------------------------------------------------- Layers
const layers = { list: [], activeId: null };
let compositeCanvas, compositeCtx, displayCtx;

function makeLayerSurface() {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}
function newLayerId() {
  return `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function activeLayer() {
  return layers.list.find((l) => l.id === layers.activeId) || layers.list[layers.list.length - 1];
}
function addLayer(name, { activate = true, index = null } = {}) {
  const { canvas, ctx } = makeLayerSurface();
  const layer = { id: newLayerId(), name: name || `Layer ${layers.list.length + 1}`, canvas, ctx, visible: true };
  if (index === null) layers.list.push(layer);
  else layers.list.splice(index, 0, layer);
  if (activate) layers.activeId = layer.id;
  return layer;
}
function resetLayers(name = 'Base') {
  layers.list = [];
  layers.activeId = null;
  skinEditor.undoStack = [];
  skinEditor.redoStack = [];
  addLayer(name);
}
function recomposite() {
  compositeCtx.clearRect(0, 0, 64, 64);
  for (const layer of layers.list) {
    if (layer.visible) compositeCtx.drawImage(layer.canvas, 0, 0);
  }
}
function redrawDisplay() {
  displayCtx.clearRect(0, 0, 64, 64);
  displayCtx.drawImage(compositeCanvas, 0, 0);
}
function refreshAll() {
  recomposite();
  redrawDisplay();
  syncSkinPreview();
}

function renderLayersList() {
  const wrap = $('#skin-layers-list');
  wrap.innerHTML = '';
  for (let i = layers.list.length - 1; i >= 0; i--) {
    const layer = layers.list[i];
    const row = document.createElement('div');
    row.className = 'skin-layer-row' + (layer.id === layers.activeId ? ' active' : '');
    row.innerHTML = `
      <button class="skin-layer-visibility${layer.visible ? '' : ' hidden-layer'}" title="Toggle visibility">${layer.visible ? '&#9679;' : '&#9675;'}</button>
      <span class="skin-layer-name">${escapeHtml(layer.name)}</span>
    `;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.skin-layer-visibility')) return;
      layers.activeId = layer.id;
      renderLayersList();
    });
    row.addEventListener('dblclick', (e) => {
      if (e.target.closest('.skin-layer-visibility')) return;
      const name = prompt('Layer name', layer.name);
      if (name && name.trim()) { layer.name = name.trim(); renderLayersList(); }
    });
    row.querySelector('.skin-layer-visibility').addEventListener('click', (e) => {
      e.stopPropagation();
      layer.visible = !layer.visible;
      refreshAll();
      renderLayersList();
    });
    wrap.appendChild(row);
  }
}

// -------------------------------------------------------- Editor state
const skinEditor = {
  tool: 'pencil',
  brush: 1,
  color: '#8b5cf6',
  model: 'classic',
  zoom: 8,
  showGrid: true,
  showOverlay3d: true,
  animate: false,
  viewer: null,
  viewerReady: false,
  undoStack: [],
  redoStack: [],
  strokeSnapshot: null,
  updateTimer: null,
  gridCtx: null,
};

function currentSkinRgba() {
  const { r, g, b } = hexToRgb(skinEditor.color);
  return [r, g, b, 255];
}
function setSkinColor(hex) {
  skinEditor.color = hex;
  $('#skin-color-custom').value = hex;
  $('#skin-color-hex').value = hex;
  $$('#skin-color-swatches .swatch').forEach((b) => b.classList.toggle('active', b.dataset.color.toLowerCase() === hex.toLowerCase()));
}
function setSkinModel(variant) {
  skinEditor.model = variant === 'slim' ? 'slim' : 'classic';
  $$('#skin-model-segmented .segmented-btn').forEach((b) => b.classList.toggle('active', b.dataset.model === skinEditor.model));
  syncSkinPreview();
}
function applyZoom() {
  const size = 64 * skinEditor.zoom;
  const frame = $('#skin-canvas-frame');
  frame.style.width = `${size}px`;
  frame.style.height = `${size}px`;
}
function drawSkinGrid() {
  const ctx = skinEditor.gridCtx;
  if (!ctx) return;
  ctx.clearRect(0, 0, 64, 64);
  if (!skinEditor.showGrid) return;
  for (const r of SKIN_REGIONS) {
    ctx.fillStyle = `hsla(${r.hue}, 70%, 60%, 0.10)`;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = `hsla(${r.hue}, 70%, 65%, 0.35)`;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(r.x + 0.25, r.y + 0.25, r.w - 0.5, r.h - 0.5);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.25;
  for (let i = 8; i < 64; i += 8) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 64); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(64, i); ctx.stroke();
  }
}
function canvasPixelFromEvent(e) {
  const canvas = $('#skin-edit-canvas');
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * 64);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * 64);
  return { x: Math.max(0, Math.min(63, x)), y: Math.max(0, Math.min(63, y)) };
}
function applyBrush(ctx, cx, cy, size, rgba, erase) {
  const half = Math.floor(size / 2);
  const style = `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, 1)`;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x = cx - half + dx;
      const y = cy - half + dy;
      if (x < 0 || y < 0 || x > 63 || y > 63) continue;
      ctx.clearRect(x, y, 1, 1);
      if (!erase) { ctx.fillStyle = style; ctx.fillRect(x, y, 1, 1); }
    }
  }
}
function lineTo(x0, y0, x1, y1, cb) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}
function floodFill(ctx, x, y, rgba) {
  const img = ctx.getImageData(0, 0, 64, 64);
  const data = img.data;
  const idx = (px, py) => (py * 64 + px) * 4;
  const start = idx(x, y);
  const target = [data[start], data[start + 1], data[start + 2], data[start + 3]];
  const [nr, ng, nb, na] = rgba;
  if (target[0] === nr && target[1] === ng && target[2] === nb && target[3] === na) return;
  const same = (i) => data[i] === target[0] && data[i + 1] === target[1] && data[i + 2] === target[2] && data[i + 3] === target[3];
  const seen = new Uint8Array(64 * 64);
  const stack = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop();
    if (px < 0 || py < 0 || px > 63 || py > 63) continue;
    const si = py * 64 + px;
    if (seen[si]) continue;
    const i = idx(px, py);
    if (!same(i)) continue;
    seen[si] = 1;
    data[i] = nr; data[i + 1] = ng; data[i + 2] = nb; data[i + 3] = na;
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  ctx.putImageData(img, 0, 0);
}

function beginStroke() {
  const layer = activeLayer();
  skinEditor.strokeSnapshot = { layerId: layer.id, imageData: layer.ctx.getImageData(0, 0, 64, 64) };
}
function commitStroke() {
  if (!skinEditor.strokeSnapshot) return;
  skinEditor.undoStack.push(skinEditor.strokeSnapshot);
  if (skinEditor.undoStack.length > 60) skinEditor.undoStack.shift();
  skinEditor.redoStack.length = 0;
  skinEditor.strokeSnapshot = null;
}
function undoSkinEdit() {
  if (!skinEditor.undoStack.length) return;
  const snap = skinEditor.undoStack.pop();
  const layer = layers.list.find((l) => l.id === snap.layerId);
  if (!layer) { undoSkinEdit(); return; }
  skinEditor.redoStack.push({ layerId: layer.id, imageData: layer.ctx.getImageData(0, 0, 64, 64) });
  layer.ctx.putImageData(snap.imageData, 0, 0);
  refreshAll();
}
function redoSkinEdit() {
  if (!skinEditor.redoStack.length) return;
  const snap = skinEditor.redoStack.pop();
  const layer = layers.list.find((l) => l.id === snap.layerId);
  if (!layer) { redoSkinEdit(); return; }
  skinEditor.undoStack.push({ layerId: layer.id, imageData: layer.ctx.getImageData(0, 0, 64, 64) });
  layer.ctx.putImageData(snap.imageData, 0, 0);
  refreshAll();
}

function handleToolAt(x, y) {
  const tool = skinEditor.tool;
  const layer = activeLayer();
  if (tool === 'pencil' || tool === 'eraser') {
    applyBrush(layer.ctx, x, y, skinEditor.brush, currentSkinRgba(), tool === 'eraser');
    refreshAll();
  } else if (tool === 'fill') {
    floodFill(layer.ctx, x, y, currentSkinRgba());
    refreshAll();
  } else if (tool === 'eyedropper') {
    const d = compositeCtx.getImageData(x, y, 1, 1).data;
    if (d[3] > 0) {
      const hex = `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      setSkinColor(hex);
    }
    skinEditor.strokeSnapshot = null;
  }
}

// ------------------------------------------------------------- 3D preview
function applyOverlayVisibility() {
  const v = skinEditor.viewer;
  if (!v?.playerObject?.skin) return;
  ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'].forEach((part) => {
    const bp = v.playerObject.skin[part];
    if (bp?.outerLayer) bp.outerLayer.visible = skinEditor.showOverlay3d;
  });
}
function applyAnimation() {
  const v = skinEditor.viewer;
  if (!v) return;
  v.animation = skinEditor.animate ? new skinview3d.WalkingAnimation() : null;
  if (v.animation) v.animation.speed = 0.7;
}
function syncSkinPreview() {
  if (!skinEditor.viewerReady) return;
  clearTimeout(skinEditor.updateTimer);
  skinEditor.updateTimer = setTimeout(() => {
    try {
      skinEditor.viewer.loadSkin(compositeCanvas, { model: skinEditor.model === 'slim' ? 'slim' : 'default' });
      applyOverlayVisibility();
    } catch (err) {
      console.error('3D preview texture update failed:', err);
    }
  }, 60);
}

let paint3dDown = false;

/** Painting is the default interaction in 3D mode here, same as PMCSkin3D: left-click paints, right-drag rotates, scroll zooms. No separate mode toggle needed. */
function setupSkin3DPaint() {
  const canvas = $('#skin-3d-canvas');
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  skinEditor.viewer.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

  function pickTexel(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, skinEditor.viewer.camera);
    const hits = raycaster.intersectObject(skinEditor.viewer.playerObject, true);
    const hit = hits.find((h) => h.uv);
    if (!hit) return null;
    return {
      x: Math.max(0, Math.min(63, Math.floor(hit.uv.x * 64))),
      y: Math.max(0, Math.min(63, Math.floor((1 - hit.uv.y) * 64))),
    };
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const texel = pickTexel(e);
    if (!texel) return;
    canvas.setPointerCapture(e.pointerId);
    paint3dDown = true;
    beginStroke();
    handleToolAt(texel.x, texel.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!paint3dDown) return;
    const tool = skinEditor.tool;
    if (tool !== 'pencil' && tool !== 'eraser') return;
    const texel = pickTexel(e);
    if (!texel) return;
    applyBrush(activeLayer().ctx, texel.x, texel.y, skinEditor.brush, currentSkinRgba(), tool === 'eraser');
    refreshAll();
  });
  window.addEventListener('pointerup', () => {
    if (!paint3dDown) return;
    paint3dDown = false;
    commitStroke();
  });
}

// --------------------------------------------------------------- Loading
function loadSkinFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resetLayers('Base');
      const layer = activeLayer();
      if (img.height <= 32) layer.ctx.drawImage(img, 0, 0, 64, 32, 0, 0, 64, 32);
      else layer.ctx.drawImage(img, 0, 0, 64, 64, 0, 0, 64, 64);
      refreshAll();
      renderLayersList();
      resolve();
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// -------------------------------------------------------------- Wiring
function wireViewModeToggle() {
  $$('#skin-viewmode-segmented .segmented-btn').forEach((btn) => btn.addEventListener('click', () => {
    const mode = btn.dataset.viewmode;
    if (mode === '3d' && !skinEditor.viewerReady) {
      toast('3D preview isn\u2019t available right now \u2014 staying in 2D', true);
      return;
    }
    $$('#skin-viewmode-segmented .segmented-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $('#skin-stage-3d').hidden = mode !== '3d';
    $('#skin-stage-2d').hidden = mode !== '2d';
    $('#skin-cursor-pos').textContent = mode === '2d' ? 'Pixel: —' : '\u00A0';
  }));
}

function wireToolButtons() {
  $$('#skin-tool-row .skin-tool-btn').forEach((btn) => btn.addEventListener('click', () => {
    $$('#skin-tool-row .skin-tool-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    skinEditor.tool = btn.dataset.tool;
  }));

  $$('#skin-brush-segmented .segmented-btn').forEach((btn) => btn.addEventListener('click', () => {
    $$('#skin-brush-segmented .segmented-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    skinEditor.brush = Number(btn.dataset.brush);
  }));

  $$('#skin-color-swatches .swatch').forEach((btn) => btn.addEventListener('click', () => setSkinColor(btn.dataset.color)));
  $('#skin-color-custom').addEventListener('input', (e) => setSkinColor(e.target.value));
  $('#skin-color-hex').addEventListener('change', (e) => {
    let v = e.target.value.trim();
    if (v && !v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) setSkinColor(v);
    else e.target.value = skinEditor.color;
  });

  $$('#skin-model-segmented .segmented-btn').forEach((btn) => btn.addEventListener('click', () => setSkinModel(btn.dataset.model)));

  $('#skin-grid-toggle').classList.add('on');
  $('#skin-grid-toggle').addEventListener('click', () => {
    skinEditor.showGrid = !skinEditor.showGrid;
    $('#skin-grid-toggle').classList.toggle('on', skinEditor.showGrid);
    drawSkinGrid();
  });

  $('#skin-overlay-toggle').addEventListener('change', (e) => {
    skinEditor.showOverlay3d = e.target.checked;
    applyOverlayVisibility();
  });
  $('#skin-animate-toggle').addEventListener('change', (e) => {
    skinEditor.animate = e.target.checked;
    applyAnimation();
  });

  $('#skin-zoom').addEventListener('input', (e) => {
    skinEditor.zoom = Number(e.target.value);
    $('#skin-zoom-value').textContent = `${skinEditor.zoom}x`;
    applyZoom();
  });

  $('#btn-skin-undo').addEventListener('click', undoSkinEdit);
  $('#btn-skin-redo').addEventListener('click', redoSkinEdit);
}

function wireLayerButtons() {
  $('#btn-layer-add').addEventListener('click', () => {
    addLayer(`Layer ${layers.list.length + 1}`);
    refreshAll();
    renderLayersList();
  });
  $('#btn-layer-duplicate').addEventListener('click', () => {
    const src = activeLayer();
    const idx = layers.list.indexOf(src);
    const copy = addLayer(`${src.name} copy`, { index: idx + 1 });
    copy.ctx.drawImage(src.canvas, 0, 0);
    refreshAll();
    renderLayersList();
  });
  $('#btn-layer-delete').addEventListener('click', () => {
    if (layers.list.length <= 1) { toast('At least one layer has to stay', true); return; }
    const idx = layers.list.findIndex((l) => l.id === layers.activeId);
    layers.list.splice(idx, 1);
    layers.activeId = layers.list[Math.max(0, idx - 1)].id;
    refreshAll();
    renderLayersList();
  });
  $('#btn-layer-up').addEventListener('click', () => {
    const idx = layers.list.findIndex((l) => l.id === layers.activeId);
    if (idx >= layers.list.length - 1) return;
    [layers.list[idx], layers.list[idx + 1]] = [layers.list[idx + 1], layers.list[idx]];
    refreshAll();
    renderLayersList();
  });
  $('#btn-layer-down').addEventListener('click', () => {
    const idx = layers.list.findIndex((l) => l.id === layers.activeId);
    if (idx <= 0) return;
    [layers.list[idx], layers.list[idx - 1]] = [layers.list[idx - 1], layers.list[idx]];
    refreshAll();
    renderLayersList();
  });
}

function wireFileActions() {
  $('#btn-skin-new').addEventListener('click', () => {
    if (!confirm('Start a new blank skin? This clears all current layers.')) return;
    resetLayers('Base');
    refreshAll();
    renderLayersList();
  });

  $('#btn-skin-load-current').addEventListener('click', async () => {
    const account = await anvil.auth.current().catch(() => null);
    if (!account) { toast('Sign in first — Accounts tab in the main window', true); return; }
    const skin = await anvil.skins.current().catch(() => null);
    if (!skin) { toast('No skin found on that account (offline account, or default Steve/Alex)', true); return; }
    await loadSkinFromDataUrl(skin.dataUrl);
    setSkinModel(skin.variant);
    toast('Loaded your current skin');
  });

  $('#btn-skin-import').addEventListener('click', async () => {
    const res = await anvil.skins.importFile().catch(() => null);
    if (!res) return;
    await loadSkinFromDataUrl(res.dataUrl);
    toast('Skin imported');
  });

  $('#btn-skin-export').addEventListener('click', async () => {
    const dataUrl = compositeCanvas.toDataURL('image/png');
    const ok = await anvil.skins.exportFile(dataUrl, 'nyx-skin.png').catch(() => false);
    if (ok) toast('Skin saved');
  });

  $('#btn-skin-upload').addEventListener('click', async () => {
    const account = await anvil.auth.current().catch(() => null);
    if (!account) { toast('Sign in first — Accounts tab in the main window', true); return; }
    const btn = $('#btn-skin-upload');
    const prevLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const dataUrl = compositeCanvas.toDataURL('image/png');
      await anvil.skins.upload(dataUrl, skinEditor.model);
      toast('Skin uploaded to your account');
    } catch (err) {
      toast(err.message || String(err), true);
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  });
}

function setup2DCanvas() {
  const editCanvas = $('#skin-edit-canvas');
  displayCtx = editCanvas.getContext('2d');
  displayCtx.imageSmoothingEnabled = false;
  skinEditor.gridCtx = $('#skin-grid-canvas').getContext('2d');

  const comp = makeLayerSurface();
  compositeCanvas = comp.canvas;
  compositeCtx = comp.ctx;

  resetLayers('Base');
  renderLayersList();
  drawSkinGrid();
  applyZoom();

  let isDown = false, lastX = null, lastY = null;
  editCanvas.addEventListener('pointerdown', (e) => {
    isDown = true;
    editCanvas.setPointerCapture(e.pointerId);
    const { x, y } = canvasPixelFromEvent(e);
    beginStroke();
    handleToolAt(x, y);
    lastX = x; lastY = y;
  });
  editCanvas.addEventListener('pointermove', (e) => {
    const { x, y } = canvasPixelFromEvent(e);
    if ($('#skin-stage-2d').hidden === false) $('#skin-cursor-pos').textContent = `Pixel: ${x}, ${y}`;
    if (!isDown || (skinEditor.tool !== 'pencil' && skinEditor.tool !== 'eraser')) return;
    const layer = activeLayer();
    lineTo(lastX, lastY, x, y, (px, py) => applyBrush(layer.ctx, px, py, skinEditor.brush, currentSkinRgba(), skinEditor.tool === 'eraser'));
    lastX = x; lastY = y;
    refreshAll();
  });
  editCanvas.addEventListener('pointerleave', () => { $('#skin-cursor-pos').textContent = 'Pixel: —'; });
  window.addEventListener('pointerup', () => {
    if (!isDown) return;
    isDown = false;
    commitStroke();
  });
}

function setup3DViewer() {
  skinEditor.viewer = new skinview3d.SkinViewer({ canvas: $('#skin-3d-canvas'), width: 300, height: 380 });
  skinEditor.viewer.autoRotate = false;
  skinEditor.viewer.zoom = 0.9;
  skinEditor.viewerReady = true;
  applyAnimation();
  setupSkin3DPaint();
}

// ------------------------------------------------------------------ Init
async function init() {
  await applyTheming();
  spawnNightSky();

  wireViewModeToggle();
  wireToolButtons();
  wireLayerButtons();
  wireFileActions();

  setup2DCanvas();

  try {
    setup3DViewer();
  } catch (err) {
    console.error('3D preview failed to initialize - falling back to 2D only:', err);
    $('#skin-stage-3d').hidden = true;
    $('#skin-stage-2d').hidden = false;
    $$('#skin-viewmode-segmented .segmented-btn').forEach((b) => b.classList.toggle('active', b.dataset.viewmode === '2d'));
    toast('3D preview couldn\u2019t start — editing in 2D instead', true);
  }

  refreshAll();
}

init().catch((err) => {
  console.error('Skin editor failed to start:', err);
  toast('Something went wrong starting the editor — check the console (Ctrl+Shift+I) for details', true);
});
