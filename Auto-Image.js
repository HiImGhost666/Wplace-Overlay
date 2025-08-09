// == WPlace Overlay (manual helper) ==
// Paste as a single file and host it. Use bookmarklet like:
// javascript:fetch("https://yourhost.com/WPlace-Overlay.js").then(r=>r.text()).then(eval);

(async () => {
  // ---------- CONFIG ----------
  const CONFIG = {
    TRANSPARENCY_THRESHOLD: 100,
    WHITE_THRESHOLD: 250,
    THEME: {
      primary: '#0b0b0d',
      panel: '#0f1720',
      accent: '#6d28d9',
      text: '#e6eef8',
      subtext: '#9aa7bf',
      success: '#10b981',
      danger: '#ef4444'
    },
    LOCAL_KEY: 'wplace_overlay_v1'
  };

  // ---------- WPLACE PALETTE (from your HTML) ----------
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
    imageLoaded: false,
    gridW: 0, // pixel-art width (number of pixels)
    gridH: 0, // pixel-art height
    scale: 8, // display size of one pixel cell in screen px (editable)
    pos: { x: 100, y: 100 }, // top-left of the overlay on screen
    dragging: false,
    dragOffset: { x: 0, y: 0 },
    editMode: false, // when true the overlay captures clicks & drag
    gridVisible: false,
    locked: false,
    pixels: [], // array of { x, y, rgb, paletteId, paletteName, done }
    overlayCanvas: null,
    overlayCtx: null,
    settings: {
      autoGridFromImage: true
    },
    localKey: CONFIG.LOCAL_KEY
  };

  // ---------- UTILS ----------
  const Utils = {
    colorDistance: (a, b) => Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2),
    findClosestPalette: (rgb) => {
      let best = { id: WPLACE_PALETTE[0].id, name: WPLACE_PALETTE[0].name, dist: Infinity, rgb: WPLACE_PALETTE[0].rgb };
      for (const p of WPLACE_PALETTE) {
        const d = Utils.colorDistance(rgb, p.rgb);
        if (d < best.dist) best = { id: p.id, name: p.name, dist: d, rgb: p.rgb };
      }
      return best;
    },

    saveLocal: () => {
      try {
        const save = {
          pos: state.pos,
          scale: state.scale,
          gridW: state.gridW,
          gridH: state.gridH,
          editMode: state.editMode,
          gridVisible: state.gridVisible,
          locked: state.locked,
          pixelsDone: state.pixels.map(p => p.done),
        };
        localStorage.setItem(state.localKey, JSON.stringify(save));
      } catch(e){ console.warn('save failed', e); }
    },

    loadLocal: () => {
      try {
        const raw = localStorage.getItem(state.localKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed.pos) state.pos = parsed.pos;
        if (parsed.scale) state.scale = parsed.scale;
        if (parsed.gridW) state.gridW = parsed.gridW;
        if (parsed.gridH) state.gridH = parsed.gridH;
        if (typeof parsed.editMode === 'boolean') state.editMode = parsed.editMode;
        if (typeof parsed.gridVisible === 'boolean') state.gridVisible = parsed.gridVisible;
        if (typeof parsed.locked === 'boolean') state.locked = parsed.locked;
        if (parsed.pixelsDone && Array.isArray(parsed.pixelsDone) && state.pixels.length === parsed.pixelsDone.length) {
          for (let i=0;i<state.pixels.length;i++) state.pixels[i].done = !!parsed.pixelsDone[i];
        }
      } catch(e) { console.warn('load fail', e); }
    },

    formatPct: (a,b) => b>0? Math.round((a/b)*100) + '%' : '0%',

    // nearest-neighbor resizing (downscale/upscale) to target width/height
    pixelateImageToGrid: (img, targetW, targetH) => {
      const tmp = document.createElement('canvas');
      tmp.width = targetW;
      tmp.height = targetH;
      const tctx = tmp.getContext('2d');
      tctx.imageSmoothingEnabled = false;
      // draw image into target sized canvas (this does nearest-neighbor if smoothing disabled)
      tctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, targetW, targetH);
      // return ImageData
      return tctx.getImageData(0,0,targetW,targetH);
    }
  };

  // ---------- UI STYLES ----------
  const styleTag = document.createElement('style');
  styleTag.innerHTML = `
    #wpo-panel { position:fixed; right:18px; top:18px; width:260px; z-index:100001;
      background: linear-gradient(180deg, ${CONFIG.THEME.panel}, ${CONFIG.THEME.primary});
      color:${CONFIG.THEME.text}; border-radius:12px; padding:12px; box-shadow:0 10px 30px rgba(2,6,23,0.6);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
      border: 1px solid rgba(255,255,255,0.03); 
    }
    #wpo-panel h4 { margin:0 0 8px 0; font-size:14px; color:${CONFIG.THEME.accent}; display:flex;align-items:center; gap:8px}
    .wpo-row { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
    .wpo-btn { flex:1; padding:8px 10px; border-radius:8px; border:none; cursor:pointer;
       background: rgba(255,255,255,0.03); color:${CONFIG.THEME.text}; font-weight:600; font-size:13px;
    }
    .wpo-btn:hover { transform: translateY(-2px); box-shadow:0 6px 18px rgba(0,0,0,0.4);}
    .wpo-btn.primary { background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #4c1d95); color:#fff; }
    .wpo-small { padding:6px 8px; font-size:12px; border-radius:6px;}
    .wpo-label { font-size:12px; color:${CONFIG.THEME.subtext}; }
    .wpo-input { width:80px; padding:6px; border-radius:8px; background:rgba(255,255,255,0.02); color:${CONFIG.THEME.text}; border:1px solid rgba(255,255,255,0.03); }
    #wpo-progress-bar { height:8px; background:rgba(255,255,255,0.06); border-radius:999px; overflow:hidden;}
    #wpo-progress-bar > div { height:100%; background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #a78bfa); width:0%}
    #wpo-footer { font-size:12px; color:${CONFIG.THEME.subtext}; margin-top:8px; display:flex; justify-content:space-between; align-items:center}
    #wpo-toggle { display:inline-flex; align-items:center; gap:6px; }
    .wpo-toggle-box { width:36px; height:20px; border-radius:999px; background:rgba(255,255,255,0.06); padding:3px; cursor:pointer; }
    .wpo-toggle-knob { width:14px; height:14px; border-radius:999px; background:#fff; transform:translateX(0); transition:transform 0.15s; }
    .wpo-toggle-on { background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #a78bfa) !important; }
    #wpo-overlay-canvas { position:fixed; top:0; left:0; z-index:100000; pointer-events:none; }
    #wpo-tip { position:fixed; z-index:100002; padding:6px 8px; background:rgba(7,10,15,0.9); color:#fff; border-radius:6px; font-size:12px; display:none; white-space:nowrap; }
    .wpo-row .small { font-size:11px; color:${CONFIG.THEME.subtext}; }
  `;
  document.head.appendChild(styleTag);

  // ---------- PANEL BUILD ----------
  function buildPanel() {
    // avoid duplicates
    const existing = document.getElementById('wpo-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'wpo-panel';
    panel.innerHTML = `
      <h4><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7h16v10H4z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg> WPlace Overlay</h4>

      <div class="wpo-row">
        <button id="wpo-upload" class="wpo-btn primary">Upload Image</button>
        <button id="wpo-load" class="wpo-btn small">Load</button>
      </div>

      <div class="wpo-row">
        <div style="flex:1">
          <div class="wpo-label">Grid size (px)</div>
          <div style="display:flex; gap:6px; margin-top:6px;">
            <input id="wpo-gridW" class="wpo-input" type="number" min="1" value="0" />
            <input id="wpo-gridH" class="wpo-input" type="number" min="1" value="0" />
            <button id="wpo-autoset" class="wpo-btn small">Auto</button>
          </div>
          <div class="small" style="margin-top:6px">Target pixel grid — downscale your image to these dimensions (nearest-neighbor)</div>
        </div>
      </div>

      <div class="wpo-row">
        <div style="flex:1">
          <div class="wpo-label">Pixel display size</div>
          <input id="wpo-scale" class="wpo-input" type="number" min="1" value="${state.scale}" />
        </div>
        <div style="width:8px"></div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button id="wpo-edit" class="wpo-btn small">Edit Mode</button>
          <button id="wpo-lock" class="wpo-btn small">Lock</button>
        </div>
      </div>

      <div class="wpo-row">
        <button id="wpo-grid-toggle" class="wpo-btn small">Grid: Off</button>
        <button id="wpo-reset" class="wpo-btn small">Reset</button>
      </div>

      <div style="margin-top:8px">
        <div class="wpo-label">Progress</div>
        <div id="wpo-progress-bar"><div style="width:0%"></div></div>
        <div id="wpo-progress-text" style="margin-top:6px; font-size:12px; color:${CONFIG.THEME.subtext}">0 / 0</div>
      </div>

      <div id="wpo-footer">
        <div class="wpo-label">Edit Mode</div>
        <div id="wpo-toggle">
          <div id="wpo-toggle-box" class="wpo-toggle-box"><div id="wpo-toggle-knob" class="wpo-toggle-knob"></div></div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // listen DOM
    document.getElementById('wpo-upload').onclick = onUploadClick;
    document.getElementById('wpo-load').onclick = () => {
      Utils.loadLocal();
      drawOverlay();
      updateProgressUI();
      showTip('Loaded saved state', 1400);
    };

    document.getElementById('wpo-autoset').onclick = () => {
      // Auto set grid to image natural size (if loaded) or keep existing
      if (!state._lastImageObj) {
        showTip('Upload an image first', 1500);
        return;
      }
      // If user wants small pixel art, we keep same; else allow them to pick
      // For convenience we default to image natural width/height
      document.getElementById('wpo-gridW').value = state._lastImageObj.naturalWidth;
      document.getElementById('wpo-gridH').value = state._lastImageObj.naturalHeight;
      showTip('Grid set to image size — press "Load" after Upload', 1600);
    };

    document.getElementById('wpo-gridW').onchange = (e) => {
      state.gridW = parseInt(e.target.value) || 0;
    };
    document.getElementById('wpo-gridH').onchange = (e) => {
      state.gridH = parseInt(e.target.value) || 0;
    };
    document.getElementById('wpo-scale').onchange = (e) => {
      state.scale = Math.max(1, parseInt(e.target.value) || 1);
      Utils.saveLocal(); drawOverlay();
    };

    document.getElementById('wpo-edit').onclick = () => {
      state.editMode = !state.editMode;
      updateEditUI();
      Utils.saveLocal();
    };

    document.getElementById('wpo-lock').onclick = () => {
      state.locked = !state.locked;
      document.getElementById('wpo-lock').textContent = state.locked ? 'Locked' : 'Lock';
      Utils.saveLocal();
    };

    document.getElementById('wpo-grid-toggle').onclick = () => {
      state.gridVisible = !state.gridVisible;
      document.getElementById('wpo-grid-toggle').textContent = `Grid: ${state.gridVisible ? 'On' : 'Off'}`;
      Utils.saveLocal();
      drawOverlay();
    };

    document.getElementById('wpo-reset').onclick = () => {
      if (!confirm('Reset progress? This will mark all pixels undone.')) return;
      for (const p of state.pixels) p.done = false;
      Utils.saveLocal();
      drawOverlay();
      updateProgressUI();
    };

    // toggle knob UI
    const toggleBox = document.getElementById('wpo-toggle-box');
    toggleBox.onclick = () => {
      state.editMode = !state.editMode;
      updateEditUI();
      Utils.saveLocal();
    };

    updateEditUI();
    updateProgressUI();
  }

  // ---------- TIP BOX ----------
  const tipBox = document.createElement('div');
  tipBox.id = 'wpo-tip';
  document.body.appendChild(tipBox);
  function showTip(msg, time=1200) {
    tipBox.textContent = msg;
    tipBox.style.display = 'block';
    tipBox.style.left = (window.innerWidth/2 - 120) + 'px';
    tipBox.style.top = '80px';
    clearTimeout(tipBox._t);
    tipBox._t = setTimeout(()=> tipBox.style.display='none', time);
  }

  // ---------- OVERLAY CANVAS ----------
  function createOverlayCanvas() {
    if (state.overlayCanvas) return;
    const c = document.createElement('canvas');
    c.id = 'wpo-overlay-canvas';
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    c.style.pointerEvents = 'none'; // default: let site handle events
    document.body.appendChild(c);
    state.overlayCanvas = c;
    state.overlayCtx = c.getContext('2d');

    window.addEventListener('resize', () => {
      c.width = window.innerWidth; c.height = window.innerHeight;
      drawOverlay();
    });

    // mouse interactions when editMode is on
    c.addEventListener('mousedown', (ev) => {
      if (!state.editMode) return;
      const m = mapMouseToGrid(ev);
      // if click on control + drag -> start dragging the entire overlay
      if (!state.locked && ev.shiftKey) {
        state.dragging = true;
        state.dragOffset.x = ev.clientX - state.pos.x;
        state.dragOffset.y = ev.clientY - state.pos.y;
        return;
      }
      // treat as a pixel click
      handlePixelClickAt(m.gridX, m.gridY, ev);
    });

    window.addEventListener('mouseup', () => state.dragging = false);
    window.addEventListener('mousemove', (ev) => {
      if (!state.editMode) return;
      // dragging overlay when shift held and dragging true
      if (state.dragging && !state.locked) {
        state.pos.x = ev.clientX - state.dragOffset.x;
        state.pos.y = ev.clientY - state.dragOffset.y;
        Utils.saveLocal();
        drawOverlay();
      } else {
        // hover tooltip
        const m = mapMouseToGrid(ev);
        handleHover(m.gridX, m.gridY, ev);
      }
    });
  }

  // map mouse position to grid coordinates (x,y)
  function mapMouseToGrid(ev) {
    const x = ev.clientX, y = ev.clientY;
    const gx = Math.floor((x - state.pos.x) / state.scale);
    const gy = Math.floor((y - state.pos.y) / state.scale);
    return { clientX: x, clientY: y, gridX: gx, gridY: gy };
  }

  // ---------- IMAGE UPLOAD + PROCESS ----------
  async function onUploadClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        state._lastImageObj = img;
        // If grid sizes are zero, auto set to image dimensions
        let targetW = parseInt(document.getElementById('wpo-gridW').value) || 0;
        let targetH = parseInt(document.getElementById('wpo-gridH').value) || 0;
        if (targetW <= 0 || targetH <= 0) {
          // default: try to use image width/height but clamp to reasonable max
          targetW = img.naturalWidth;
          targetH = img.naturalHeight;
          document.getElementById('wpo-gridW').value = targetW;
          document.getElementById('wpo-gridH').value = targetH;
        }
        // Pixelate to grid (nearest neighbor)
        const idata = Utils.pixelateImageToGrid(img, targetW, targetH);
        // Build state.pixels array
        state.pixels = [];
        state.gridW = targetW; state.gridH = targetH;
        const d = idata.data;
        for (let gy=0; gy<targetH; gy++) {
          for (let gx=0; gx<targetW; gx++) {
            const idx = (gy * targetW + gx) * 4;
            const r = d[idx], g = d[idx+1], b = d[idx+2], a = d[idx+3];
            if (a < CONFIG.TRANSPARENCY_THRESHOLD) {
              // skip transparent pixels entirely
              continue;
            }
            // skip nearly-white to avoid background (unless user wants whites)
            if (r>=CONFIG.WHITE_THRESHOLD && g>=CONFIG.WHITE_THRESHOLD && b>=CONFIG.WHITE_THRESHOLD) {
              continue;
            }
            const pal = Utils.findClosestPalette([r,g,b]);
            state.pixels.push({
              x: gx, y: gy,
              rgb: [r,g,b],
              paletteId: pal.id,
              paletteName: pal.name,
              done: false
            });
          }
        }
        state.imageLoaded = true;
        // store the image ref for preview/auto options
        state._lastImageObj = img;
        // save and redraw
        Utils.saveLocal();
        drawOverlay();
        updateProgressUI();
        showTip('Image processed into grid', 1400);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => showTip('Failed to load image', 1400);
      img.src = url;
    };
    input.click();
  }

  // ---------- DRAWING ----------
  function drawOverlay() {
    if (!state.overlayCtx) return;
    const ctx = state.overlayCtx;
    ctx.clearRect(0,0, state.overlayCanvas.width, state.overlayCanvas.height);

    // nothing loaded
    if (!state.imageLoaded) return;

    // draw each pixel cell
    for (const p of state.pixels) {
      const sx = Math.round(state.pos.x + p.x * state.scale);
      const sy = Math.round(state.pos.y + p.y * state.scale);
      if (!p.done) {
        ctx.fillStyle = `rgba(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]},${state.editMode ? 0.9 : 0.5})`;
        ctx.fillRect(sx, sy, state.scale, state.scale);
      } else {
        // done pixels are transparent (do nothing) OR optionally draw faint check
        ctx.clearRect(sx, sy, state.scale, state.scale);
      }
      // draw grid line if visible
      if (state.gridVisible) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx+0.5, sy+0.5, state.scale-1, state.scale-1);
      }
    }

    // optionally draw outline around overlay area
    if (state.imageLoaded) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      ctx.strokeRect(state.pos.x - 2, state.pos.y - 2, state.gridW*state.scale + 4, state.gridH*state.scale + 4);
    }
  }

  // ---------- PIXEL CLICK / HOVER ----------
  const hoverTip = document.createElement('div');
  hoverTip.style.cssText = 'position:fixed; z-index:100003; pointer-events:none; font-size:12px; padding:6px 8px; background:rgba(10,12,15,0.9); color:#fff; border-radius:6px; display:none;';
  document.body.appendChild(hoverTip);

  function handleHover(gridX, gridY, ev) {
    const p = state.pixels.find(x => x.x === gridX && x.y === gridY && !x.done);
    if (p) {
      hoverTip.style.left = (ev.clientX + 12) + 'px';
      hoverTip.style.top = (ev.clientY + 12) + 'px';
      hoverTip.textContent = `${p.paletteName} (id ${p.paletteId})`;
      hoverTip.style.display = 'block';
    } else hoverTip.style.display = 'none';
  }

  function handlePixelClickAt(gridX, gridY, ev) {
    // find pixel
    const p = state.pixels.find(x => x.x === gridX && x.y === gridY);
    if (!p) {
      showTip('No paintable pixel here', 800);
      return;
    }
    // simulate click on Wplace's color button (#color-<id>)
    try {
      const btn = document.querySelector(`#color-${p.paletteId}`);
      if (btn) {
        // click the button — sometimes games use custom events; this is the best we can do
        btn.click();
      } else {
        showTip('Palette button not detected on page', 1200);
      }
    } catch(e){ console.warn(e); }

    // mark done and persist
    p.done = true;
    Utils.saveLocal();
    drawOverlay();
    updateProgressUI();
  }

  // ---------- PROGRESS UI ----------
  function updateProgressUI() {
    const total = state.pixels.length;
    const done = state.pixels.filter(p=>p.done).length;
    const pct = total ? Math.round((done/total)*100) : 0;
    const bar = document.querySelector('#wpo-progress-bar > div');
    if (bar) bar.style.width = pct + '%';
    const pt = document.getElementById('wpo-progress-text');
    if (pt) pt.textContent = `${done} / ${total} (${pct}%)`;
  }

  // ---------- UI STATE helpers ----------
  function updateEditUI() {
    const knob = document.getElementById('wpo-toggle-knob');
    const box = document.getElementById('wpo-toggle-box');
    if (!knob || !box) return;
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
  }

  // ---------- INIT ----------
  function initAll() {
    buildPanel();
    createOverlayCanvas();
    Utils.loadLocal();
    // reflect loaded settings into inputs
    document.getElementById('wpo-scale').value = state.scale;
    document.getElementById('wpo-gridW').value = state.gridW || 0;
    document.getElementById('wpo-gridH').value = state.gridH || 0;
    document.getElementById('wpo-grid-toggle').textContent = `Grid: ${state.gridVisible ? 'On' : 'Off'}`;
    updateEditUI();
    drawOverlay();
    updateProgressUI();
  }

  // initialize
  initAll();

  // expose some debug functions on window for convenience
  window.WPO = {
    state,
    drawOverlay,
    save: Utils.saveLocal,
    load: Utils.loadLocal,
    resetAll: () => { state.pixels = []; state.gridW = 0; state.gridH = 0; state.imageLoaded = false; Utils.saveLocal(); drawOverlay(); updateProgressUI(); }
  };

  // friendly message
  showTip('WPlace Overlay loaded — click Upload', 1600);
})();
