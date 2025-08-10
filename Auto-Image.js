// == WPlace Auto-Image (map-anchored, fixed) ==
// Save as Auto-Image.js and host raw. Use bookmarklet:
// javascript:fetch("https://yourhost.com/Auto-Image.js").then(r=>r.text()).then(eval);

(async () => {
  /* ---------------------------------------------------------------------------
     CONFIG
  --------------------------------------------------------------------------- */
  const CONFIG = {
    COOLDOWN_DEFAULT: 31000,
    TRANSPARENCY_THRESHOLD: 100,
    WHITE_THRESHOLD: 250,
    LOG_INTERVAL: 10,
    LOCAL_KEY: 'wplace_overlay_v4',
    // The overlay will try to attach to one of these candidate panes (map layers)
    MAP_CONTAINER_SELECTORS: [
      '.leaflet-zoom-animated',       // Leaflet panes
      '.leaflet-map-pane',            // other Leaflet containers
      '.mapboxgl-canvas-container',   // Mapbox GL
      '.mapboxgl-viewport',           // Mapbox viewport
      '.gm-style',                    // Google Maps container
      '#map',                         // common id
      '.map-root',                    // fallback
      'body'                          // ultimate fallback, will still work but won't auto-zoom
    ],
    THEME: {
      primary: '#0b0b0d',
      panel: '#0f1720',
      accent: '#6d28d9',
      text: '#e6eef8',
      subtext: '#9aa7bf',
      success: '#10b981',
      error: '#ef4444'
    },
    PALETTE_DETECT_INTERVAL_MS: 2000
  };

  /* ---------------------------------------------------------------------------
     TEXTS
  --------------------------------------------------------------------------- */
  const TEXTS = {
    en: {
      title: 'WPlace Auto-Image (anchored)',
      initBot: 'Init',
      uploadImage: 'Upload Image',
      resizeImage: 'Resize',
      selectPosition: 'Select Position',
      startPainting: 'Start Painting',
      stopPainting: 'Stop',
      checkingColors: '🔍 Checking available colors...',
      noColorsFound: '❌ Open the color palette and try Detect!',
      colorsFound: '✅ {count} palette colors found',
      loadingImage: '🖼️ Loading image...',
      imageLoaded: '✅ Image processed: {count} pixels',
      imageError: '❌ Error loading image',
      selectPositionAlert: 'Click the tile on map where image top-left should be (in edit mode)',
      waitingPosition: '👆 Waiting for position click...',
      positionSet: '✅ Position set',
      positionTimeout: '❌ Timeout selecting position',
      startPaintingMsg: '🎨 Ready — use map to paint manually (click a pixel to select color).',
      paintingProgress: '🧱 Progress: {painted}/{total}',
      noCharges: '⌛ No charges. Waiting {time}...',
      paintingStopped: '⏹️ Stopped',
      paintingComplete: '✅ Complete {count} pixels',
      missingRequirements: '❌ Upload image and set position first',
      initMessage: 'Click Init, then open color palette and Detect Palette',
      waitingInit: 'Waiting for init...',
      resizeSuccess: '✅ Image resized to {width}x{height}',
      paintingPaused: '⏸️ Paused at X:{x}, Y:{y}'
    }
  };

  /* ---------------------------------------------------------------------------
     STATE
  --------------------------------------------------------------------------- */
  const state = {
    language: 'en',
    overlayCanvas: null,
    overlayCtx: null,
    mapContainer: null,       // DOM element we attach overlay to (map pane)
    mapIsTransformed: false,  // whether map uses transforms to zoom (most do)
    palette: [],              // array {id, name, rgb:[r,g,b]}
    paletteDetected: false,
    image: null,              // last uploaded Image element
    imageSrcUrl: null,
    gridW: 0,
    gridH: 0,
    tileSize: 4,              // on-screen pixels per WPlace pixel (editable)
    pos: { x: 0, y: 0 },      // top-left position in *map local pixels* (not screen)
    pixels: [],               // array of {x,y,r,g,b,paletteId,paletteName,done}
    editMode: false,
    gridVisible: true,
    locked: false,
    selectingPosition: false,
    startPositionSet: false,
    startRegion: null,
    lastPosition: { x: 0, y: 0 },
    minimized: false,
    savedSettings: null,
    imageLoaded: false
  };

  /* ---------------------------------------------------------------------------
     UTILS
  --------------------------------------------------------------------------- */
  const Utils = {
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    colorDistance: (a, b) => Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2),
    t: (k, params={}) => {
      let s = TEXTS[state.language][k] || TEXTS.en[k] || k;
      Object.entries(params).forEach(([kk,v]) => s = s.replace(`{${kk}}`, v));
      return s;
    },
    showTip: (msg, ms=1600) => {
      const tip = document.getElementById('wpa-tip');
      if (!tip) return;
      tip.textContent = msg;
      tip.style.display = 'block';
      clearTimeout(tip._t);
      tip._t = setTimeout(()=> tip.style.display='none', ms);
    },
    createImageUploader: () => new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg';
      input.onchange = () => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.readAsDataURL(input.files[0]);
      };
      input.click();
    }),
    saveLocal: () => {
      try {
        const saved = {
          gridW: state.gridW, gridH: state.gridH,
          tileSize: state.tileSize,
          pos: state.pos,
          gridVisible: state.gridVisible,
          locked: state.locked,
          pixelsDone: state.pixels.map(p => !!p.done),
          imageSrcUrl: state.imageSrcUrl
        };
        localStorage.setItem(CONFIG.LOCAL_KEY, JSON.stringify(saved));
      } catch(e){ console.warn('save failed', e); }
    },
    loadLocal: () => {
      try {
        const raw = localStorage.getItem(CONFIG.LOCAL_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch(e) { console.warn('load failed', e); return null; }
    },
    // pixelate nearest-neighbor to target grid size
    pixelateImageToGrid: (img, targetW, targetH) => {
      const tmp = document.createElement('canvas');
      tmp.width = targetW;
      tmp.height = targetH;
      const ctx = tmp.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, targetW, targetH);
      return ctx.getImageData(0,0,targetW,targetH);
    }
  };

  /* ---------------------------------------------------------------------------
     PALETTE DETECTION
     - dynamic detection from page. looks for: [id^="color-"] OR .btn with background
  --------------------------------------------------------------------------- */
  function extractPaletteFromPage() {
    try {
      const nodes = Array.from(document.querySelectorAll('[id^="color-"], .btn[style], .color-swatch, button[aria-label]'));
      const entries = [];
      for (const n of nodes) {
        // try id pattern color-N
        let id = null;
        const m = n.id && n.id.match(/^color-(\d+)$/);
        if (m) id = parseInt(m[1]);

        // find element that holds background color (n or a child)
        const btn = (n.tagName.toLowerCase()==='button') ? n : (n.querySelector('button') || n);
        // read inline or computed background
        let rgb = null;
        const inline = btn && (btn.style.background || btn.style.backgroundColor);
        if (inline) {
          const mm = inline.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (mm) rgb = [parseInt(mm[1]),parseInt(mm[2]),parseInt(mm[3])];
        }
        if (!rgb && btn) {
          const cs = window.getComputedStyle(btn);
          const b = cs.backgroundColor || cs.background;
          const mm = b && b.match ? b.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/) : null;
          if (mm) rgb = [parseInt(mm[1]),parseInt(mm[2]),parseInt(mm[3])];
        }
        if (!rgb) continue; // skip if no color
        const name = (btn && ((btn.getAttribute && btn.getAttribute('aria-label')) || btn.title)) || `color-${id||entries.length+1}`;
        entries.push({ id: id === null ? entries.length+1 : id, name, rgb });
      }
      // dedupe & sort ascending
      const uniq = {};
      for (const e of entries) uniq[e.id] = e;
      const out = Object.values(uniq).sort((a,b)=>a.id-b.id);
      return out;
    } catch (e) {
      console.warn('palette extract error', e);
      return null;
    }
  }

  async function detectPalette(retry=true) {
    const p = extractPaletteFromPage();
    if (p && p.length > 0) {
      state.palette = p;
      state.paletteDetected = true;
      Utils.showTip(Utils.t('colorsFound', {count: p.length}), 1600);
      // reflect in UI maybe (not necessary)
      return true;
    } else {
      if (retry) {
        Utils.showTip(Utils.t('checkingColors'), 1200);
        // try periodically for some time
        let attempts = 0;
        const interval = setInterval(() => {
          attempts++;
          const r = extractPaletteFromPage();
          if (r && r.length) {
            clearInterval(interval);
            state.palette = r;
            state.paletteDetected = true;
            Utils.showTip(Utils.t('colorsFound', {count: r.length}), 1400);
          } else if (attempts > 12) {
            clearInterval(interval);
            Utils.showTip(Utils.t('noColorsFound'), 2600);
          }
        }, CONFIG.PALETTE_DETECT_INTERVAL_MS);
      } else {
        Utils.showTip(Utils.t('noColorsFound'), 1600);
      }
      return false;
    }
  }

  function findClosestColorId(rgb) {
    if (!state.palette || state.palette.length === 0) {
      // fallback to built-in static palette if detection failed (from earlier file)
      // small built-in mapping (ids 1..31)
      const builtin = [
        [0,0,0], [60,60,60],[120,120,120],[210,210,210],[255,255,255],
        [96,0,24],[237,28,36],[255,127,39],[246,170,9],[249,221,59],
        [255,250,188],[14,185,104],[19,230,123],[135,255,94],[12,129,110],
        [16,174,166],[19,225,190],[40,80,158],[64,147,228],[96,247,242],
        [107,80,246],[153,177,251],[120,12,153],[170,56,185],[224,159,249],
        [203,0,122],[236,31,128],[243,141,169],[104,70,52],[149,104,42],[248,178,119]
      ];
      let best=0; let bd=Infinity;
      for (let i=0;i<builtin.length;i++){
        const d = Utils.colorDistance(rgb, builtin[i]);
        if (d < bd) { bd = d; best = i+1; }
      }
      return best;
    } else {
      let bestIdx = 0; let bd = Infinity;
      for (let i=0;i<state.palette.length;i++){
        const p = state.palette[i];
        const d = Utils.colorDistance(rgb, p.rgb);
        if (d < bd) { bd = d; bestIdx = p.id; }
      }
      return bestIdx;
    }
  }

  /* ---------------------------------------------------------------------------
     FIND MAP CONTAINER & ATTACH OVERLAY
     Strategy:
      - Try known selectors for map panes (Leaflet, Mapbox, Google, etc)
      - If found, append overlay canvas as first child and set styles so it moves with transform
      - If not found, fallback to body (overlay will be screen-anchored)
     Note: We try to append the overlay to a transformed element so zoom/pan also affects overlay.
  --------------------------------------------------------------------------- */
  function findMapContainer() {
    for (const sel of CONFIG.MAP_CONTAINER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        // prefer panes that are children of map root (avoid overlay panel)
        return el;
      }
    }
    return document.body;
  }

  function createOverlayCanvas() {
    // if already created, noop
    if (state.overlayCanvas) return;

    // find map container and attach overlay inside it
    const mapEl = findMapContainer();
    state.mapContainer = mapEl;

    const canvas = document.createElement('canvas');
    canvas.id = 'wpa-overlay-canvas';
    // if using map container (not body) make the canvas positioned absolute to that container
    canvas.style.position = 'absolute';
    canvas.style.left = '0px';
    canvas.style.top = '0px';
    canvas.style.width = `${mapEl.clientWidth}px`;
    canvas.style.height = `${mapEl.clientHeight}px`;
    canvas.style.pointerEvents = 'none'; // default: let map interactions through
    canvas.style.zIndex = 99990;
    // append to mapEl so it inherits transforms where possible
    try {
      mapEl.appendChild(canvas);
    } catch(e) {
      document.body.appendChild(canvas);
    }
    state.overlayCanvas = canvas;
    state.overlayCtx = canvas.getContext('2d');

    // set pixel backing store size for crispness
    function resizeCanvasToContainer() {
      const w = Math.max(1, state.mapContainer.clientWidth);
      const h = Math.max(1, state.mapContainer.clientHeight);
      // adjust backing store for device pixel ratio
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = state.overlayCtx;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawOverlay();
    }
    // initial size
    resizeCanvasToContainer();

    // watch container resize / map changes
    const ro = new ResizeObserver(resizeCanvasToContainer);
    ro.observe(state.mapContainer);

    // listen to some typical map events (these are generic and not map-lib-specific)
    window.addEventListener('wheel', () => requestAnimationFrame(drawOverlay), { passive: true });
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('mousemove', onPointerMove);

    // also observe DOM mutations (some libs change transforms)
    const mo = new MutationObserver(() => requestAnimationFrame(drawOverlay));
    mo.observe(state.mapContainer, { attributes: true, childList: true, subtree: true });

    // interactions: enable pointer events only in editMode for canvas; but allow dragging by overlay itself:
    canvas.addEventListener('mousedown', (ev) => {
      if (!state.editMode) return;
      ev.stopPropagation();
      ev.preventDefault();
      // check which grid pixel user clicked
      const local = getLocalCoords(ev.clientX, ev.clientY);
      const grid = screenToGrid(local.x, local.y);
      // if user holds Shift OR move-mode, start move overlay drag instead of pixel click
      if (!state.locked && (ev.shiftKey || state.moveOverlayDrag)) {
        startOverlayDrag(ev);
        return;
      }
      handlePixelClick(grid.gx, grid.gy, ev);
    });

    // double-click to toggle move mode (optional)
    canvas.addEventListener('dblclick', (ev) => {
      if (!state.editMode) return;
      state.moveOverlayDrag = !state.moveOverlayDrag;
      Utils.showTip(state.moveOverlayDrag ? 'Move overlay: ON (drag image)' : 'Move overlay: OFF', 900);
    });

    // store observers so we can disconnect later if needed
    state._resizeObserver = ro;
    state._mutationObserver = mo;
  }

  /* ---------------------------------------------------------------------------
     COORDINATE HELPERS
     - Because the overlay canvas is appended to the map container, we need to map
       screen coordinates (clientX/Y) to canvas-local coordinates, then to grid coords.
  --------------------------------------------------------------------------- */
  function getLocalCoords(clientX, clientY) {
    const rect = state.overlayCanvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function screenToGrid(localX, localY) {
    // The overlay draws each grid cell as state.tileSize screen pixels.
    const gx = Math.floor((localX - state.pos.x) / state.tileSize);
    const gy = Math.floor((localY - state.pos.y) / state.tileSize);
    return { gx, gy };
  }

  function gridToScreen(gx, gy) {
    return {
      x: state.pos.x + gx * state.tileSize,
      y: state.pos.y + gy * state.tileSize
    };
  }

  /* ---------------------------------------------------------------------------
     IMAGE PROCESSING
  --------------------------------------------------------------------------- */
  async function processUploadedImage(dataUrl, targetW = 0, targetH = 0) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        state.image = img;
        // default target grid is natural size unless user provided targetW/H
        const tw = targetW > 0 ? targetW : img.naturalWidth;
        const th = targetH > 0 ? targetH : img.naturalHeight;

        // pixelate nearest-neighbor
        const idata = Utils.pixelateImageToGrid(img, tw, th);
        // build pixels array
        const pixels = [];
        const d = idata.data;
        for (let y=0;y<th;y++){
          for (let x=0;x<tw;x++){
            const idx = (y*tw + x)*4;
            const r = d[idx], g = d[idx+1], b = d[idx+2], a = d[idx+3];
            if (a < CONFIG.TRANSPARENCY_THRESHOLD) continue;
            if (r>=CONFIG.WHITE_THRESHOLD && g>=CONFIG.WHITE_THRESHOLD && b>=CONFIG.WHITE_THRESHOLD) continue;
            const palId = findClosestColorId([r,g,b]);
            let palName = null;
            const palEntry = state.palette && state.palette.length ? (state.palette.find(p => p.id === palId) || null) : null;
            palName = palEntry ? palEntry.name : `id-${palId}`;
            pixels.push({ x, y, r, g, b, paletteId: palId, paletteName: palName, done: false });
          }
        }
        state.pixels = pixels;
        state.gridW = tw;
        state.gridH = th;
        state.imageSrcUrl = dataUrl;
        state.imageLoaded = true;
        Utils.saveLocal();
        drawOverlay();
        resolve({tw,th,pixels: pixels.length});
      };
      img.onerror = (e) => reject(e);
      img.src = dataUrl;
    });
  }

  /* ---------------------------------------------------------------------------
     DRAWING
  --------------------------------------------------------------------------- */
  function drawOverlay() {
    if (!state.overlayCtx || !state.overlayCanvas) return;
    const ctx = state.overlayCtx;
    // clear full canvas
    const c = state.overlayCanvas;
    ctx.clearRect(0,0,c.width, c.height);

    if (!state.imageLoaded) {
      // draw only bounding box if dims available
      if (state.gridW && state.gridH) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 2;
        ctx.strokeRect(state.pos.x - 2, state.pos.y - 2, state.gridW * state.tileSize + 4, state.gridH * state.tileSize + 4);
        ctx.restore();
      }
      return;
    }

    // draw each pixel as rectangle (not individual images) so it scales with map when appended to transformed container
    for (const p of state.pixels) {
      const sx = Math.round(state.pos.x + p.x * state.tileSize);
      const sy = Math.round(state.pos.y + p.y * state.tileSize);
      if (!p.done) {
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${state.editMode ? 0.95 : 0.6})`;
        ctx.fillRect(sx, sy, state.tileSize, state.tileSize);
      } else {
        // optionally mark done by clearing (so map content shows) or draw a faint check
        ctx.clearRect(sx, sy, state.tileSize, state.tileSize);
      }
      if (state.gridVisible) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, sy + 0.5, state.tileSize - 1, state.tileSize - 1);
      }
    }

    // outline
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.strokeRect(state.pos.x - 2, state.pos.y - 2, state.gridW * state.tileSize + 4, state.gridH * state.tileSize + 4);
    ctx.restore();

    // update progress UI
    updateStatsUI();
  }

  /* ---------------------------------------------------------------------------
     PIXEL INTERACTIONS
  --------------------------------------------------------------------------- */
  function handlePixelClick(gx, gy, ev) {
    // find pixel
    const p = state.pixels.find(x => x.x === gx && x.y === gy);
    if (!p) {
      Utils.showTip('No paintable pixel here', 800);
      return;
    }
    // attempt click on palette button in page
    try {
      // prefer #color-<id>
      let btn = document.querySelector(`#color-${p.paletteId}`);
      if (!btn && state.palette && state.palette.length) {
        // try lookup by name (aria-label/title)
        const name = (p.paletteName || '').toLowerCase();
        if (name) {
          const candidates = Array.from(document.querySelectorAll('button,div,span'));
          btn = candidates.find(el => {
            const al = ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '').toLowerCase();
            return al && al.includes(name);
          });
        }
      }
      if (btn) {
        btn.click();
      } else {
        Utils.showTip('Palette button not detected. Open palette in site then press Detect Palette.', 2000);
      }
    } catch (e) {
      console.warn('click error', e);
    }
    // mark done and persist
    p.done = true;
    Utils.saveLocal();
    drawOverlay();
  }

  /* ---------------------------------------------------------------------------
     DRAGGING THE OVERLAY (grab the image)
  --------------------------------------------------------------------------- */
  let _dragState = { dragging:false, startClient:{x:0,y:0}, startPos:{x:0,y:0} };

  function startOverlayDrag(ev) {
    if (state.locked) return;
    _dragState.dragging = true;
    _dragState.startClient = { x: ev.clientX, y: ev.clientY };
    _dragState.startPos = { x: state.pos.x, y: state.pos.y };
    // allow canvas to capture events while dragging
    state.overlayCanvas.style.pointerEvents = 'auto';
    // capture mouse
    window.addEventListener('mousemove', overlayDragMove);
    window.addEventListener('mouseup', overlayDragEnd);
  }

  function overlayDragMove(ev) {
    if (!_dragState.dragging) return;
    const dx = ev.clientX - _dragState.startClient.x;
    const dy = ev.clientY - _dragState.startClient.y;
    state.pos.x = _dragState.startPos.x + dx;
    state.pos.y = _dragState.startPos.y + dy;
    Utils.saveLocal();
    drawOverlay();
  }

  function overlayDragEnd(ev) {
    _dragState.dragging = false;
    state.overlayCanvas.style.pointerEvents = state.editMode ? 'auto' : 'none';
    window.removeEventListener('mousemove', overlayDragMove);
    window.removeEventListener('mouseup', overlayDragEnd);
  }

  function onPointerMove(ev) {
    if (!state.editMode) return;
    // show hover tip
    const loc = getLocalCoords(ev.clientX, ev.clientY);
    const g = screenToGrid(loc.x, loc.y);
    handleHover(g.gx, g.gy, ev.clientX, ev.clientY);
  }

  function onPointerUp(ev) {
    // ensure drag state cleaned
    if (_dragState.dragging) overlayDragEnd(ev);
  }

  function handleHover(gx, gy, clientX, clientY) {
    const elt = document.getElementById('wpa-hover');
    if (!elt) return;
    const p = state.pixels.find(px => px.x === gx && px.y === gy && !px.done);
    if (p) {
      elt.style.left = (clientX + 12) + 'px';
      elt.style.top = (clientY + 12) + 'px';
      elt.textContent = `${p.paletteName || 'color-'+p.paletteId} (id ${p.paletteId})`;
      elt.style.display = 'block';
    } else elt.style.display = 'none';
  }

  /* ---------------------------------------------------------------------------
     UI BUILD: panel, resize modal, progress etc. (I reused & improved your original UI)
  --------------------------------------------------------------------------- */
  function createUI() {
    // remove existing if present
    const existing = document.getElementById('wpa-panel');
    if (existing) existing.remove();

    // font-awesome for icons (use CDN)
    const fa = document.createElement('link');
    fa.rel = 'stylesheet';
    fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(fa);

    // inject styles
    const style = document.createElement('style');
    style.textContent = `
      #wpa-panel {
        position: fixed; right: 18px; top: 18px; width: 300px; z-index: 1000000;
        background: linear-gradient(180deg, ${CONFIG.THEME.panel}, ${CONFIG.THEME.primary});
        color: ${CONFIG.THEME.text}; border-radius: 10px; padding: 12px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.6); font-family: Inter, Roboto, sans-serif;
        border: 1px solid rgba(255,255,255,0.04);
      }
      #wpa-panel h3 { margin:0 0 8px 0; color:${CONFIG.THEME.accent}; font-size:15px; display:flex; gap:8px; align-items:center; }
      .wpa-row { display:flex; gap:8px; margin-bottom:8px; align-items:center; }
      .wpa-btn { flex:1; padding:8px 10px; border-radius:8px; border:none; cursor:pointer; background:rgba(255,255,255,0.03); color:${CONFIG.THEME.text}; font-weight:600; }
      .wpa-btn.primary { background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #4c1d95); color: white; }
      .wpa-btn.small { padding:6px 8px; font-size:12px; border-radius:6px; }
      .wpa-label { font-size:12px; color:${CONFIG.THEME.subtext}; }
      .wpa-input { width:82px; padding:6px; border-radius:8px; background:rgba(255,255,255,0.02); color:${CONFIG.THEME.text}; border:1px solid rgba(255,255,255,0.03); }
      #wpa-progress { height:10px; background: rgba(255,255,255,0.06); border-radius:999px; overflow:hidden; margin-top:6px; }
      #wpa-progress > div { height:100%; background: linear-gradient(90deg, ${CONFIG.THEME.accent}, #a78bfa); width:0%; }
      #wpa-tip { position: fixed; left: 50%; transform: translateX(-50%); top: 60px; background: rgba(0,0,0,0.75); color:#fff; padding:8px 12px; border-radius:6px; z-index:1000010; display:none; font-size:13px; }
      #wpa-hover { position: fixed; z-index: 1000020; padding:6px 8px; border-radius:6px; background: rgba(0,0,0,0.85); color:#fff; display:none; pointer-events:none; font-size:12px;}
    `;
    document.head.appendChild(style);

    // panel markup
    const panel = document.createElement('div');
    panel.id = 'wpa-panel';
    panel.innerHTML = `
      <h3><i class="fas fa-image"></i> ${Utils.t('title')}</h3>

      <div class="wpa-row">
        <button id="wpa-init" class="wpa-btn primary"><i class="fas fa-rocket"></i> Init</button>
      </div>

      <div class="wpa-row">
        <button id="wpa-upload" class="wpa-btn"><i class="fas fa-upload"></i> ${Utils.t('uploadImage')}</button>
        <button id="wpa-detect" class="wpa-btn small"><i class="fas fa-palette"></i> Detect Palette</button>
      </div>

      <div class="wpa-row">
        <div style="flex:1">
          <div class="wpa-label">Grid size (W × H)</div>
          <div style="display:flex;gap:6px;margin-top:6px">
            <input id="wpa-gridW" class="wpa-input" type="number" min="1" value="${state.gridW}" placeholder="W"/>
            <input id="wpa-gridH" class="wpa-input" type="number" min="1" value="${state.gridH}" placeholder="H"/>
            <button id="wpa-autoset" class="wpa-btn small">Auto</button>
          </div>
        </div>
      </div>

      <div class="wpa-row">
        <div style="flex:1">
          <div class="wpa-label">Tile size (screen px)</div>
          <input id="wpa-tileSize" class="wpa-input" type="number" min="1" value="${state.tileSize}">
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button id="wpa-edit" class="wpa-btn small">Edit Mode</button>
          <button id="wpa-lock" class="wpa-btn small">Lock</button>
        </div>
      </div>

      <div class="wpa-row">
        <button id="wpa-gridToggle" class="wpa-btn small">Grid: ${state.gridVisible ? 'On' : 'Off'}</button>
        <button id="wpa-reset" class="wpa-btn small">Reset</button>
      </div>

      <div>
        <div class="wpa-label">Progress</div>
        <div id="wpa-progress"><div style="width:0%"></div></div>
        <div id="wpa-progressText" class="wpa-label" style="margin-top:6px">0 / 0</div>
      </div>

      <div style="margin-top:8px" class="wpa-row">
        <button id="wpa-move" class="wpa-btn small">Move Overlay</button>
        <button id="wpa-help" class="wpa-btn small">Help</button>
      </div>
    `;
    document.body.appendChild(panel);

    // tip & hover elements
    const tip = document.createElement('div'); tip.id = 'wpa-tip'; document.body.appendChild(tip);
    const hover = document.createElement('div'); hover.id = 'wpa-hover'; document.body.appendChild(hover);

    // hook events
    document.getElementById('wpa-init').addEventListener('click', async () => {
      Utils.showTip(Utils.t('checkingColors'));
      await detectPalette(true);
      Utils.showTip(Utils.t('initMessage'), 1400);
    });

    document.getElementById('wpa-upload').addEventListener('click', async () => {
      try {
        const dataUrl = await Utils.createImageUploader();
        // get inputs for grid size if present
        const gw = parseInt(document.getElementById('wpa-gridW').value) || 0;
        const gh = parseInt(document.getElementById('wpa-gridH').value) || 0;
        await processUploadedImage(dataUrl, gw, gh);
        // if grid dims were zero, save the auto-set dims into inputs
        document.getElementById('wpa-gridW').value = state.gridW;
        document.getElementById('wpa-gridH').value = state.gridH;
        Utils.showTip(Utils.t('imageLoaded', {count: state.pixels.length}), 1600);
      } catch(e) {
        console.warn(e);
        Utils.showTip(Utils.t('imageError'), 1400);
      }
    });

    document.getElementById('wpa-detect').addEventListener('click', () => detectPalette(true));

    document.getElementById('wpa-autoset').addEventListener('click', () => {
      if (!state.image) { Utils.showTip('Upload first'); return; }
      document.getElementById('wpa-gridW').value = state.image.naturalWidth;
      document.getElementById('wpa-gridH').value = state.image.naturalHeight;
    });

    document.getElementById('wpa-tileSize').addEventListener('change', (e) => {
      const v = Math.max(1, parseInt(e.target.value)||4);
      state.tileSize = v;
      Utils.saveLocal();
      drawOverlay();
    });

    document.getElementById('wpa-edit').addEventListener('click', () => {
      state.editMode = !state.editMode;
      updateUI();
    });

    document.getElementById('wpa-lock').addEventListener('click', () => {
      state.locked = !state.locked;
      updateUI();
      Utils.saveLocal();
    });

    document.getElementById('wpa-gridToggle').addEventListener('click', () => {
      state.gridVisible = !state.gridVisible;
      updateUI();
      drawOverlay();
      Utils.saveLocal();
    });

    document.getElementById('wpa-reset').addEventListener('click', () => {
      if (!confirm('Reset progress? This will mark all pixels undone.')) return;
      state.pixels.forEach(p => p.done = false);
      Utils.saveLocal();
      drawOverlay();
      updateStatsUI();
    });

    document.getElementById('wpa-move').addEventListener('mousedown', (e) => {
      // clicking Move Overlay -> initiate overlay drag via mouse move across window
      if (state.locked) { Utils.showTip('Overlay locked'); return; }
      startOverlayMoveFromButton(e);
    });

    document.getElementById('wpa-help').addEventListener('click', () => {
      alert([
        'WPlace Overlay Help',
        '- Upload an image (pixel art recommended).',
        '- Set grid size (or press Auto).',
        `- Tile size = on-screen px per WPlace pixel (try 4).`,
        '- Toggle Edit Mode to interact with overlay (E key toggles too).',
        '- Click a pixel in Edit Mode to select the color in the site palette and mark it done.',
        '- Drag the overlay by clicking the image (or use Move Overlay button).',
        '- Ensure palette UI is open on the site and press Detect Palette.'
      ].join('\n'));
    });

    // also allow pressing Enter after changing grid inputs to reprocess
    document.getElementById('wpa-gridW').addEventListener('change', () => {
      const gw = parseInt(document.getElementById('wpa-gridW').value) || 0;
      const gh = parseInt(document.getElementById('wpa-gridH').value) || 0;
      if (state.image) {
        processUploadedImage(state.image.src, gw, gh).catch(e=>console.warn(e));
      }
    });
    document.getElementById('wpa-gridH').addEventListener('change', () => {
      const gw = parseInt(document.getElementById('wpa-gridW').value) || 0;
      const gh = parseInt(document.getElementById('wpa-gridH').value) || 0;
      if (state.image) {
        processUploadedImage(state.image.src, gw, gh).catch(e=>console.warn(e));
      }
    });

    updateUI();
  }

  function updateUI() {
    // reflect state into UI
    const editBtn = document.getElementById('wpa-edit');
    const lockBtn = document.getElementById('wpa-lock');
    const gridBtn = document.getElementById('wpa-gridToggle');
    const tileInp = document.getElementById('wpa-tileSize');
    if (editBtn) editBtn.textContent = state.editMode ? 'Edit: On' : 'Edit Mode';
    if (lockBtn) lockBtn.textContent = state.locked ? 'Locked' : 'Lock';
    if (gridBtn) gridBtn.textContent = `Grid: ${state.gridVisible ? 'On' : 'Off'}`;
    if (tileInp) tileInp.value = state.tileSize;
    // set overlay pointer events
    if (state.overlayCanvas) state.overlayCanvas.style.pointerEvents = state.editMode ? 'auto' : 'none';
  }

  /* ---------------------------------------------------------------------------
     START OVERLAY MOVE (from UI button)
  --------------------------------------------------------------------------- */
  function startOverlayMoveFromButton(e) {
    const startClient = { x: e.clientX, y: e.clientY };
    const startPos = { x: state.pos.x, y: state.pos.y };
    function onMove(ev) {
      state.pos.x = startPos.x + (ev.clientX - startClient.x);
      state.pos.y = startPos.y + (ev.clientY - startClient.y);
      Utils.saveLocal();
      drawOverlay();
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      Utils.saveTip && Utils.saveTip('Moved');
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ---------------------------------------------------------------------------
     SAVE / LOAD / STATS UI
  --------------------------------------------------------------------------- */
  function updateStatsUI() {
    const total = state.pixels.length;
    const done = state.pixels.filter(p => p.done).length;
    const pct = total ? Math.round((done/total)*100) : 0;
    const bar = document.querySelector('#wpa-progress > div');
    if (bar) bar.style.width = pct + '%';
    const txt = document.getElementById('wpa-progressText');
    if (txt) txt.textContent = `${done} / ${total} (${pct}%)`;
  }

  /* ---------------------------------------------------------------------------
     RESTORE SAVED STATE (when possible)
     - we restore pos, tileSize, gridVisible, locked & done flags if pixel counts match
  --------------------------------------------------------------------------- */
  function tryRestoreSaved() {
    const raw = Utils.loadLocal();
    if (!raw) return;
    if (typeof raw.tileSize === 'number') state.tileSize = raw.tileSize;
    if (raw.pos) state.pos = raw.pos;
    if (typeof raw.gridVisible === 'boolean') state.gridVisible = raw.gridVisible;
    if (typeof raw.locked === 'boolean') state.locked = raw.locked;
    if (Array.isArray(raw.pixelsDone) && state.pixels.length === raw.pixelsDone.length) {
      for (let i=0;i<state.pixels.length;i++) state.pixels[i].done = !!raw.pixelsDone[i];
    }
  }

  /* ---------------------------------------------------------------------------
     BOOT / INIT
  --------------------------------------------------------------------------- */
  function attachKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'e') { state.editMode = !state.editMode; updateUI(); Utils.saveLocal(); drawOverlay(); }
      if (e.key === 'g') { state.gridVisible = !state.gridVisible; updateUI(); Utils.saveLocal(); drawOverlay(); }
      if (e.key === 'Escape') { state.editMode = false; updateUI(); drawOverlay(); }
    });
  }

  // Initialize everything
  function init() {
    createOverlayCanvas();   // attach overlay to map container
    createUI();              // build UI
    // attempt palette detection immediately
    detectPalette(true).catch(e=>console.warn('palette detect', e));
    attachKeyboardShortcuts();
    // try load previously saved settings (pos/tileSize) for convenience
    const saved = Utils.loadLocal();
    if (saved) {
      if (saved.pos) state.pos = saved.pos;
      if (saved.tileSize) state.tileSize = saved.tileSize;
      if (typeof saved.gridVisible === 'boolean') state.gridVisible = saved.gridVisible;
      if (typeof saved.locked === 'boolean') state.locked = saved.locked;
    }
    // draw first frame
    drawOverlay();
    Utils.showTip('WPlace Overlay loaded — Upload an image and Detect Palette', 2200);
  }

  // run init
  init();

  // Expose WPO object on window for debugging
  window.WPA = {
    state,
    drawOverlay,
    detectPalette,
    processUploadedImage,
    saveState: Utils.saveLocal,
    loadState: Utils.loadLocal,
    clear: () => {
      state.pixels = [];
      state.image = null;
      state.imageSrcUrl = null;
      state.gridW = 0; state.gridH = 0; state.imageLoaded = false;
      Utils.saveLocal();
      drawOverlay();
      updateStatsUI();
    }
  };

  /* ---------------------------------------------------------------------------
     End of script
  --------------------------------------------------------------------------- */
})();
