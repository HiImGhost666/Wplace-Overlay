(async () => {
  // ===== CONFIG =====
  const CONFIG = {
    TRANSPARENCY_THRESHOLD: 100,
    WHITE_THRESHOLD: 250,
    THEME: {
      primary: '#000000',
      secondary: '#111111',
      accent: '#222222',
      text: '#ffffff',
      highlight: '#775ce3',
      success: '#00ff00',
      error: '#ff0000',
      warning: '#ffaa00'
    }
  };

  // ===== WPLACE COLOR PALETTE =====
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

  // ===== STATE =====
  const state = {
    imageLoaded: false,
    overlayCanvas: null,
    overlayCtx: null,
    pixels: [], // {x, y, rgb, paletteId, done}
    gridVisible: false,
    locked: false,
    dragOffset: { x: 0, y: 0 },
    dragging: false,
    position: { x: 100, y: 100 },
    scale: 1,
    imageWidth: 0,
    imageHeight: 0,
    localStorageKey: "wplace-overlay-progress"
  };

  // ===== UTILS =====
  const Utils = {
    colorDistance: (a, b) => Math.sqrt(
      Math.pow(a[0] - b[0], 2) +
      Math.pow(a[1] - b[1], 2) +
      Math.pow(a[2] - b[2], 2)
    ),
    findClosestColor: (rgb) => {
      return WPLACE_PALETTE.reduce((closest, current) => {
        const dist = Utils.colorDistance(rgb, current.rgb);
        return dist < closest.dist ? { color: current, dist } : closest;
      }, { color: WPLACE_PALETTE[0], dist: Utils.colorDistance(rgb, WPLACE_PALETTE[0].rgb) }).color;
    },
    saveProgress: () => {
      const saveData = {
        position: state.position,
        scale: state.scale,
        pixels: state.pixels.map(p => p.done)
      };
      localStorage.setItem(state.localStorageKey, JSON.stringify(saveData));
    },
    loadProgress: () => {
      const data = localStorage.getItem(state.localStorageKey);
      if (!data) return;
      try {
        const parsed = JSON.parse(data);
        state.position = parsed.position;
        state.scale = parsed.scale;
        parsed.pixels.forEach((done, i) => {
          if (state.pixels[i]) state.pixels[i].done = done;
        });
      } catch {}
    }
  };
  // ===== CREATE UI PANEL =====
  function createPanel() {
    const panel = document.createElement("div");
    panel.id = "wplace-overlay-panel";
    panel.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 99999;
      background: ${CONFIG.THEME.primary};
      color: ${CONFIG.THEME.text};
      border: 1px solid ${CONFIG.THEME.accent};
      border-radius: 8px; padding: 10px;
      width: 220px; font-family: sans-serif;
    `;
    panel.innerHTML = `
      <h3 style="margin:0 0 10px;font-size:16px;color:${CONFIG.THEME.highlight}">WPlace Overlay</h3>
      <button id="wpo-upload" style="width:100%;margin-bottom:5px;">Upload Image</button>
      <button id="wpo-toggle-grid" style="width:100%;margin-bottom:5px;">Toggle Grid</button>
      <button id="wpo-lock" style="width:100%;margin-bottom:5px;">Lock Position</button>
      <button id="wpo-reset" style="width:100%;margin-bottom:5px;">Reset Progress</button>
      <div style="margin-top:10px;font-size:14px;">Progress: <span id="wpo-progress">0%</span></div>
    `;
    document.body.appendChild(panel);

    // Event bindings
    panel.querySelector("#wpo-upload").onclick = uploadImage;
    panel.querySelector("#wpo-toggle-grid").onclick = () => {
      state.gridVisible = !state.gridVisible;
      drawOverlay();
    };
    panel.querySelector("#wpo-lock").onclick = () => {
      state.locked = !state.locked;
    };
    panel.querySelector("#wpo-reset").onclick = resetProgress;
  }

  // ===== CREATE OVERLAY CANVAS =====
  function createOverlay() {
    const canvas = document.createElement("canvas");
    canvas.id = "wplace-overlay-canvas";
    canvas.style.cssText = `
      position:absolute;top:0;left:0;z-index:9999;
      pointer-events:auto;cursor:crosshair;
    `;
    document.body.appendChild(canvas);
    state.overlayCanvas = canvas;
    state.overlayCtx = canvas.getContext("2d");
    resizeCanvasToWindow();

    window.addEventListener("resize", resizeCanvasToWindow);

    // Mouse handling for click + drag
    canvas.addEventListener("mousedown", (e) => {
      if (state.locked) {
        handlePixelClick(e);
      } else {
        state.dragging = true;
        state.dragOffset.x = e.clientX - state.position.x;
        state.dragOffset.y = e.clientY - state.position.y;
      }
    });
    window.addEventListener("mouseup", () => state.dragging = false);
    window.addEventListener("mousemove", (e) => {
      if (!state.locked && state.dragging) {
        state.position.x = e.clientX - state.dragOffset.x;
        state.position.y = e.clientY - state.dragOffset.y;
        drawOverlay();
      }
    });
    canvas.addEventListener("mousemove", handlePixelHover);
  }

  function resizeCanvasToWindow() {
    state.overlayCanvas.width = window.innerWidth;
    state.overlayCanvas.height = window.innerHeight;
    drawOverlay();
  }

  // ===== UPLOAD IMAGE =====
  function uploadImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg";
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => processImage(reader.result);
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function processImage(src) {
    const img = new Image();
    img.onload = () => {
      state.imageWidth = img.width;
      state.imageHeight = img.height;
      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = img.width;
      tmpCanvas.height = img.height;
      const ctx = tmpCanvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      state.pixels = [];

      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const idx = (y * img.width + x) * 4;
          const r = data[idx], g = data[idx+1], b = data[idx+2], a = data[idx+3];
          if (a < CONFIG.TRANSPARENCY_THRESHOLD) continue;
          if (r >= CONFIG.WHITE_THRESHOLD && g >= CONFIG.WHITE_THRESHOLD && b >= CONFIG.WHITE_THRESHOLD) continue;
          const nearest = Utils.findClosestColor([r,g,b]);
          state.pixels.push({x, y, rgb:[r,g,b], paletteId:nearest.id, paletteName:nearest.name, done:false});
        }
      }
      state.imageLoaded = true;
      Utils.loadProgress();
      drawOverlay();
      updateProgress();
    };
    img.src = src;
  }

  // ===== CLICK A PIXEL =====
  function handlePixelClick(e) {
    const px = Math.floor((e.clientX - state.position.x) / state.scale);
    const py = Math.floor((e.clientY - state.position.y) / state.scale);
    const pixel = state.pixels.find(p => p.x === px && p.y === py);
    if (!pixel) return;
    // Select color in Wplace palette
    const btn = document.querySelector(`#color-${pixel.paletteId}`);
    if (btn) btn.click();
    // Mark as done
    pixel.done = true;
    Utils.saveProgress();
    drawOverlay();
    updateProgress();
  }

  // ===== HOVER PIXEL =====
  let tooltip;
  function handlePixelHover(e) {
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.style.cssText = `
        position:fixed;padding:3px 6px;background:${CONFIG.THEME.secondary};
        color:${CONFIG.THEME.text};border-radius:4px;font-size:12px;z-index:100000;
        pointer-events:none;white-space:nowrap;
      `;
      document.body.appendChild(tooltip);
    }
    const px = Math.floor((e.clientX - state.position.x) / state.scale);
    const py = Math.floor((e.clientY - state.position.y) / state.scale);
    const pixel = state.pixels.find(p => p.x === px && p.y === py);
    if (pixel) {
      tooltip.textContent = pixel.paletteName;
      tooltip.style.display = "block";
      tooltip.style.left = (e.clientX + 10) + "px";
      tooltip.style.top = (e.clientY + 10) + "px";
    } else {
      tooltip.style.display = "none";
    }
  }

  // ===== RESET PROGRESS =====
  function resetProgress() {
    state.pixels.forEach(p => p.done = false);
    Utils.saveProgress();
    drawOverlay();
    updateProgress();
  }

  // ===== UPDATE PROGRESS =====
  function updateProgress() {
    const total = state.pixels.length;
    const done = state.pixels.filter(p => p.done).length;
    const percent = total > 0 ? Math.round((done/total)*100) : 0;
    const el = document.getElementById("wpo-progress");
    if (el) el.textContent = `${percent}%`;
  }
    // ===== DRAW OVERLAY =====
  function drawOverlay() {
    if (!state.overlayCtx) return;
    const ctx = state.overlayCtx;
    ctx.clearRect(0, 0, state.overlayCanvas.width, state.overlayCanvas.height);

    if (!state.imageLoaded) return;

    for (const p of state.pixels) {
      const drawX = state.position.x + p.x * state.scale;
      const drawY = state.position.y + p.y * state.scale;

      if (!p.done) {
        ctx.fillStyle = `rgba(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]},0.5)`;
        ctx.fillRect(drawX, drawY, state.scale, state.scale);
      }

      if (state.gridVisible) {
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.strokeRect(drawX, drawY, state.scale, state.scale);
      }
    }
  }

  // ===== INIT SCRIPT =====
  function init() {
    createPanel();
    createOverlay();
    Utils.loadProgress();
    drawOverlay();
  }

  // Start
  init();

})();

