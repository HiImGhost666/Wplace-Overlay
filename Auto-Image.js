// WPlace Overlay — FIXED FULL VERSION
// Host this file and use via bookmarklet:
// javascript:fetch("https://yourhost.com/wplace-overlay-fixed.js").then(r=>r.text()).then(eval);

(() => {
  // -------------------------
  // CONFIG / DEFAULTS
  // -------------------------
  const CONFIG = {
    LOCAL_KEY: 'wplace_overlay_v3',
    TRANSPARENCY_THRESHOLD: 10,
    WHITE_THRESHOLD: 250,
    DEFAULT_TILE_SIZE: 4,        // default onscreen pixels per WPlace pixel (adjustable)
    PALETTE_DETECT_INTERVAL_MS: 1200,
    THEME: {
      panelBg: "#0f1720",
      accent: "#7c3aed",
      text: "#e6eef8",
      subtext: "#9aa7bf"
    }
  };

  // Built-in fallback palette (kept for reliability)
  const FALLBACK_PALETTE = [
    { id: 1, name: "Black",        rgb: [0,0,0] },
    { id: 2, name: "Dark Gray",    rgb: [60,60,60] },
    { id: 3, name: "Gray",         rgb: [120,120,120] },
    { id: 4, name: "Light Gray",   rgb: [210,210,210] },
    { id: 5, name: "White",        rgb: [255,255,255] },
    { id: 6, name: "Deep Red",     rgb: [96,0,24] },
    { id: 7, name: "Red",          rgb: [237,28,36] },
    { id: 8, name: "Orange",       rgb: [255,127,39] },
    { id: 9, name: "Gold",         rgb: [246,170,9] },
    { id:10, name: "Yellow",       rgb: [249,221,59] },
    { id:11, name: "Light Yellow", rgb: [255,250,188] },
    { id:12, name: "Dark Green",   rgb: [14,185,104] },
    { id:13, name: "Green",        rgb: [19,230,123] },
    { id:14, name: "Light Green",  rgb: [135,255,94] },
    { id:15, name: "Dark Teal",    rgb: [12,129,110] },
    { id:16, name: "Teal",         rgb: [16,174,166] },
    { id:17, name: "Light Teal",   rgb: [19,225,190] },
    { id:18, name: "Dark Blue",    rgb: [40,80,158] },
    { id:19, name: "Blue",         rgb: [64,147,228] },
    { id:20, name: "Cyan",         rgb: [96,247,242] },
    { id:21, name: "Indigo",       rgb: [107,80,246] },
    { id:22, name: "Light Indigo", rgb: [153,177,251] },
    { id:23, name: "Dark Purple",  rgb: [120,12,153] },
    { id:24, name: "Purple",       rgb: [170,56,185] },
    { id:25, name: "Light Purple", rgb: [224,159,249] },
    { id:26, name: "Dark Pink",    rgb: [203,0,122] },
    { id:27, name: "Pink",         rgb: [236,31,128] },
    { id:28, name: "Light Pink",   rgb: [243,141,169] },
    { id:29, name: "Dark Brown",   rgb: [104,70,52] },
    { id:30, name: "Brown",        rgb: [149,104,42] },
    { id:31, name: "Beige",        rgb: [248,178,119] }
  ];

  // -------------------------
  // APP STATE
  // -------------------------
  const state = {
    overlayCanvas: null,
    overlayCtx: null,
    pixels: [],           // array of {x,y,r,g,b,paletteId,paletteName,done}
    gridW: 0, gridH: 0,   // pixel grid size (in WPlace pixels)
    tileSize: CONFIG.DEFAULT_TILE_SIZE, // screen px per grid cell
    pos: { x: 100, y: 100 },
    editMode: false,
    gridVisible: true,
    locked: false,
    lastImageObj: null,   // HTMLImageElement of last uploaded image
    lastImageSrc: null,   // object URL for last uploaded image (for reference)
    palette: [],          // dynamic palette loaded from page (array of {id,name,rgb})
    paletteDetected: false
  };

  // -------------------------
  // UTILS
  // -------------------------
  const Utils = {
    distanceSq: (a,b) => (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2,
    findClosestPalette: (rgb) => {
      let best = { id: null, name: null, dist: Infinity, rgb: null };
      const pal = (state.palette && state.palette.length) ? state.palette : FALLBACK_PALETTE;
      for (const p of pal) {
        const d = Utils.distanceSq(rgb, p.rgb);
        if (d < best.dist) best = { id: p.id, name: p.name, dist: d, rgb: p.rgb };
      }
      return best;
    },
    pixelateImageToGrid: (img, targetW, targetH) => {
      // Nearest-neighbor resample: draw into a new canvas of targetW x targetH with imageSmoothing disabled
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
        const save = {
          pos: state.pos,
          tileSize: state.tileSize,
          gridW: state.gridW,
          gridH: state.gridH,
          gridVisible: state.gridVisible,
          locked: state.locked,
          editMode: state.editMode,
          pixelsDone: state.pixels.map(p => !!p.done),
          lastImageSrc: state.lastImageSrc
        };
        localStorage.setItem(CONFIG.LOCAL_KEY, JSON.stringify(save));
      } catch (e) { console.warn('WPO save failed', e); }
    },
    loadLocal: () => {
      try {
        const raw = localStorage.getItem(CONFIG.LOCAL_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed.pos) state.pos = parsed.pos;
        if (parsed.tileSize) state.tileSize = parsed.tileSize;
        if (parsed.gridW) state.gridW = parsed.gridW;
        if (parsed.gridH) state.gridH = parsed.gridH;
        if (typeof parsed.gridVisible === 'boolean') state.gridVisible = parsed.gridVisible;
        if (typeof parsed.locked === 'boolean') state.locked = parsed.locked;
        if (typeof parsed.editMode === 'boolean') state.editMode = parsed.editMode;
        if (parsed.lastImageSrc) state.lastImageSrc = parsed.lastImageSrc;
        // pixelsDone will be restored only after pixels are built (matching length)
        return parsed;
      } catch (e) { console.warn('WPO load failed', e); }
    }
  };

  // -------------------------
  // STYLES
  // -------------------------
  (function injectStyles(){
    const s = document.createElement('style');
    s.textContent = `
      #wpo-panel { position:fixed; right:18px; top:18px; width:330px; z-index:100001;
        background: linear-gradient(180deg, ${CONFIG.THEME.panelBg}, #071022);
        color:${CONFIG.THEME.text}; border-radius:12px; padding:12px; box-shadow:0 10px 30px rgba(2,6,23,0.6);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
        border: 1px solid rgba(255,255,255,0.03);
      }
      #wpo-panel h4 { margin:0 0 8px 0; font-size:15px; color:${CONFIG.THEME.accent}; display:flex;align-items:center; gap:8px }
      .wpo-row { display:flex; gap:8px; align-items:center; margin-bottom:8px; }
      .wpo-btn { flex:1; padding:8px 10px; border-radius:8px; border:none; cursor:pointer;
         background: rgba(255,255,255,0.03); color:${CONFIG.THEME.text}; font-weight:600; font-size:13px;
      }
      .wpo-btn.primary { background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #4c1d95); color:#fff; }
      .wpo-small { padding:6px 8px; font-size:12px; border-radius:6px; }
      .wpo-label { font-size:12px; color:${CONFIG.THEME.subtext}; }
      .wpo-input { width:85px; padding:6px; border-radius:8px; background:rgba(255,255,255,0.02); color:${CONFIG.THEME.text}; border:1px solid rgba(255,255,255,0.03); }
      #wpo-progress-bar { height:10px; background:rgba(255,255,255,0.06); border-radius:999px; overflow:hidden; margin-top:8px }
      #wpo-progress-bar > div { height:100%; background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #a78bfa); width:0% }
      #wpo-footer { font-size:12px; color:${CONFIG.THEME.subtext}; margin-top:8px; display:flex; justify-content:space-between; align-items:center }
      #wpo-toggle-box { width:36px; height:20px; border-radius:999px; background:rgba(255,255,255,0.06); padding:3px; cursor:pointer; display:inline-flex; align-items:center; }
      #wpo-toggle-knob { width:14px; height:14px; border-radius:999px; background:#fff; transform:translateX(0); transition:transform 0.15s; }
      .wpo-toggle-on { background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #a78bfa) !important; }
      #wpo-overlay-canvas { position:fixed; top:0; left:0; z-index:100000; pointer-events:none; }
      #wpo-tip { position:fixed; z-index:100002; padding:6px 8px; background:rgba(7,10,15,0.9); color:#fff; border-radius:6px; font-size:12px; display:none; white-space:nowrap; }
      #wpo-help-ul { font-size:12px; color:${CONFIG.THEME.subtext}; margin:6px 0 0 0; padding-left:16px; }
    `;
    document.head.appendChild(s);
  })();

  // -------------------------
  // PANEL BUILD
  // -------------------------
  function buildPanel() {
    const existing = document.getElementById('wpo-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'wpo-panel';
    panel.innerHTML = `
      <h4>🔳 WPlace Overlay — Fixed</h4>

      <div class="wpo-row">
        <button id="wpo-upload" class="wpo-btn primary">Upload Image</button>
        <button id="wpo-detect" class="wpo-btn wpo-small">Detect Palette</button>
      </div>

      <div class="wpo-row">
        <div style="flex:1">
          <div class="wpo-label">Grid size (W × H)</div>
          <div style="display:flex; gap:6px; margin-top:6px;">
            <input id="wpo-gridW" class="wpo-input" type="number" min="1" value="${state.gridW||0}" placeholder="width" />
            <input id="wpo-gridH" class="wpo-input" type="number" min="1" value="${state.gridH||0}" placeholder="height" />
            <button id="wpo-autoset" class="wpo-btn wpo-small">Auto</button>
          </div>
          <div id="wpo-small-note" class="wpo-label">If left 0, autoset uses image natural pixel dimensions.</div>
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
        <button id="wpo-reset" class="wpo-btn wpo-small">Reset Progress</button>
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
        <ul id="wpo-help-ul" style="display:none;">
          <li>Upload an image (pixel art works best).</li>
          <li>Set grid size to target WPlace pixels (Auto sets it to image size).</li>
          <li>Tile size controls how big each WPlace pixel appears on screen; adjust to match the site.</li>
          <li>Toggle Edit Mode to place pixels (canvas intercepts clicks only in Edit Mode).</li>
          <li>Click a pixel in Edit Mode — script will select the matching color in-site and mark it done.</li>
        </ul>
      </div>
    `;
    document.body.appendChild(panel);

    // DOM hooks
    document.getElementById('wpo-upload').onclick = uploadClick;
    document.getElementById('wpo-detect').onclick = detectPaletteNow;
    document.getElementById('wpo-autoset').onclick = () => {
      if (!state.lastImageObj) { showTip('Upload an image first'); return; }
      document.getElementById('wpo-gridW').value = state.lastImageObj.naturalWidth;
      document.getElementById('wpo-gridH').value = state.lastImageObj.naturalHeight;
      // auto reprocess if last image exists
      processLastImageWithInputs();
    };
    document.getElementById('wpo-gridW').onchange = () => processLastImageWithInputs();
    document.getElementById('wpo-gridH').onchange = () => processLastImageWithInputs();
    document.getElementById('wpo-scale').onchange = () => {
      const v = Math.max(1, parseInt(document.getElementById('wpo-scale').value) || CONFIG.DEFAULT_TILE_SIZE);
      state.tileSize = v; Utils.saveLocal(); drawOverlay();
    };
    document.getElementById('wpo-edit').onclick = () => { state.editMode = !state.editMode; updateEditUI(); Utils.saveLocal(); };
    document.getElementById('wpo-lock').onclick = () => { state.locked = !state.locked; document.getElementById('wpo-lock').textContent = state.locked ? 'Locked' : 'Lock'; Utils.saveLocal(); };
    document.getElementById('wpo-grid-toggle').onclick = () => { state.gridVisible = !state.gridVisible; document.getElementById('wpo-grid-toggle').textContent = `Grid: ${state.gridVisible ? 'On' : 'Off'}`; Utils.saveLocal(); drawOverlay(); };
    document.getElementById('wpo-reset').onclick = () => { if (!confirm('Reset progress? This will unmark placed pixels.')) return; state.pixels.forEach(p=>p.done=false); Utils.saveLocal(); drawOverlay(); updateProgressUI(); };
    document.getElementById('wpo-toggle-box').onclick = () => { state.editMode = !state.editMode; updateEditUI(); Utils.saveLocal(); };
    document.getElementById('wpo-move-handle').onmousedown = (e) => startOverlayMove(e);
    document.getElementById('wpo-help').onclick = () => {
      const ul = document.getElementById('wpo-help-ul');
      ul.style.display = ul.style.display === 'none' ? 'block' : 'none';
    };

    updateEditUI();
    updateProgressUI();
  }

  // -------------------------
  // TIP / HINT AREA
  // -------------------------
  const tip = document.createElement('div');
  tip.id = 'wpo-tip';
  document.body.appendChild(tip);
  function showTip(text, ms = 1400) {
    tip.textContent = text;
    tip.style.left = (window.innerWidth/2 - 160) + 'px';
    tip.style.top = '72px';
    tip.style.display = 'block';
    clearTimeout(tip._t);
    tip._t = setTimeout(()=> tip.style.display = 'none', ms);
  }

  // -------------------------
  // OVERLAY CANVAS
  // -------------------------
  function createOverlayCanvas() {
    if (state.overlayCanvas) return;
    const c = document.createElement('canvas');
    c.id = 'wpo-overlay-canvas';
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    c.style.pointerEvents = 'none'; // only enable when editMode true
    document.body.appendChild(c);
    state.overlayCanvas = c;
    state.overlayCtx = c.getContext('2d');

    // responsive
    window.addEventListener('resize', () => {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
      drawOverlay();
    });

    // interactions WHEN editMode enabled (pointer-events toggled)
    c.addEventListener('mousedown', (ev) => {
      if (!state.editMode) return;
      ev.preventDefault();
      ev.stopPropagation();
      // shift + click -> start overlay drag (fallback)
      if (!state.locked && ev.shiftKey) {
        state._draggingOverlay = true;
        state._dragOffset = { x: ev.clientX - state.pos.x, y: ev.clientY - state.pos.y };
        return;
      }
      const m = mapMouseToGrid(ev.clientX, ev.clientY);
      handlePixelClickAt(m.gridX, m.gridY, ev);
    });

    window.addEventListener('mouseup', () => {
      state._draggingOverlay = false;
      state._dragOffset = null;
    });
    window.addEventListener('mousemove', (ev) => {
      if (!state.editMode) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (state._draggingOverlay && !state.locked) {
        state.pos.x = ev.clientX - state._dragOffset.x;
        state.pos.y = ev.clientY - state._dragOffset.y;
        Utils.saveLocal();
        drawOverlay();
        return;
      }
      const m = mapMouseToGrid(ev.clientX, ev.clientY);
      handleHover(m.gridX, m.gridY, ev.clientX, ev.clientY);
    });
  }

  function mapMouseToGrid(clientX, clientY) {
    const gx = Math.floor((clientX - state.pos.x) / state.tileSize);
    const gy = Math.floor((clientY - state.pos.y) / state.tileSize);
    return { gridX: gx, gridY: gy };
  }

  // -------------------------
  // PALETTE DETECTION
  // -------------------------
  let paletteDetectTimer = null;
  function detectPaletteNow() {
    // attempt immediate detection
    const p = extractPaletteFromPage();
    if (p && p.length) {
      state.palette = p;
      state.paletteDetected = true;
      showTip(`Palette detected (${p.length} colors)`, 1400);
      return true;
    } else {
      showTip('Palette not found — trying periodically (open palette in site UI).', 2200);
      // start periodic attempts
      if (paletteDetectTimer) clearInterval(paletteDetectTimer);
      paletteDetectTimer = setInterval(() => {
        const res = extractPaletteFromPage();
        if (res && res.length) {
          clearInterval(paletteDetectTimer);
          state.palette = res;
          state.paletteDetected = true;
          showTip(`Palette detected (${res.length} colors)`, 1400);
        }
      }, CONFIG.PALETTE_DETECT_INTERVAL_MS);
      return false;
    }
  }

  function extractPaletteFromPage() {
    // Strategy: look for elements with id starting with "color-" (button container)
    // Common markup used earlier: <button ... id="color-7" style="background: rgb(237, 28, 36);">
    // We'll find elements with id that match /^color-\d+$/ and then read style.backgroundColor or computed style
    try {
      const nodes = Array.from(document.querySelectorAll('[id^="color-"]'));
      const entries = [];
      for (const n of nodes) {
        const match = n.id.match(/^color-(\d+)$/);
        if (!match) continue;
        const id = parseInt(match[1]);
        // find RGB from inline style or computed style
        let rgb = null;
        // element might be the button OR a wrapper; check the element and any button inside
        const btn = (n.tagName.toLowerCase() === 'button') ? n : n.querySelector('button') || n;
        const inline = btn.style.backgroundColor || btn.style.background || n.style.backgroundColor || n.style.background;
        if (inline) {
          // inline might be 'rgb(r, g, b)'
          const m = inline.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (m) rgb = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
        }
        if (!rgb) {
          // computed style
          const comp = window.getComputedStyle(btn);
          const b = comp.backgroundColor || comp.background;
          const m = (b && b.match) ? b.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/) : null;
          if (m) rgb = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
        }
        if (!rgb) {
          // fallback: some colors are shown as background-image (checkerboard) for transparent; skip those
          continue;
        }
        entries.push({ id, name: btn.getAttribute('aria-label') || btn.title || `color-${id}`, rgb });
      }
      // sort by id ascending and return unique
      const uniq = {};
      for (const e of entries) uniq[e.id] = e;
      const result = Object.values(uniq).sort((a,b)=>a.id-b.id);
      return result;
    } catch (e) {
      console.warn('palette extract error', e);
      return null;
    }
  }

  // Start automatic palette detection on load
  detectPaletteNow();

  // -------------------------
  // IMAGE UPLOAD / PROCESS
  // -------------------------
  function uploadClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        state.lastImageObj = img;
        state.lastImageSrc = url;
        processLastImageWithInputs();
      };
      img.onerror = () => {
        showTip('Image load failed');
        URL.revokeObjectURL(url);
      };
      img.src = url;
    };
    input.click();
  }

  // Reprocess the last uploaded image using current grid inputs
  function processLastImageWithInputs() {
    if (!state.lastImageObj) { showTip('Upload an image first'); return; }
    // read inputs
    const gw = parseInt(document.getElementById('wpo-gridW').value) || 0;
    const gh = parseInt(document.getElementById('wpo-gridH').value) || 0;
    const targetW = (gw > 0) ? gw : state.lastImageObj.naturalWidth;
    const targetH = (gh > 0) ? gh : state.lastImageObj.naturalHeight;
    // set grid dims
    state.gridW = targetW;
    state.gridH = targetH;
    // pixelate
    const idata = Utils.pixelateImageToGrid(state.lastImageObj, targetW, targetH);
    buildPixelsFromImageData(idata, targetW, targetH);
    // try restore done flags if saved before
    tryRestoreDoneFlags();
    Utils.saveLocal();
    drawOverlay();
    updateProgressUI();
    showTip(`Image processed: ${targetW} x ${targetH}`, 1200);
  }

  function buildPixelsFromImageData(idata, w, h) {
    const d = idata.data;
    const pixels = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const r = d[idx], g = d[idx+1], b = d[idx+2], a = d[idx+3];
        if (a < CONFIG.TRANSPARENCY_THRESHOLD) continue; // skip transparent
        if (r >= CONFIG.WHITE_THRESHOLD && g >= CONFIG.WHITE_THRESHOLD && b >= CONFIG.WHITE_THRESHOLD) continue; // skip near-white background
        const pal = Utils.findClosestPalette([r,g,b]);
        pixels.push({
          x, y,
          r, g, b,
          paletteId: pal.id,
          paletteName: pal.name,
          done: false
        });
      }
    }
    state.pixels = pixels;
    state.imageLoaded = pixels.length > 0;
  }

  // try restore done flags saved earlier (called after build)
  function tryRestoreDoneFlags() {
    const raw = localStorage.getItem(CONFIG.LOCAL_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.pixelsDone) return;
      if (Array.isArray(parsed.pixelsDone) && parsed.pixelsDone.length === state.pixels.length) {
        for (let i = 0; i < parsed.pixelsDone.length; i++) state.pixels[i].done = !!parsed.pixelsDone[i];
      }
    } catch (e) { console.warn('restore flags fail', e); }
  }

  // -------------------------
  // DRAWING
  // -------------------------
  function drawOverlay() {
    if (!state.overlayCtx) return;
    const ctx = state.overlayCtx;
    ctx.clearRect(0, 0, state.overlayCanvas.width, state.overlayCanvas.height);

    if (!state.imageLoaded) {
      // if no image, optionally show bounding box if grid dims exist
      if (state.gridW && state.gridH) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.strokeRect(state.pos.x - 2, state.pos.y - 2, state.gridW * state.tileSize + 4, state.gridH * state.tileSize + 4);
      }
      return;
    }

    let doneCount = 0;
    for (const p of state.pixels) {
      const sx = Math.round(state.pos.x + p.x * state.tileSize);
      const sy = Math.round(state.pos.y + p.y * state.tileSize);
      if (!p.done) {
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${state.editMode ? 0.96 : 0.66})`;
        ctx.fillRect(sx, sy, state.tileSize, state.tileSize);
      } else {
        // clear done cells so site shows through
        ctx.clearRect(sx, sy, state.tileSize, state.tileSize);
        doneCount++;
      }
      if (state.gridVisible) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, sy + 0.5, state.tileSize - 1, state.tileSize - 1);
      }
    }

    // outline around overlay
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.strokeRect(state.pos.x - 2, state.pos.y - 2, state.gridW * state.tileSize + 4, state.gridH * state.tileSize + 4);

    // update progress numeric in UI
    updateProgressUI();
  }

  // -------------------------
  // HOVER & CLICK
  // -------------------------
  const hoverTip = document.createElement('div');
  hoverTip.style.cssText = 'position:fixed;z-index:100003;padding:6px 8px;background:rgba(7,10,15,0.9);color:#fff;border-radius:6px;font-size:12px;display:none;pointer-events:none;';
  document.body.appendChild(hoverTip);

  function handleHover(gridX, gridY, clientX, clientY) {
    const p = state.pixels.find(px => px.x === gridX && px.y === gridY && !px.done);
    if (p) {
      hoverTip.style.left = (clientX + 12) + 'px';
      hoverTip.style.top = (clientY + 12) + 'px';
      hoverTip.textContent = `${p.paletteName} (id ${p.paletteId})`;
      hoverTip.style.display = 'block';
    } else {
      hoverTip.style.display = 'none';
    }
  }

  function handlePixelClickAt(gridX, gridY, ev) {
    const p = state.pixels.find(px => px.x === gridX && px.y === gridY);
    if (!p) { showTip('No paintable pixel here', 800); return; }
    // attempt to click color button on page
    try {
      // first try using id-style buttons (#color-<id>)
      let btn = document.querySelector(`#color-${p.paletteId}`);
      if (!btn) {
        // fallback: search elements with attribute aria-label or title matching palette name (case-insensitive)
        const name = p.paletteName && p.paletteName.toLowerCase();
        if (name) {
          const candidates = Array.from(document.querySelectorAll('button,div,span'));
          btn = candidates.find(el => {
            const a = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || '')).toLowerCase();
            return a.includes(name);
          });
        }
      }
      if (btn) {
        // dispatch click
        btn.click();
      } else {
        showTip('Palette button not detected. Try opening the palette UI in the site so the script can detect it.', 1700);
      }
    } catch (e) {
      console.warn('click color error', e);
    }
    // mark done
    p.done = true;
    Utils.saveLocal();
    drawOverlay();
    updateProgressUI();
  }

  // -------------------------
  // PROGRESS UI
  // -------------------------
  function updateProgressUI() {
    const total = state.pixels.length;
    const done = state.pixels.filter(p => p.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const bar = document.querySelector('#wpo-progress-bar > div');
    if (bar) bar.style.width = pct + '%';
    const txt = document.getElementById('wpo-progress-text');
    if (txt) txt.textContent = `${done} / ${total} (${pct}%)`;
  }

  // -------------------------
  // MOVE OVERLAY VIA PANEL
  // -------------------------
  function startOverlayMove(e) {
    // user clicked Move Overlay button
    let active = true;
    const offset = { x: e.clientX - state.pos.x, y: e.clientY - state.pos.y };
    function moveHandler(ev) {
      if (!active || state.locked) return;
      state.pos.x = ev.clientX - offset.x;
      state.pos.y = ev.clientY - offset.y;
      Utils.saveLocal();
      drawOverlay();
    }
    function upHandler() {
      active = false;
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', upHandler);
      Utils.saveLocal();
    }
    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
  }

  // -------------------------
  // PANEL UI STATE
  // -------------------------
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
    document.getElementById('wpo-scale').value = state.tileSize;
    document.getElementById('wpo-grid-toggle').textContent = `Grid: ${state.gridVisible ? 'On' : 'Off'}`;
    document.getElementById('wpo-lock').textContent = state.locked ? 'Locked' : 'Lock';
  }

  // -------------------------
  // RESTORE FLAGS AFTER BUILD (helper)
  // -------------------------
  function restoreFlagsIfPossible(parsedSaved) {
    if (!parsedSaved || !Array.isArray(parsedSaved.pixelsDone)) return;
    if (parsedSaved.pixelsDone.length === state.pixels.length) {
      for (let i = 0; i < state.pixels.length; i++) state.pixels[i].done = !!parsedSaved.pixelsDone[i];
    }
  }

  // -------------------------
  // RESET
  // -------------------------
  function resetProgress() {
    state.pixels.forEach(p => p.done = false);
    Utils.saveLocal();
    drawOverlay();
    updateProgressUI();
    showTip('Progress reset');
  }

  // -------------------------
  // BOOTSTRAP / INIT
  // -------------------------
  function init() {
    buildPanel();
    createOverlayCanvas();
    // try load saved config
    const parsedSaved = Utils.loadLocal();
    if (parsedSaved) {
      // store parsed but pixels will be restored after user re-uploads (we can't reconstruct image blob automatically)
      // but we can restore pos/tileSize/grid settings.
      // if lastImageSrc exists we keep it as reference, but user must re-upload to rebuild the grid visually.
      console.debug('Loaded saved state', parsedSaved);
    }
    // update UI to reflect loaded state
    updateEditUI();
    drawOverlay();
    updateProgressUI();
    showTip('WPlace Overlay loaded — click Upload', 1500);
  }

  // -------------------------
  // HELPERS exposed
  // -------------------------
  window.WPO = {
    state,
    drawOverlay,
    save: Utils.saveLocal,
    load: Utils.loadLocal,
    reset: resetProgress,
    detectPaletteNow
  };

  // keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'e') { state.editMode = !state.editMode; updateEditUI(); Utils.saveLocal(); }
    if (e.key === 'g') { state.gridVisible = !state.gridVisible; drawOverlay(); Utils.saveLocal(); }
  });

  // finally run init
  init();

  // Periodically attempt palette detection in background if not detected
  const autoDetectTimer = setInterval(() => {
    if (!state.paletteDetected) detectPaletteNow();
    else clearInterval(autoDetectTimer);
  }, 3000);

})();
