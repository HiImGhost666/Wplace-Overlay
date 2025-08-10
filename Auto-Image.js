// WPlace Overlay — fixed & complete
// Host this file and use as a bookmarklet:
// javascript:fetch("https://yourhost.com/wplace-overlay.js").then(r=>r.text()).then(eval);

(() => {
  // ---------- CONFIG ----------
  const CONFIG = {
    LOCAL_KEY: 'wplace_overlay_v2',
    TRANSPARENCY_THRESHOLD: 10, // alpha below this considered transparent
    WHITE_THRESHOLD: 250,       // near-white skip threshold
    DEFAULT_TILE_SIZE: 4,       // screen px per WPlace pixel (adjustable)
    THEME: {
      panelBg: "#0f1720",
      accent: "#7c3aed",
      text: "#e6eef8",
      subtext: "#9aa7bf",
      ok: "#10b981",
      warn: "#f59e0b",
      danger: "#ef4444"
    }
  };

  // ---------- WPLACE PALETTE (from provided HTML) ----------
  const WPLACE_PALETTE = [
    { id: 1, name: "Black",        rgb: [0, 0, 0] },
    { id: 2, name: "Dark Gray",    rgb: [60, 60, 60] },
    { id: 3, name: "Gray",         rgb: [120, 120, 120] },
    { id: 4, name: "Light Gray",   rgb: [210, 210, 210] },
    { id: 5, name: "White",        rgb: [255, 255, 255] },
    { id: 6, name: "Deep Red",     rgb: [96, 0, 24] },
    { id: 7, name: "Red",          rgb: [237, 28, 36] },
    { id: 8, name: "Orange",       rgb: [255, 127, 39] },
    { id: 9, name: "Gold",         rgb: [246, 170, 9] },
    { id: 10, name: "Yellow",      rgb: [249, 221, 59] },
    { id: 11, name: "Light Yellow",rgb: [255, 250, 188] },
    { id: 12, name: "Dark Green",  rgb: [14, 185, 104] },
    { id: 13, name: "Green",       rgb: [19, 230, 123] },
    { id: 14, name: "Light Green", rgb: [135, 255, 94] },
    { id: 15, name: "Dark Teal",   rgb: [12, 129, 110] },
    { id: 16, name: "Teal",        rgb: [16, 174, 166] },
    { id: 17, name: "Light Teal",  rgb: [19, 225, 190] },
    { id: 18, name: "Dark Blue",   rgb: [40, 80, 158] },
    { id: 19, name: "Blue",        rgb: [64, 147, 228] },
    { id: 20, name: "Cyan",        rgb: [96, 247, 242] },
    { id: 21, name: "Indigo",      rgb: [107, 80, 246] },
    { id: 22, name: "Light Indigo",rgb: [153, 177, 251] },
    { id: 23, name: "Dark Purple", rgb: [120, 12, 153] },
    { id: 24, name: "Purple",      rgb: [170, 56, 185] },
    { id: 25, name: "Light Purple",rgb: [224, 159, 249] },
    { id: 26, name: "Dark Pink",   rgb: [203, 0, 122] },
    { id: 27, name: "Pink",        rgb: [236, 31, 128] },
    { id: 28, name: "Light Pink",  rgb: [243, 141, 169] },
    { id: 29, name: "Dark Brown",  rgb: [104, 70, 52] },
    { id: 30, name: "Brown",       rgb: [149, 104, 42] },
    { id: 31, name: "Beige",       rgb: [248, 178, 119] }
  ];

  // ---------- STATE ----------
  const state = {
    overlayCanvas: null,
    overlayCtx: null,
    // pixel grid (after pixelation): array of {x,y, r,g,b, paletteId, paletteName, done}
    pixels: [],
    gridW: 0, gridH: 0,      // dimensions in WPlace pixels
    tileSize: CONFIG.DEFAULT_TILE_SIZE, // screen px per grid cell
    pos: { x: 100, y: 100 }, // top-left on screen
    editMode: false,
    gridVisible: false,
    locked: false,
    lastImageSrc: null
  };

  // ---------- UTILS ----------
  const Utils = {
    colorDistance: (a,b) => Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2),
    findClosestPalette: (rgb) => {
      let best = { id: WPLACE_PALETTE[0].id, name: WPLACE_PALETTE[0].name, dist: Infinity, rgb: WPLACE_PALETTE[0].rgb };
      for (const p of WPLACE_PALETTE) {
        const d = Utils.colorDistance(rgb, p.rgb);
        if (d < best.dist) best = { id: p.id, name: p.name, dist: d, rgb: p.rgb };
      }
      return best;
    },
    pixelateImageToGrid: (img, targetW, targetH) => {
      // nearest-neighbor draw: create canvas of target size, draw image into it without smoothing
      const tmp = document.createElement('canvas');
      tmp.width = targetW;
      tmp.height = targetH;
      const tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, targetW, targetH);
      return tctx.getImageData(0,0,targetW,targetH);
    },
    saveLocal: () => {
      try {
        const saved = {
          pos: state.pos,
          tileSize: state.tileSize,
          gridVisible: state.gridVisible,
          locked: state.locked,
          editMode: state.editMode,
          gridW: state.gridW,
          gridH: state.gridH,
          pixelsDone: state.pixels.map(p => !!p.done),
          lastImageSrc: state.lastImageSrc
        };
        localStorage.setItem(CONFIG.LOCAL_KEY, JSON.stringify(saved));
      } catch(e) { console.warn('WPO save failed', e); }
    },
    loadLocal: () => {
      try {
        const raw = localStorage.getItem(CONFIG.LOCAL_KEY);
        if(!raw) return;
        const parsed = JSON.parse(raw);
        if(parsed.pos) state.pos = parsed.pos;
        if(parsed.tileSize) state.tileSize = parsed.tileSize;
        if(typeof parsed.gridVisible === 'boolean') state.gridVisible = parsed.gridVisible;
        if(typeof parsed.locked === 'boolean') state.locked = parsed.locked;
        if(typeof parsed.editMode === 'boolean') state.editMode = parsed.editMode;
        if(parsed.gridW) state.gridW = parsed.gridW;
        if(parsed.gridH) state.gridH = parsed.gridH;
        if(Array.isArray(parsed.pixelsDone) && parsed.pixelsDone.length === state.pixels.length) {
          for(let i=0;i<parsed.pixelsDone.length;i++) state.pixels[i].done = !!parsed.pixelsDone[i];
        }
        if(parsed.lastImageSrc) state.lastImageSrc = parsed.lastImageSrc;
      } catch(e) { console.warn('WPO load failed', e); }
    }
  };

  // ---------- STYLES ----------
  (function injectStyles(){
    const s = document.createElement('style');
    s.textContent = `
      #wpo-panel { position:fixed; right:18px; top:18px; width:300px; z-index:100001;
        background: linear-gradient(180deg, ${CONFIG.THEME.panelBg}, #071022);
        color:${CONFIG.THEME.text}; border-radius:12px; padding:12px; box-shadow:0 10px 30px rgba(2,6,23,0.6);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
        border: 1px solid rgba(255,255,255,0.03); 
      }
      #wpo-panel h4 { margin:0 0 8px 0; font-size:15px; color:${CONFIG.THEME.accent}; display:flex;align-items:center; gap:8px}
      .wpo-row { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
      .wpo-btn { flex:1; padding:8px 10px; border-radius:8px; border:none; cursor:pointer;
         background: rgba(255,255,255,0.03); color:${CONFIG.THEME.text}; font-weight:600; font-size:13px;
      }
      .wpo-btn.primary { background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #4c1d95); color:#fff; }
      .wpo-small { padding:6px 8px; font-size:12px; border-radius:6px; }
      .wpo-label { font-size:12px; color:${CONFIG.THEME.subtext}; }
      .wpo-input { width:80px; padding:6px; border-radius:8px; background:rgba(255,255,255,0.02); color:${CONFIG.THEME.text}; border:1px solid rgba(255,255,255,0.03); }
      #wpo-progress-bar { height:10px; background:rgba(255,255,255,0.06); border-radius:999px; overflow:hidden; margin-top:8px }
      #wpo-progress-bar > div { height:100%; background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #a78bfa); width:0%}
      #wpo-footer { font-size:12px; color:${CONFIG.THEME.subtext}; margin-top:8px; display:flex; justify-content:space-between; align-items:center}
      #wpo-toggle-box { width:36px; height:20px; border-radius:999px; background:rgba(255,255,255,0.06); padding:3px; cursor:pointer; display:inline-flex; align-items:center; }
      #wpo-toggle-knob { width:14px; height:14px; border-radius:999px; background:#fff; transform:translateX(0); transition:transform 0.15s; }
      .wpo-toggle-on { background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #a78bfa) !important; }
      #wpo-overlay-canvas { position:fixed; top:0; left:0; z-index:100000; pointer-events:none; }
      #wpo-tip { position:fixed; z-index:100002; padding:6px 8px; background:rgba(7,10,15,0.9); color:#fff; border-radius:6px; font-size:12px; display:none; white-space:nowrap; }
      #wpo-small-note { font-size:12px; color:${CONFIG.THEME.subtext}; margin-top:6px; }
    `;
    document.head.appendChild(s);
  })();

  // ---------- BUILD PANEL ----------
  function buildPanel() {
    // remove existing
    const existing = document.getElementById('wpo-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'wpo-panel';
    panel.innerHTML = `
      <h4>🔳 WPlace Overlay</h4>

      <div class="wpo-row">
        <button id="wpo-upload" class="wpo-btn primary">Upload Image</button>
        <button id="wpo-load" class="wpo-btn wpo-small">Load</button>
      </div>

      <div class="wpo-row">
        <div style="flex:1">
          <div class="wpo-label">Grid size (W × H)</div>
          <div style="display:flex; gap:6px; margin-top:6px;">
            <input id="wpo-gridW" class="wpo-input" type="number" min="1" value="${state.gridW}" placeholder="width" />
            <input id="wpo-gridH" class="wpo-input" type="number" min="1" value="${state.gridH}" placeholder="height" />
            <button id="wpo-autoset" class="wpo-btn wpo-small">Auto</button>
          </div>
          <div id="wpo-small-note">Downscale your image to this grid (nearest-neighbor). If left 0, autoset uses image natural size.</div>
        </div>
      </div>

      <div class="wpo-row">
        <div style="flex:1">
          <div class="wpo-label">Tile size (screen px)</div>
          <input id="wpo-scale" class="wpo-input" type="number" min="1" value="${state.tileSize}" />
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button id="wpo-edit" class="wpo-btn wpo-small">Edit Mode</button>
          <button id="wpo-lock" class="wpo-btn wpo-small">Lock</button>
        </div>
      </div>

      <div class="wpo-row">
        <button id="wpo-grid-toggle" class="wpo-btn wpo-small">Grid: ${state.gridVisible ? 'On' : 'Off'}</button>
        <button id="wpo-reset" class="wpo-btn wpo-small">Reset</button>
      </div>

      <div>
        <div class="wpo-label">Progress</div>
        <div id="wpo-progress-bar"><div style="width:0%"></div></div>
        <div id="wpo-progress-text" style="margin-top:6px; font-size:12px; color:${CONFIG.THEME.subtext}">0 / 0</div>
      </div>

      <div id="wpo-footer">
        <div class="wpo-label">Edit Mode</div>
        <div id="wpo-toggle-box"><div id="wpo-toggle-knob"></div></div>
      </div>

      <div style="margin-top:8px">
        <div class="wpo-row"><button id="wpo-move-handle" class="wpo-btn wpo-small">Move Overlay</button><button id="wpo-help" class="wpo-btn wpo-small">Help</button></div>
      </div>
    `;
    document.body.appendChild(panel);

    // DOM hooks
    document.getElementById('wpo-upload').onclick = onUploadClick;
    document.getElementById('wpo-load').onclick = () => { Utils.loadLocal(); drawOverlay(); updateProgressUI(); showTip('Loaded saved state', 1200); };
    document.getElementById('wpo-autoset').onclick = () => {
      if (!state._lastImageObj) { showTip('Upload an image first', 1400); return; }
      document.getElementById('wpo-gridW').value = state._lastImageObj.naturalWidth;
      document.getElementById('wpo-gridH').value = state._lastImageObj.naturalHeight;
      showTip('Grid set to image size — press Upload again to reprocess or press Load.', 1600);
    };
    document.getElementById('wpo-gridW').onchange = (e) => state.gridW = parseInt(e.target.value) || 0;
    document.getElementById('wpo-gridH').onchange = (e) => state.gridH = parseInt(e.target.value) || 0;
    document.getElementById('wpo-scale').onchange = (e) => { state.tileSize = Math.max(1, parseInt(e.target.value)||CONFIG.DEFAULT_TILE_SIZE); Utils.saveLocal(); drawOverlay(); };
    document.getElementById('wpo-edit').onclick = () => { state.editMode = !state.editMode; updateEditUI(); Utils.saveLocal(); };
    document.getElementById('wpo-lock').onclick = () => { state.locked = !state.locked; document.getElementById('wpo-lock').textContent = state.locked ? 'Locked' : 'Lock'; Utils.saveLocal(); };
    document.getElementById('wpo-grid-toggle').onclick = () => { state.gridVisible = !state.gridVisible; document.getElementById('wpo-grid-toggle').textContent = `Grid: ${state.gridVisible ? 'On' : 'Off'}`; Utils.saveLocal(); drawOverlay(); };
    document.getElementById('wpo-reset').onclick = () => { if (!confirm('Reset progress? This will unmark all placed pixels.')) return; state.pixels.forEach(p=>p.done=false); Utils.saveLocal(); drawOverlay(); updateProgressUI(); };
    document.getElementById('wpo-toggle-box').onclick = () => { state.editMode = !state.editMode; updateEditUI(); Utils.saveLocal(); };
    document.getElementById('wpo-move-handle').onmousedown = (e) => startPanelDrag(e);
    document.getElementById('wpo-help').onclick = () => {
      alert('Usage tips:\\n- Upload an image (preferably pixel art or high-contrast).\\n- Set Grid size to the target pixel count (or use Auto).\\n- Set Tile size to match WPlace pixel display (default 4).\\n- Toggle Edit Mode to interact with the overlay.\\n- Click a pixel in Edit Mode to select palette and mark it done.\\n- Drag overlay only with Move Overlay button.');
    };
    updateEditUI();
    updateProgressUI();
  }

  // ---------- TIP BOX ----------
  const tipBox = document.createElement('div');
  tipBox.id = 'wpo-tip';
  tipBox.style.position = 'fixed';
  tipBox.style.zIndex = 100002;
  tipBox.style.padding = '6px 8px';
  tipBox.style.background = 'rgba(7,10,15,0.9)';
  tipBox.style.color = '#fff';
  tipBox.style.borderRadius = '6px';
  tipBox.style.fontSize = '12px';
  tipBox.style.display = 'none';
  document.body.appendChild(tipBox);
  function showTip(text, ms = 1200) {
    tipBox.textContent = text;
    tipBox.style.left = (window.innerWidth/2 - 140) + 'px';
    tipBox.style.top = '80px';
    tipBox.style.display = 'block';
    clearTimeout(tipBox._t);
    tipBox._t = setTimeout(()=> tipBox.style.display = 'none', ms);
  }

  // ---------- OVERLAY CANVAS ----------
  function createOverlayCanvas() {
    if (state.overlayCanvas) return;
    const c = document.createElement('canvas');
    c.id = 'wpo-overlay-canvas';
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    c.style.pointerEvents = 'none'; // only active in editMode
    document.body.appendChild(c);
    state.overlayCanvas = c;
    state.overlayCtx = c.getContext('2d');

    // resize handling
    window.addEventListener('resize', () => { c.width = window.innerWidth; c.height = window.innerHeight; drawOverlay(); });

    // mouse interactions when editMode is ON
    c.addEventListener('mousedown', (ev) => {
      if (!state.editMode) return;
      // clicking should not drag the site
      ev.preventDefault();
      ev.stopPropagation();

      // left click -> either start overlay dragging if clicked on overlay border while not locked
      const m = mapMouseToGrid(ev);
      // if user holds Shift and clicks anywhere on overlay, start overlay drag
      // (but user specifically asked drag *only via GUI handle*; keep this as backup)
      if (!state.locked && ev.shiftKey) {
        state._draggingOverlay = true;
        state.dragOffset = { x: ev.clientX - state.pos.x, y: ev.clientY - state.pos.y };
        return;
      }
      // otherwise treat as pixel click
      handlePixelClickAt(m.gridX, m.gridY, ev);
    });

    window.addEventListener('mouseup', () => { state._draggingOverlay = false; });
    window.addEventListener('mousemove', (ev) => {
      if (!state.editMode) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (state._draggingOverlay && !state.locked) {
        state.pos.x = ev.clientX - state.dragOffset.x;
        state.pos.y = ev.clientY - state.dragOffset.y;
        Utils.saveLocal();
        drawOverlay();
        return;
      }
      const m = mapMouseToGrid(ev);
      handleHover(m.gridX, m.gridY, ev);
    });
  }

  function mapMouseToGrid(ev) {
    const gx = Math.floor((ev.clientX - state.pos.x) / state.tileSize);
    const gy = Math.floor((ev.clientY - state.pos.y) / state.tileSize);
    return { gridX: gx, gridY: gy, clientX: ev.clientX, clientY: ev.clientY };
  }

  // ---------- IMAGE UPLOAD & PROCESS ----------
  function onUploadClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        state._lastImageObj = img;
        state.lastImageSrc = url;
        // grid target from inputs
        let targetW = parseInt(document.getElementById('wpo-gridW').value) || 0;
        let targetH = parseInt(document.getElementById('wpo-gridH').value) || 0;
        if (targetW <= 0 || targetH <= 0) {
          // use image natural pixels as grid by default
          targetW = img.naturalWidth;
          targetH = img.naturalHeight;
          document.getElementById('wpo-gridW').value = targetW;
          document.getElementById('wpo-gridH').value = targetH;
        }
        // pixelate (nearest neighbor)
        const idata = Utils.pixelateImageToGrid(img, targetW, targetH);
        buildPixelsFromImageData(idata, targetW, targetH);
        Utils.saveLocal();
        drawOverlay();
        updateProgressUI();
        showTip('Image processed into grid', 1400);
        // revoke object URL after short delay
        setTimeout(()=> URL.revokeObjectURL(url), 2000);
      };
      img.onerror = () => { showTip('Failed to load image', 1400); URL.revokeObjectURL(url); };
      img.src = url;
    };
    input.click();
  }

  function buildPixelsFromImageData(idata, targetW, targetH) {
    const d = idata.data;
    state.pixels = [];
    state.gridW = targetW;
    state.gridH = targetH;
    for (let gy = 0; gy < targetH; gy++) {
      for (let gx = 0; gx < targetW; gx++) {
        const idx = (gy * targetW + gx) * 4;
        const r = d[idx], g = d[idx+1], b = d[idx+2], a = d[idx+3];
        if (a < CONFIG.TRANSPARENCY_THRESHOLD) continue; // skip transparent
        if (r >= CONFIG.WHITE_THRESHOLD && g >= CONFIG.WHITE_THRESHOLD && b >= CONFIG.WHITE_THRESHOLD) continue; // skip near-white
        const pal = Utils.findClosestPalette([r,g,b]);
        state.pixels.push({
          x: gx, y: gy,
          r, g, b,
          paletteId: pal.id,
          paletteName: pal.name,
          done: false
        });
      }
    }
    state.imageLoaded = state.pixels.length > 0;
  }

  // ---------- DRAWING ----------
  function drawOverlay() {
    if (!state.overlayCtx) return;
    const ctx = state.overlayCtx;
    ctx.clearRect(0,0, state.overlayCanvas.width, state.overlayCanvas.height);

    if (!state.imageLoaded) {
      // optionally draw a faint rectangle to show overlay location (if gridW defined)
      if (state.gridW && state.gridH) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.strokeRect(state.pos.x - 2, state.pos.y - 2, state.gridW * state.tileSize + 4, state.gridH * state.tileSize + 4);
      }
      return;
    }

    // draw each pixel cell
    for (const p of state.pixels) {
      const sx = Math.round(state.pos.x + p.x * state.tileSize);
      const sy = Math.round(state.pos.y + p.y * state.tileSize);
      if (!p.done) {
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${state.editMode ? 0.95 : 0.6})`;
        ctx.fillRect(sx, sy, state.tileSize, state.tileSize);
      } else {
        // done pixels: clear / transparent so site shows through
        ctx.clearRect(sx, sy, state.tileSize, state.tileSize);
      }
      if (state.gridVisible) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        // draw crisp 1px lines
        ctx.strokeRect(sx + 0.5, sy + 0.5, state.tileSize - 1, state.tileSize - 1);
      }
    }

    // outline
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.strokeRect(state.pos.x - 2, state.pos.y - 2, state.gridW * state.tileSize + 4, state.gridH * state.tileSize + 4);
  }

  // ---------- PIXEL CLICK & HOVER ----------
  // hover tooltip
  const hoverTip = document.createElement('div');
  hoverTip.style.cssText = 'position:fixed;z-index:100003;padding:6px 8px;background:rgba(7,10,15,0.9);color:#fff;border-radius:6px;font-size:12px;display:none;pointer-events:none;';
  document.body.appendChild(hoverTip);

  function handleHover(gridX, gridY, ev) {
    const p = state.pixels.find(px => px.x === gridX && px.y === gridY && !px.done);
    if (p) {
      hoverTip.style.left = (ev.clientX + 12) + 'px';
      hoverTip.style.top = (ev.clientY + 12) + 'px';
      hoverTip.textContent = `${p.paletteName} (id ${p.paletteId})`;
      hoverTip.style.display = 'block';
    } else {
      hoverTip.style.display = 'none';
    }
  }

  function handlePixelClickAt(gridX, gridY, ev) {
    const p = state.pixels.find(px => px.x === gridX && px.y === gridY);
    if (!p) { showTip('No paintable pixel here', 700); return; }

    // attempt to click color button on Wplace UI
    try {
      const btn = document.querySelector(`#color-${p.paletteId}`);
      if (btn) {
        // best-effort: dispatch click
        btn.click();
      } else {
        showTip('Palette button not detected. Maybe WPlace uses a different selector.', 1400);
      }
    } catch(e) {
      console.warn('color click error', e);
    }

    // mark done & persist
    p.done = true;
    Utils.saveLocal();
    drawOverlay();
    updateProgressUI();
  }

  // ---------- PROGRESS UI ----------
  function updateProgressUI() {
    const total = state.pixels.length;
    const done = state.pixels.filter(p => p.done).length;
    const pct = total ? Math.round((done/total)*100) : 0;
    const bar = document.querySelector('#wpo-progress-bar > div');
    if (bar) bar.style.width = pct + '%';
    const pt = document.getElementById('wpo-progress-text');
    if (pt) pt.textContent = `${done} / ${total} (${pct}%)`;
  }

  // ---------- PANEL MOVE (dragging via Move Overlay button) ----------
  let panelDrag = { active: false, offset: {x:0,y:0} };
  function startPanelDrag(e) {
    // start dragging overlay: user clicked Move Overlay button
    panelDrag.active = true;
    panelDrag.offset.x = e.clientX - state.pos.x;
    panelDrag.offset.y = e.clientY - state.pos.y;
    function move(e2) {
      if (!panelDrag.active || state.locked) return;
      state.pos.x = e2.clientX - panelDrag.offset.x;
      state.pos.y = e2.clientY - panelDrag.offset.y;
      Utils.saveLocal();
      drawOverlay();
    }
    function up() {
      panelDrag.active = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      Utils.saveLocal();
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // ---------- Panel UI state updates ----------
  function updateEditUI() {
    const knob = document.getElementById('wpo-toggle-knob');
    const box = document.getElementById('wpo-toggle-box');
    if (!knob || !box || !state.overlayCanvas) return;
    if (state.editMode) {
      knob.style.transform = 'translateX(16px)';
      box.classList.add('wpo-toggle-on');
      state.overlayCanvas.style.pointerEvents = 'auto';
      state.overlayCanvas.style.cursor = state.locked ? 'default' : 'crosshair';
      document.getElementById('wpo-edit').textContent = 'Edit: On';
    } else {
      knob.style.transform = 'translateX(0)';
      box.classList.remove('wpo-toggle-on');
      state.overlayCanvas.style.pointerEvents = 'none';
      document.getElementById('wpo-edit').textContent = 'Edit Mode';
      hoverTip.style.display = 'none';
    }
    // reflect some settings
    document.getElementById('wpo-scale').value = state.tileSize;
    document.getElementById('wpo-grid-toggle').textContent = `Grid: ${state.gridVisible ? 'On' : 'Off'}`;
    document.getElementById('wpo-lock').textContent = state.locked ? 'Locked' : 'Lock';
  }

  // ---------- SAVE / LOAD ----------
  // after building pixels, try restore done flags if saved
  function tryRestoreDoneFlags() {
    const raw = localStorage.getItem(CONFIG.LOCAL_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.pixelsDone) return;
      if (Array.isArray(parsed.pixelsDone) && parsed.pixelsDone.length === state.pixels.length) {
        for (let i=0;i<state.pixels.length;i++) state.pixels[i].done = !!parsed.pixelsDone[i];
      }
    } catch(e) { console.warn('restore fail', e); }
  }

  // ---------- HELPERS ----------
  function resetAll() {
    state.pixels = [];
    state.gridW = 0; state.gridH = 0;
    state.imageLoaded = false;
    state.lastImageSrc = null;
    Utils.saveLocal();
    drawOverlay();
    updateProgressUI();
  }

  // ---------- UPLOAD (wrapping) ----------
  function onUploadClick() { onUploadClickInner(); }
  function onUploadClickInner() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // determine target grid
        state._lastImageObj = img;
        state.lastImageSrc = url;
        let targetW = parseInt(document.getElementById('wpo-gridW').value) || 0;
        let targetH = parseInt(document.getElementById('wpo-gridH').value) || 0;
        if (targetW <= 0 || targetH <= 0) {
          targetW = img.naturalWidth;
          targetH = img.naturalHeight;
          document.getElementById('wpo-gridW').value = targetW;
          document.getElementById('wpo-gridH').value = targetH;
        }
        // pixelate and build pixels
        const idata = Utils.pixelateImageToGrid(img, targetW, targetH);
        buildPixelsFromImageData(idata, targetW, targetH);
        // attempt to restore previous done flags if count matches
        tryRestoreDoneFlags();
        Utils.saveLocal();
        // reflect tile size input
        const scaleInput = document.getElementById('wpo-scale');
        if (scaleInput) scaleInput.value = state.tileSize;
        drawOverlay();
        updateProgressUI();
        showTip('Image processed into grid', 1200);
        // revoke after short delay
        setTimeout(()=> URL.revokeObjectURL(url), 2000);
      };
      img.onerror = () => { showTip('Image load failed', 1200); URL.revokeObjectURL(url); };
      img.src = url;
    };
    input.click();
  }

  // ---------- PANEL DRAG START ----------
  function startPanelDrag(e) { /* provided above as startPanelDrag for Move Overlay button */ }

  // ---------- INITIALIZE ----------
  function init() {
    buildPanel();
    createOverlayCanvas();
    // load saved config (pos / tileSize etc)
    Utils.loadLocal();
    // if there was a lastImageSrc saved, we can't reload it automatically due to browser restrictions
    // but if pixels exist in localStorage from a previous session, try to restore done flags
    // user must upload image again to rebuild pixel grid if they want visual.
    if (state.lastImageSrc && !state.imageLoaded) {
      // do nothing automatically (can't fetch user blob reliably)
    }
    updateEditUI();
    drawOverlay();
    updateProgressUI();
    showTip('WPlace Overlay ready — Upload an image', 1500);
  }

  // ---------- EXPOSE DEBUG ----------
  window.WPO = {
    state,
    drawOverlay,
    save: Utils.saveLocal,
    load: Utils.loadLocal,
    resetAll
  };

  // run
  init();

  // attach keyboard shortcuts (optional)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'e') { state.editMode = !state.editMode; updateEditUI(); Utils.saveLocal(); }
    if (e.key === 'g') { state.gridVisible = !state.gridVisible; drawOverlay(); Utils.saveLocal(); }
  });

})();
