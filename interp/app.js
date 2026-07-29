"use strict";

const state = {
  bundle: null,
  detail: null,
  pathway: null,
  blockIndex: 0,
  mode: "block",
  gene: null,
  collections: [],
  slug: null,
  manifold: null,
  manifoldView: "pathway",
  crossColour: "dominant",
  manifoldCamera: null,
  blockManifold: null,
  tilePathway: null,
  tileGene: null,
};

// one in-flight promise per URL, so a repeated selection never refetches
const jsonCache = new Map();

function loadJson(url) {
  if (jsonCache.has(url)) return jsonCache.get(url);
  const promise = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  jsonCache.set(url, promise);
  promise.catch(() => jsonCache.delete(url));

  return promise;
}

// read display settings straight from the inputs so restored form state never desyncs
function controls() {
  return {
    fraction: parseFloat(document.getElementById("fraction").value),
    normalize: document.getElementById("normalize").value,
    opacity: parseFloat(document.getElementById("opacity").value),
    grid: document.getElementById("showGrid").checked,
  };
}

const imageCache = new Map();

function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

const BLOCK_STOPS = [[240, 247, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]];
const GENE_STOPS = [[237, 248, 233], [186, 228, 179], [116, 196, 118], [35, 139, 69], [0, 68, 27]];

function interpolate(stops, t) {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

// blue ramp for block activation, green for gene expression
function ramp(t) { return interpolate(BLOCK_STOPS, t); }

function geneRamp(t) { return interpolate(GENE_STOPS, t); }

// expression of the selected gene per patch, as a sparse patch -> value map
function geneMap(tile) {
  const values = (tile.gene_values || {})[state.gene];
  if (!state.gene || !values || !tile.gene_patch) return null;

  const map = new Map();
  tile.gene_patch.forEach((patch, index) => map.set(patch, values[index]));

  return { map: map, cells: tile.gene_cells, patches: tile.gene_patch, values: values };
}

function geneStats(tile) {
  const entry = geneMap(tile);
  if (!entry) return null;

  const positive = entry.values.filter((value) => value > 0);

  return {
    peak: positive.length ? Math.max(...positive) : 0,
    expressing: positive.length,
    occupied: entry.patches.length,
    cells: entry.cells.reduce((total, value) => total + value, 0),
  };
}

// value a patch must reach to be drawn, so only the strongest fraction lights up
function cutoff(tile, fraction) {
  const firing = tile.patches.filter((v) => v > 0).sort((a, b) => b - a);
  if (!firing.length) return Infinity;
  const keep = Math.max(1, Math.round(firing.length * fraction));
  return firing[Math.min(keep, firing.length) - 1];
}

function drawTile(canvas, tile, maxValue, options) {
  const grid = state.bundle.patch_grid;
  const size = canvas.width;
  const ctx = canvas.getContext("2d");
  const current = controls();
  const settings = Object.assign({ overlay: true, opacity: current.opacity, fraction: current.fraction, grid: current.grid, geneMax: 0 }, options || {});

  return loadImage(tile.image).then((img) => {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    if (!settings.overlay) return;

    const cell = size / grid;
    const reference = current.normalize === "tile" ? tile.max_patch : maxValue;
    const scale = reference > 0 ? reference : 1;
    const cut = cutoff(tile, settings.fraction);
    const floor = cut / scale;

    const lit = new Map();

    for (let r = 0; r < grid; r += 1) {
      for (let c = 0; c < grid; c += 1) {
        const raw = tile.patches[r * grid + c];
        if (raw <= 0 || raw < cut) continue;

        // rescale the surviving band across the full ramp so the peak patches stand out
        const value = Math.min(1, raw / scale);
        const shaped = floor < 1 ? (value - floor) / (1 - floor) : 1;
        const [red, green, blue] = ramp(shaped);
        ctx.fillStyle = `rgba(${red},${green},${blue},${(0.3 + 0.7 * shaped) * settings.opacity})`;
        ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
        lit.set(r * grid + c, shaped);
      }
    }

    // genes cover the whole patch so their footprint matches the block layer exactly
    const genes = geneMap(tile);
    if (genes) {
      const stats = geneStats(tile);
      const geneScale = (current.normalize === "tile" ? stats.peak : settings.geneMax) || 1;

      genes.map.forEach((value, patch) => {
        if (value <= 0) return;
        const shaped = Math.min(1, value / geneScale);
        const [red, green, blue] = geneRamp(0.25 + 0.75 * shaped);
        ctx.fillStyle = `rgba(${red},${green},${blue},${(0.45 + 0.5 * shaped) * settings.opacity})`;
        ctx.fillRect((patch % grid) * cell, Math.floor(patch / grid) * cell, cell + 0.5, cell + 0.5);
      });

      // ring the patches a gene now covers so the block underneath stays readable
      ctx.lineWidth = Math.max(1.5, cell * 0.12);
      lit.forEach((shaped, patch) => {
        if (!(genes.map.get(patch) > 0)) return;
        const [red, green, blue] = ramp(Math.max(0.45, shaped));
        ctx.strokeStyle = `rgba(${red},${green},${blue},${(0.75 + 0.25 * shaped) * settings.opacity})`;
        ctx.strokeRect((patch % grid) * cell + ctx.lineWidth / 2, Math.floor(patch / grid) * cell + ctx.lineWidth / 2, cell - ctx.lineWidth, cell - ctx.lineWidth);
      });
    }

    if (settings.grid) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 0.5;
      for (let i = 1; i < grid; i += 1) {
        ctx.beginPath();
        ctx.moveTo(i * cell, 0);
        ctx.lineTo(i * cell, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * cell);
        ctx.lineTo(size, i * cell);
        ctx.stroke();
      }
    }
  });
}

function drawHeat(canvas, tile, maxValue) {
  const grid = state.bundle.patch_grid;
  const size = canvas.width;
  const ctx = canvas.getContext("2d");
  const cell = size / grid;
  const reference = controls().normalize === "tile" ? tile.max_patch : maxValue;
  const scale = reference > 0 ? reference : 1;

  ctx.fillStyle = "#fbfbfa";
  ctx.fillRect(0, 0, size, size);

  for (let r = 0; r < grid; r += 1) {
    for (let c = 0; c < grid; c += 1) {
      const value = tile.patches[r * grid + c] / scale;
      const [red, green, blue] = ramp(value);
      ctx.fillStyle = value <= 0 ? "#f2f2f0" : `rgb(${red},${green},${blue})`;
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 0.5;
  for (let i = 1; i < grid; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
}

// standalone gene panel: grey where no cell was measured, pale where a cell carries no transcript
function drawGeneHeat(canvas, tile, geneMax) {
  const grid = state.bundle.patch_grid;
  const size = canvas.width;
  const ctx = canvas.getContext("2d");
  const cell = size / grid;
  const genes = geneMap(tile);
  const stats = geneStats(tile);
  const scale = (controls().normalize === "tile" ? stats.peak : geneMax) || 1;

  ctx.fillStyle = "#eceff2";
  ctx.fillRect(0, 0, size, size);

  genes.map.forEach((value, patch) => {
    const [red, green, blue] = geneRamp(value > 0 ? 0.25 + 0.75 * Math.min(1, value / scale) : 0);
    ctx.fillStyle = value > 0 ? `rgb(${red},${green},${blue})` : "#f8fbf9";
    ctx.fillRect((patch % grid) * cell, Math.floor(patch / grid) * cell, cell, cell);
  });

  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 0.5;
  for (let i = 1; i < grid; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
}

function renderSidebar(filter) {
  const list = document.getElementById("pathwayList");
  const needle = (filter || "").trim().toLowerCase();
  list.innerHTML = "";

  state.bundle.pathways.forEach((pathway, index) => {
    const hay = `${pathway.name} ${pathway.pathway_id}`.toLowerCase();
    if (needle && !hay.includes(needle)) return;

    const item = document.createElement("div");
    item.className = `pathway-item${state.pathway === index ? " active" : ""}`;
    item.innerHTML = `
      <div>
        <div class="pname">${pathway.name}</div>
        <div class="pid">${pathway.pathway_id}</div>
      </div>
      <span class="count">${pathway.n_supported_blocks} blk</span>`;
    item.addEventListener("click", () => selectPathway(index));
    list.appendChild(item);
  });

  if (!list.children.length) {
    list.innerHTML = '<p class="gallery-note" style="padding:10px">No pathway matches that search.</p>';
  }
}

function loadPathway(pathwayId) {
  return loadJson(`data/${state.slug}/pathways/${pathwayId}.json`);
}

async function selectPathway(index) {
  const entry = state.bundle.pathways[index];
  state.pathway = index;
  state.blockIndex = 0;

  document.getElementById("empty").classList.add("hidden");
  document.getElementById("detail").classList.remove("hidden");
  document.getElementById("pathwayName").textContent = entry.name;
  document.getElementById("pathwayId").textContent = entry.pathway_id;
  const template = state.bundle.pathway_url_template || "https://www.kegg.jp/pathway/{pathway_id}";
  document.getElementById("keggLink").href = template.replace("{pathway_id}", entry.pathway_id);
  document.getElementById("supportedCount").textContent = `${entry.n_supported_blocks} held-out supported blocks`;
  document.getElementById("geneList").innerHTML = "";
  document.getElementById("blockList").innerHTML = "";
  document.getElementById("gallery").innerHTML = "";
  document.getElementById("galleryNote").textContent = "loading…";

  renderSidebar(document.getElementById("search").value);

  state.detail = await loadPathway(entry.pathway_id).catch((error) => error);

  // a later click may have won the race, so only paint if this pathway is still selected
  if (state.pathway !== index) return;

  if (state.detail instanceof Error) {
    document.getElementById("geneHint").textContent = "";
    document.getElementById("galleryNote").textContent = `could not load ${entry.pathway_id}.json (${state.detail.message})`;
    return;
  }

  // keep a gene selected only while the new pathway also contains it
  if (state.gene && !state.detail.genes.some((gene) => gene.symbol === state.gene)) state.gene = null;

  renderGenes();
  renderBlocks();
  renderGallery();

  await Promise.all([loadPathwayCoords(entry.pathway_id), loadTilePathway(entry.pathway_id), loadBlockManifold()]);
  if (state.pathway === index) renderManifold();
}

function renderGenes() {
  const pathway = state.detail;
  const holder = document.getElementById("geneList");
  const hint = document.getElementById("geneHint");
  holder.innerHTML = "";

  // genes with zero counts everywhere are non-estimable, so they are counted rather than ranked
  const undetected = pathway.n_undetected_genes ? `, ${pathway.n_undetected_genes} never detected` : "";

  if (!pathway.genes.length) {
    hint.textContent = `none of ${pathway.n_pathway_genes} measured genes were detected in training tiles`;
    return;
  }

  hint.textContent = `${pathway.genes.length} of ${pathway.n_pathway_genes} measured genes${undetected}, by mean expression across training tiles (log1p CPM) — click one to map it onto the tiles`;
  const strongest = Math.max(...pathway.genes.map((gene) => gene.mean));

  pathway.genes.forEach((gene) => {
    const chip = document.createElement("div");
    // dashed border marks genes absent from some slide panels
    chip.className = `gene-chip${gene.train_slides < 46 ? " partial" : ""}${state.gene === gene.symbol ? " active" : ""}`;
    chip.title = `${gene.symbol} · mean ${gene.mean} log1p CPM · sd ${gene.std} · measured on ${gene.train_slides}/46 training and ${gene.heldout_slides}/12 held-out slides · click to overlay its per-cell expression on the tiles and recolour the manifold by this gene`;
    chip.innerHTML = `
      <div class="grow"><span class="sym">${gene.symbol}</span><span class="lvl">${gene.mean.toFixed(2)}</span></div>
      <div class="meter"><span style="width:${strongest > 0 ? (gene.mean / strongest) * 100 : 0}%"></span></div>`;
    chip.addEventListener("click", () => {
      state.gene = state.gene === gene.symbol ? null : gene.symbol;

      // selecting a gene recolours the manifold by that gene, deselecting returns to the pathway
      state.manifoldView = state.gene ? "gene" : "pathway";

      renderGenes();
      renderGallery();
      renderManifold();
    });
    holder.appendChild(chip);
  });

  renderGeneNote();
}

function renderGeneNote() {
  const note = document.getElementById("geneNote");

  if (!state.gene) {
    note.classList.add("hidden");
    return;
  }

  note.classList.remove("hidden");
  note.innerHTML = `Green squares mark <b>${state.gene}</b> transcripts in the cells measured inside each tile.
    Xenium reads expression once per cell, so the green layer is the per-cell expression binned onto the same
    14&times;14 grid as the block activation &mdash; patches with no measured cell stay unmarked.`;
}

function renderBlocks() {
  const pathway = state.detail;
  const holder = document.getElementById("blockList");
  const strongest = Math.max(...pathway.blocks.map((b) => Math.abs(b.heldout_effect)));
  holder.innerHTML = "";

  pathway.blocks.forEach((block, index) => {
    const card = document.createElement("div");
    card.className = `block-card${state.blockIndex === index ? " active" : ""}`;
    const width = strongest > 0 ? (Math.abs(block.heldout_effect) / strongest) * 100 : 0;
    card.innerHTML = `
      <div class="bhead">
        <span class="dict">${block.dictionary}</span>
        <span class="bid">#${block.block}</span>
      </div>
      <table>
        <tr><td>held-out effect</td><td class="val">${block.heldout_effect.toFixed(3)}</td></tr>
        <tr><td>train effect</td><td class="val">${block.train_effect.toFixed(3)}</td></tr>
        <tr><td>&Delta;R&sup2;</td><td class="val">${block.delta_r2.toFixed(4)}</td></tr>
        <tr><td>firing frac.</td><td class="val">${block.firing_fraction.toFixed(3)}</td></tr>
      </table>
      <div class="bar"><span style="width:${width}%"></span></div>`;
    card.addEventListener("click", async () => {
      state.blockIndex = index;
      renderBlocks();
      renderGallery();

      // the manifold belongs to this block, so selecting a card loads a different embedding
      await loadBlockManifold();
      renderManifold();
    });
    holder.appendChild(card);
  });
}

function activeTiles() {
  const pathway = state.detail;
  const block = pathway.blocks[state.blockIndex];

  if (state.mode === "score") {
    // score order stays fixed; the overlay follows whichever block is selected
    const key = String(block.block_global_index);
    const tiles = pathway.score_tiles.map((tile) => Object.assign({}, tile, tile.by_block[key]));
    return { tiles: tiles, block: block };
  }

  return { tiles: block.tiles, block: block };
}

// label the ramp with the values its two ends actually correspond to
function renderScaleBar(tiles) {
  const current = controls();
  const percent = Math.round(current.fraction * 100);
  const peaks = tiles.map((tile) => tile.max_patch).filter((value) => value > 0);
  const cuts = tiles.map((tile) => cutoff(tile, current.fraction)).filter((value) => Number.isFinite(value));

  const minTick = document.getElementById("scaleMin");
  const maxTick = document.getElementById("scaleMax");
  const caption = document.getElementById("scaleCaption");

  if (!peaks.length) {
    minTick.textContent = "";
    maxTick.textContent = "";
    caption.textContent = "no firing patches to scale";
    return;
  }

  const galleryPeak = Math.max(...peaks);

  if (current.normalize === "gallery") {
    minTick.textContent = Math.min(...cuts).toFixed(1);
    maxTick.textContent = galleryPeak.toFixed(1);
    caption.textContent = `one shared scale across these tiles, so colour means the same on each; pale end is the top-${percent}% cutoff, dark end the gallery peak`;
    return;
  }

  minTick.textContent = "cutoff";
  maxTick.textContent = "tile peak";
  caption.textContent = `each tile spans its own top-${percent}% cutoff to its own peak (peaks ${Math.min(...peaks).toFixed(1)}–${galleryPeak.toFixed(1)} here), so colour is not comparable between tiles`;
}

function renderGeneScale(tiles, geneMax) {
  const holder = document.getElementById("geneScale");

  if (!state.gene) {
    holder.classList.add("hidden");
    return;
  }

  holder.classList.remove("hidden");
  document.getElementById("geneScaleName").textContent = state.gene;

  const perTile = controls().normalize === "tile";
  const cells = tiles.reduce((total, tile) => total + (geneStats(tile) || { cells: 0 }).cells, 0);

  document.getElementById("geneScaleMin").textContent = "0";
  document.getElementById("geneScaleMax").textContent = perTile ? "tile peak" : geneMax.toFixed(1);
  document.getElementById("geneScaleCaption").textContent = perTile
    ? `each tile spans 0 to its own ${state.gene} peak (gallery peak ${geneMax.toFixed(1)} log1p CPM per cell, ${cells} cells measured here)`
    : `one shared scale, 0 to the gallery peak of ${geneMax.toFixed(1)} log1p CPM per cell across ${cells} measured cells`;
}

/* ---------- 3D block manifold ---------- */

const MANIFOLD_PALETTE = ["#4E728A", "#C4650D", "#2E6E4E", "#B23A48", "#7A4E7E", "#8A6D1B", "#D08BB0", "#556065", "#9FB233", "#2FA5A5"];
const AXIS_PAD = 0.04;

// magenta sits outside every colour scale used for the points, so the marked block cannot blend in
const HIGHLIGHT = "#E5007D";

// Plotly's default cube pads well past the cloud, so axes are clamped to the data
function axisRange(values) {
  const finite = values.filter((value) => value !== null && Number.isFinite(value));
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const margin = (high - low) * AXIS_PAD || 1;

  return [low - margin, high + margin];
}

function manifoldAxis(title, values) {
  return {
    title: { text: title, font: { size: 12, color: "#1D272A" } },
    range: axisRange(values),
    showbackground: true,
    backgroundcolor: "#FCFCFB",
    gridcolor: "#DEDCD4",
    zeroline: false,
    showticklabels: true,
    ticks: "outside",
    tickfont: { size: 9, color: "#6F7472" },
    showspikes: false,
  };
}

function manifoldLayout(title, subtitle, showLegend, coords) {
  const blocks = coords || state.manifold.blocks;

  return {
    title: {
      text: subtitle ? `${title}<br><sub>${subtitle}</sub>` : title,
      x: 0.5,
      xanchor: "center",
      font: { size: 15, color: "#1D272A" },
    },
    scene: {
      xaxis: manifoldAxis("UMAP 1", blocks.x),
      yaxis: manifoldAxis("UMAP 2", blocks.y),
      zaxis: manifoldAxis("UMAP 3", blocks.z),
      aspectmode: "cube",
      camera: state.manifoldCamera || { eye: { x: 1.45, y: 1.45, z: 1.05 } },
    },
    showlegend: Boolean(showLegend),
    legend: {
      itemsizing: "constant",
      font: { size: 10.5 },
      bgcolor: "rgba(255,255,255,0.85)",
      bordercolor: "#DEDCD4",
      borderwidth: 1,
      x: 0.01,
      y: 0.99,
    },
    margin: { l: 4, r: 4, t: 62, b: 4 },
    paper_bgcolor: "#FFFFFF",
    font: { family: "Inter, system-ui, sans-serif" },
  };
}

const PLOT_CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["resetCameraLastSave3d"] };

// the gallery's own ramps, reused so a colour means the same thing in the tiles and in the manifold
function scaleFrom(stops) {
  return stops.map((stop, index) => [index / (stops.length - 1), `rgb(${stop[0]},${stop[1]},${stop[2]})`]);
}

const ACTIVATION_SCALE = scaleFrom(BLOCK_STOPS);
const EXPRESSION_SCALE = scaleFrom(GENE_STOPS);
const MISSING_COLOUR = "#D7D5CE";

// 2nd to 98th percentile, so one hot tile cannot flatten the whole ramp
function robustRange(values) {
  const finite = values.filter((value) => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return [0, 1];

  const low = finite[Math.floor(finite.length * 0.02)];
  const high = finite[Math.floor(finite.length * 0.98)];

  return high > low ? [low, high] : [finite[0], finite[finite.length - 1] + 1];
}

// which tiles of the selected block to draw, given the split filter
function tileRows() {
  const payload = state.blockManifold;
  const scope = document.getElementById("manifoldScope").value;
  const positions = payload.tile_rows.map((value, index) => index);
  if (scope === "all") return positions;

  const train = state.manifold.tiles.train_row;
  const kept = positions.filter((index) => (train[payload.tile_rows[index]] >= 0) === (scope === "train"));

  return kept.length ? kept : positions;
}

function tileHover(positions) {
  const payload = state.blockManifold;
  const tiles = state.manifold.tiles;

  return positions.map((index) => {
    const row = payload.tile_rows[index];
    const split = tiles.train_row[row] >= 0 ? "training" : "held-out";

    return `${tiles.tile_id[row]}<br>slide ${tiles.slides[tiles.slide_code[row]]} · ${split}`
      + `<br>block activation ${payload.activation[index]}`;
  });
}

function tileXYZ(positions) {
  const payload = state.blockManifold;

  return {
    x: positions.map((index) => payload.x[index]),
    y: positions.map((index) => payload.y[index]),
    z: positions.map((index) => payload.z[index]),
  };
}

// tiles with no value are drawn in grey rather than dropped, so the shape of the manifold survives
function tileValueTraces(positions, values, title, scale, missingLabel) {
  const known = positions.filter((index) => values[index] !== null && Number.isFinite(values[index]));
  const missing = positions.filter((index) => values[index] === null || !Number.isFinite(values[index]));
  const [low, high] = robustRange(known.map((index) => values[index]));
  const traces = [];

  if (missing.length) {
    traces.push({
      type: "scatter3d",
      mode: "markers",
      name: `${missingLabel} (${missing.length.toLocaleString()})`,
      ...tileXYZ(missing),
      text: tileHover(missing),
      hoverinfo: "text",
      marker: { size: 2.2, color: MISSING_COLOUR, opacity: 0.5 },
    });
  }

  traces.push({
    type: "scatter3d",
    mode: "markers",
    name: title,
    ...tileXYZ(known),
    text: tileHover(known),
    hoverinfo: "text",
    marker: {
      size: 3.0,
      color: known.map((index) => values[index]),
      colorscale: scale,
      cmin: low,
      cmax: high,
      opacity: 0.9,
      colorbar: { title: { text: title, side: "right", font: { size: 11 } }, thickness: 13, len: 0.62 },
    },
    showlegend: false,
  });

  return traces;
}

// one trace per busiest slide, so the eye can tell slide structure from biology
function slideTraces(positions, topSlides) {
  const payload = state.blockManifold;
  const tiles = state.manifold.tiles;
  const counts = new Map();

  positions.forEach((index) => {
    const code = tiles.slide_code[payload.tile_rows[index]];
    counts.set(code, (counts.get(code) || 0) + 1);
  });

  const ordered = [...counts.entries()].sort((first, second) => second[1] - first[1]).slice(0, topSlides).map(([code]) => code);
  const shown = new Set(ordered);
  const traces = [];

  const rest = positions.filter((index) => !shown.has(tiles.slide_code[payload.tile_rows[index]]));
  if (rest.length) {
    traces.push({
      type: "scatter3d",
      mode: "markers",
      name: `${counts.size - ordered.length} other slides (${rest.length.toLocaleString()})`,
      ...tileXYZ(rest),
      text: tileHover(rest),
      hoverinfo: "text",
      marker: { size: 2.2, color: MISSING_COLOUR, opacity: 0.55 },
    });
  }

  ordered.forEach((code, position) => {
    const rows = positions.filter((index) => tiles.slide_code[payload.tile_rows[index]] === code);
    traces.push({
      type: "scatter3d",
      mode: "markers",
      name: `${tiles.slides[code]} (${rows.length.toLocaleString()})`,
      ...tileXYZ(rows),
      text: tileHover(rows),
      hoverinfo: "text",
      marker: { size: 3.0, color: MANIFOLD_PALETTE[position % MANIFOLD_PALETTE.length], opacity: 0.9 },
    });
  });

  return traces;
}

function pathwayTileValues(positions) {
  const payload = state.blockManifold;
  const train = state.manifold.tiles.train_row;
  const scores = state.tilePathway.values;
  const values = new Array(payload.tile_rows.length).fill(null);

  positions.forEach((index) => {
    const row = train[payload.tile_rows[index]];
    if (row >= 0) values[index] = scores[row];
  });

  return values;
}

function geneTileValues(positions) {
  const payload = state.blockManifold;
  const tiles = state.manifold.tiles;
  const gene = state.tileGene;
  const values = new Array(payload.tile_rows.length).fill(null);

  positions.forEach((index) => {
    const row = payload.tile_rows[index];

    // a slide whose panel lacks the gene stays grey instead of reading as a true zero
    if (gene.unmeasured.has(tiles.slides[tiles.slide_code[row]])) return;
    values[index] = gene.value.has(row) ? gene.value.get(row) : 0;
  });

  return values;
}

function blockHover(indices) {
  const blocks = state.manifold.blocks;
  const legend = state.manifold.labels.legend;

  return indices.map((i) => {
    const code = state.manifold.labels.code[i];
    const dominant = code >= 0 ? legend[code].name : code === -2 ? "other supported pathway" : "no supported pathway";
    return `${blocks.dictionaries[blocks.dictionary_code[i]]} · block ${blocks.block[i]}`
      + `<br>firing fraction ${blocks.firing_fraction[i]}`
      + `<br>dominant: ${dominant}`;
  });
}

// every estimable block is drawn in the cross-block map
function manifoldRows() {
  return state.manifold.blocks.block_global_index.map((value, index) => index);
}

function selectedGlobalIndex() {
  if (!state.detail || !state.detail.blocks.length) return null;
  const block = state.detail.blocks[state.blockIndex];

  return block ? block.block_global_index : null;
}

// the row of the block selected in the cards above, searched over every block rather than the drawn subset
function selectedRow() {
  const target = selectedGlobalIndex();
  if (target === null || !state.manifold) return -1;

  return state.manifold.blocks.block_global_index.indexOf(target);
}

function selectedLabel() {
  const blocks = state.manifold.blocks;
  const at = selectedRow();
  if (at < 0) return null;

  return `${blocks.dictionaries[blocks.dictionary_code[at]]} #${blocks.block[at]}`;
}

// the card's own name, needed to explain the rare block that transfers but is not in the embedding
function selectedCardLabel() {
  const block = state.detail.blocks[state.blockIndex];

  return block ? `${block.dictionary} #${block.block}` : null;
}

// a haloed, labelled, floor-tethered marker, because a thin ring is unfindable among 3,354 points
function highlightTraces() {
  const blocks = state.manifold.blocks;
  const at = selectedRow();
  if (at < 0) return [];

  const point = { x: blocks.x[at], y: blocks.y[at], z: blocks.z[at] };
  const label = selectedLabel();
  const floor = axisRange(blocks.z)[0];

  return [{
    type: "scatter3d",
    mode: "lines",
    x: [point.x, point.x], y: [point.y, point.y], z: [floor, point.z],
    line: { color: HIGHLIGHT, width: 2.5, dash: "dot" },
    hoverinfo: "skip",
    showlegend: false,
  }, {
    type: "scatter3d",
    mode: "markers",
    x: [point.x], y: [point.y], z: [point.z],
    marker: { size: 26, color: HIGHLIGHT, opacity: 0.18, line: { width: 0 } },
    hoverinfo: "skip",
    showlegend: false,
  }, {
    type: "scatter3d",
    mode: "markers+text",
    name: `selected block: ${label}`,
    x: [point.x], y: [point.y], z: [point.z],
    marker: { size: 13, color: "rgba(0,0,0,0)", line: { color: HIGHLIGHT, width: 3.5 }, symbol: "circle" },
    text: [label],
    textposition: "top center",
    textfont: { size: 12, color: HIGHLIGHT, family: "Inter, system-ui, sans-serif" },
    hovertemplate: `selected: ${label}<br>firing fraction ${blocks.firing_fraction[at]}<extra></extra>`,
    showlegend: true,
  }];
}

function subset(values, rows) {
  return rows.map((index) => values[index]);
}

// symmetric colour bound from the 2nd-98th percentile, so a few extremes cannot flatten the map
function effectBound(values) {
  const finite = values.filter((value) => value !== null && Number.isFinite(value)).map(Math.abs).sort((a, b) => a - b);
  if (!finite.length) return 1;

  return finite[Math.floor(finite.length * 0.98)] || finite[finite.length - 1] || 1;
}

function continuousTrace(rows, values, title, scale) {
  const blocks = state.manifold.blocks;
  const picked = subset(values, rows);
  const bound = effectBound(picked);

  return [{
    type: "scatter3d",
    mode: "markers",
    name: title,
    x: subset(blocks.x, rows), y: subset(blocks.y, rows), z: subset(blocks.z, rows),
    text: blockHover(rows),
    hoverinfo: "text",
    marker: {
      size: 2.9,
      color: picked.map((value) => (value === null ? 0 : value)),
      colorscale: scale || "RdBu",
      reversescale: Boolean(!scale),
      cmin: -bound,
      cmax: bound,
      opacity: 0.88,
      colorbar: { title: { text: title, side: "right", font: { size: 11 } }, thickness: 13, len: 0.62 },
    },
    showlegend: false,
  }];
}

function dominantTraces(rows) {
  const blocks = state.manifold.blocks;
  const labels = state.manifold.labels;
  const traces = [];

  const background = rows.filter((index) => labels.code[index] < 0);
  if (background.length) {
    traces.push({
      type: "scatter3d",
      mode: "markers",
      name: `no dominant pathway (${background.length})`,
      x: subset(blocks.x, background), y: subset(blocks.y, background), z: subset(blocks.z, background),
      text: blockHover(background),
      hoverinfo: "text",
      marker: { size: 2.0, color: "#D7D5CE", opacity: 0.5 },
    });
  }

  labels.legend.forEach((entry, code) => {
    const rowsFor = rows.filter((index) => labels.code[index] === code);
    if (!rowsFor.length) return;
    traces.push({
      type: "scatter3d",
      mode: "markers",
      name: `${entry.name.slice(0, 38)} (${rowsFor.length})`,
      x: subset(blocks.x, rowsFor), y: subset(blocks.y, rowsFor), z: subset(blocks.z, rowsFor),
      text: blockHover(rowsFor),
      hoverinfo: "text",
      marker: { size: 3.4, color: MANIFOLD_PALETTE[code % MANIFOLD_PALETTE.length], opacity: 0.92 },
    });
  });

  return traces;
}

function dictionaryTrace(rows) {
  const blocks = state.manifold.blocks;
  const layers = subset(blocks.layer, rows);

  return [{
    type: "scatter3d",
    mode: "markers",
    name: "layer",
    x: subset(blocks.x, rows), y: subset(blocks.y, rows), z: subset(blocks.z, rows),
    text: blockHover(rows),
    hoverinfo: "text",
    marker: {
      size: 2.9,
      color: layers,
      colorscale: "Viridis",
      cmin: Math.min(...layers),
      cmax: Math.max(...layers),
      opacity: 0.88,
      colorbar: { title: { text: "encoder layer", side: "right", font: { size: 11 } }, thickness: 13, len: 0.62 },
    },
    showlegend: false,
  }];
}

// remember the viewpoint so switching colourings never throws the camera back to default
function bindCameraMemory(id) {
  document.getElementById(id).on("plotly_relayout", (event) => {
    if (event["scene.camera"]) state.manifoldCamera = event["scene.camera"];
  });
}

function activateManifoldTab(view) {
  document.querySelectorAll("#manifoldTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

// the gene tab only exists while a gene the tiles can be coloured by is selected
function syncGeneTab() {
  const tab = document.getElementById("manifoldGeneTab");
  const available = Boolean(state.gene && state.manifold && state.manifold.genes.has(state.gene));
  tab.classList.toggle("hidden", !available);
  tab.textContent = available ? `${state.gene} expression` : "Gene expression";

  if (!available && state.manifoldView === "gene") state.manifoldView = "pathway";

  return available;
}

async function renderManifold() {
  if (!state.manifold || !state.detail) return;

  const geneAvailable = syncGeneTab();
  activateManifoldTab(state.manifoldView);
  document.getElementById("crossControl").classList.toggle("hidden", state.manifoldView !== "cross");
  document.getElementById("scopeControl").classList.toggle("hidden", state.manifoldView === "cross");

  if (state.manifoldView === "cross") return renderCrossBlockMap();

  return renderBlockManifold(geneAvailable);
}

// the selected block's own manifold: its tiles, embedded from the coordinates that block assigns them
async function renderBlockManifold(geneAvailable) {
  const holder = document.getElementById("manifoldMain");
  const note = document.getElementById("manifoldNote");
  const hint = document.getElementById("manifoldHint");
  const card = state.detail.blocks[state.blockIndex];
  const payload = state.blockManifold;
  const entry = state.bundle.pathways[state.pathway];

  if (!payload) {
    Plotly.purge(holder);
    holder.innerHTML = `<p class="gallery-note" style="padding:16px">No tile manifold exported for
      ${card.dictionary} #${card.block}. Manifolds exist for the ${state.manifold.exported.size} blocks that appear as cards.</p>`;
    hint.textContent = "";
    note.textContent = "";
    return;
  }

  const capped = payload.n_tiles >= state.manifold.maxTiles;
  hint.textContent = `${card.dictionary} #${card.block} · ${payload.n_tiles.toLocaleString()} tiles where this block fires,`
    + ` embedded from its own ${payload.group_size} coordinates`;

  const positions = tileRows();
  let traces = [];
  let title = "";
  let subtitle = "";
  let legend = false;

  if (state.manifoldView === "gene") {
    const gene = await loadTileGene(state.gene);

    // a slower fetch must not paint over a newer selection
    if (!gene || gene.symbol !== state.gene || state.manifoldView !== "gene") return;

    const values = geneTileValues(positions);
    traces = tileValueTraces(positions, values, `${state.gene} count`, EXPRESSION_SCALE, "gene not on this slide panel");
    title = `${state.gene} expression inside ${card.dictionary} #${card.block}`;
    subtitle = `each point is one tile this block fires on, coloured by measured ${state.gene} counts`;
    legend = true;
    note.innerHTML = `This is <b>${state.gene}</b> alone on the block's own manifold, so it answers whether the gene
      separates within the block: if the green tiles occupy one region, this block's ${payload.group_size} coordinates encode
      something ${state.gene} tracks. Grey tiles come from slides whose panel does not measure it. Switch to
      <b>Pathway score</b> to compare against the whole ${entry.name} set on the same tile positions.`;
  } else if (state.manifoldView === "activation") {
    traces = tileValueTraces(positions, payload.activation, "block activation", ACTIVATION_SCALE, "no activation");
    title = `Activation of ${card.dictionary} #${card.block} across its tiles`;
    subtitle = "gated block norm per tile, the same quantity the tile gallery shows per patch";
    note.textContent = "Activation magnitude usually varies smoothly across the manifold, so a sharp boundary here means the"
      + " block's coordinates carry structure beyond how strongly it fires.";
  } else if (state.manifoldView === "slide") {
    traces = slideTraces(positions, 10);
    title = `Slide of origin inside ${card.dictionary} #${card.block}`;
    subtitle = `${state.manifold.tiles.slides.length} slides contribute tiles; the 10 busiest are coloured`;
    legend = true;
    note.textContent = "This is the control view: if a region of the manifold is one slide only, any biology read off that"
      + " region is slide-specific rather than a property of the block.";
  } else {
    if (!state.tilePathway) {
      Plotly.purge(holder);
      holder.innerHTML = `<p class="gallery-note" style="padding:16px">No per-tile score exported for ${entry.pathway_id}.</p>`;
      note.textContent = "";
      return;
    }
    const values = pathwayTileValues(positions);
    traces = tileValueTraces(positions, values, `${entry.name} score`, "Viridis", "held-out tile, not scored");
    title = `${entry.name} score inside ${card.dictionary} #${card.block}`;
    subtitle = `each point is one tile this block fires on, coloured by its ${entry.pathway_id} score`;
    legend = true;
    note.innerHTML = `The cloud is the manifold of <b>${card.dictionary} #${card.block}</b> itself: its
      ${payload.group_size} coordinates over the ${payload.n_tiles.toLocaleString()} tiles where it fires, reduced to 3D. If the
      pathway score varies along one direction of this cloud, the block resolves that pathway internally rather than merely
      firing on it.`
      + (geneAvailable ? ` Click <b>${state.gene} expression</b> to recolour the same tiles by that gene.` : "");
  }

  if (capped) {
    note.innerHTML += ` Tiles are capped at ${state.manifold.maxTiles.toLocaleString()} per block, sampled proportionally
      across the training and held-out splits.`;
  }

  await Plotly.react(holder, traces, manifoldLayout(title, subtitle, legend, payload), PLOT_CONFIG);

  if (!holder.dataset.bound) {
    bindCameraMemory("manifoldMain");
    holder.dataset.bound = "1";
  }
}

// the secondary view: one point per block, which compares blocks rather than looking inside one
async function renderCrossBlockMap() {
  const holder = document.getElementById("manifoldMain");
  const note = document.getElementById("manifoldNote");
  const hint = document.getElementById("manifoldHint");
  const entry = state.bundle.pathways[state.pathway];
  const label = state.bundle.collection_label || "pathway";

  hint.textContent = `${state.manifold.blocks.n_blocks.toLocaleString()} estimable blocks, one point each, placed by their`
    + " 1,656-gene training effect signature";

  const rows = manifoldRows();
  let traces = [];
  let title = "";
  let subtitle = "";
  let legend = false;

  if (state.crossColour === "layer") {
    traces = dictionaryTrace(rows);
    title = "Cross-block map by encoder layer";
    subtitle = `every point is one block from one of the ${state.manifold.blocks.dictionaries.length} dictionaries, coloured by the layer that dictionary was fit on`;
    note.innerHTML = `A block belongs to exactly one dictionary and therefore to exactly one layer, so this colour is a single
      number per point, not a range. The ${state.manifold.blocks.dictionaries.length} dictionaries were fit independently on
      layers ${state.manifold.blocks.dictionaries.map((name) => name.split(" ")[0].slice(1)).join(", ")}, each contributing 512
      blocks. Layer is the dominant structure here: blocks from neighbouring layers land near each other.`;
  } else if (state.crossColour === "gene" && state.gene && state.manifold.genes.has(state.gene)) {
    const coords = await loadJson(`data/manifold/genes/${state.gene}.json`);
    if (state.crossColour !== "gene" || coords.symbol !== state.gene) return;

    const stats = state.manifold.genes.get(state.gene);
    traces = continuousTrace(rows, coords.values, `${state.gene} effect`);
    title = `${state.gene} effect across blocks`;
    subtitle = `gene-level training partial effect per block · ${stats.n_supported_blocks} blocks held-out supported`;
    note.textContent = `Red blocks rise with ${state.gene}, blue fall with it. This is one number per block, so it says which`
      + ` blocks track the gene, not how the gene separates inside any one of them.`;
  } else if (state.crossColour === "coordinate" && state.manifold.pathway) {
    traces = continuousTrace(rows, state.manifold.pathway.values, "training effect");
    title = `${state.manifold.pathway.name} effect across blocks`;
    subtitle = `training partial effect per block · ${state.manifold.pathway.supported_blocks.length.toLocaleString()} blocks held-out supported`;
    note.textContent = "Red blocks rise with the pathway score, blue fall with it; grey-white blocks are unrelated to it.";
  } else {
    traces = dominantTraces(rows);
    title = `Dominant held-out-supported ${label} pathway per block`;
    subtitle = `${state.manifold.labels.legend.length} most frequent pathways coloured, ${state.manifold.labels.n_other} blocks dominated by another`;
    legend = true;
    note.textContent = "Each block is coloured by the single supported association with the largest absolute held-out effect.";
  }

  note.innerHTML = `<b>This view is one point per block, not a block's own manifold.</b> It compares blocks by how similarly
    they respond across the 1,656 genes, so nearby points are blocks with similar gene effects. ` + note.innerHTML;

  const marked = highlightTraces();
  const marker = selectedLabel();
  if (marker) {
    subtitle = `${subtitle} · marked block ${marker}`;
    note.innerHTML += ` The magenta ring and dotted stem mark <b>${marker}</b>, the block selected in the cards above.`;
  } else {
    note.innerHTML += ` Nothing is ringed: <b>${selectedCardLabel()}</b> transfers on ${entry.pathway_id} but is not one of the
      ${state.manifold.blocks.n_blocks.toLocaleString()} estimable blocks here, so it has no position in this map.`;
  }

  await Plotly.react(holder, traces.concat(marked), manifoldLayout(title, subtitle, legend || marked.length > 0), PLOT_CONFIG);

  if (!holder.dataset.bound) {
    bindCameraMemory("manifoldMain");
    holder.dataset.bound = "1";
  }
}

async function loadManifold() {
  const [blocks, labels, genes, tiles, index] = await Promise.all([
    loadJson("data/manifold/blocks.json"),
    loadJson(`data/${state.slug}/manifold/labels.json`),
    loadJson("data/manifold/genes_index.json"),
    loadJson("data/manifold/tiles.json"),
    loadJson("data/manifold/block_manifolds_index.json"),
  ]);

  state.manifold = {
    blocks: blocks,
    labels: labels,
    genes: new Map(genes.genes.map((gene) => [gene.symbol, gene])),
    tiles: tiles,
    exported: new Set(index.blocks.map((record) => record.key)),
    maxTiles: index.max_tiles,
    pathways: null,
    pathway: null,
  };

  state.manifold.pathways = new Set((await loadJson(`data/${state.slug}/manifold/pathways_index.json`)).pathways.map((p) => p.pathway_id));
}

// each block's manifold lives in its own file, keyed by the dictionary it belongs to
function blockManifoldKey(card) {
  const [layer, group] = card.dictionary.split(" ");

  return `${layer}_${group}_b${card.block}`;
}

async function loadBlockManifold() {
  state.blockManifold = null;
  if (!state.manifold || !state.detail || !state.detail.blocks.length) return;

  const card = state.detail.blocks[state.blockIndex];
  const key = blockManifoldKey(card);
  if (!state.manifold.exported.has(key)) return;

  const payload = await loadJson(`data/manifold/block_manifolds/${key}.json`);

  // a slower fetch must not replace a newer block selection
  if (blockManifoldKey(state.detail.blocks[state.blockIndex]) === key) state.blockManifold = payload;
}

// a gene set with no per-tile score simply leaves the pathway colouring empty
async function loadTilePathway(pathwayId) {
  state.tilePathway = await loadJson(`data/${state.slug}/manifold/tile_pathways/${pathwayId}.json`).catch(() => null);
}

async function loadTileGene(symbol) {
  const payload = await loadJson(`data/manifold/tile_genes/${symbol}.json`).catch(() => null);
  if (!payload) return null;

  state.tileGene = {
    symbol: payload.symbol,
    unmeasured: new Set(payload.unmeasured_slides || []),
    value: new Map(payload.rows.map((row, index) => [row, payload.values[index]])),
  };

  return state.tileGene;
}

async function loadPathwayCoords(pathwayId) {
  if (!state.manifold) return;
  if (!state.manifold.pathways.has(pathwayId)) {
    state.manifold.pathway = null;
    return;
  }
  state.manifold.pathway = await loadJson(`data/${state.slug}/manifold/pathways/${pathwayId}.json`);
}

function renderGallery() {
  if (!state.detail) return;

  const pathway = state.detail;
  const { tiles, block } = activeTiles();
  const gallery = document.getElementById("gallery");
  const note = document.getElementById("galleryNote");
  gallery.innerHTML = "";

  if (!tiles.length) {
    note.textContent = "No tiles available for this view.";
    return;
  }

  const maxValue = Math.max(...tiles.map((t) => t.max_patch));
  const geneMax = state.gene ? Math.max(0, ...tiles.map((tile) => (geneStats(tile) || { peak: 0 }).peak)) : 0;
  renderScaleBar(tiles);
  renderGeneScale(tiles, geneMax);

  const geneNote = state.gene ? ` Green squares show <b>${state.gene}</b> expression in the cells measured inside each tile.` : "";
  note.innerHTML = (state.mode === "score"
    ? `Tiles ranked by <b>${pathway.name}</b> expression score (training slides), the same six for every block. Blue shows where the selected block <b>${block.dictionary} #${block.block}</b> fires.`
    : `Tiles ranked by peak patch activation of block <b>${block.dictionary} #${block.block}</b>. Blue lights the strongest ${Math.round(controls().fraction * 100)}% of firing patches on each tile.`) + geneNote;

  tiles.forEach((tile) => {
    const card = document.createElement("div");
    card.className = "tile-card";
    const score = tile.pathway_score === null || tile.pathway_score === undefined ? "&mdash;" : tile.pathway_score.toFixed(3);
    const silent = tile.n_firing === 0 ? '<div class="row silent">this block is silent here</div>' : "";
    const coverage = state.mode === "score"
      ? `<div class="row"><span>blocks firing here</span><b>${tile.n_blocks_firing}/${pathway.blocks.length}</b></div>`
      : "";

    const genes = geneStats(tile);
    const geneRows = genes
      ? `<div class="row gene-row"><span>${state.gene} patches</span><b>${genes.expressing}/${genes.occupied}</b></div>
         <div class="row"><span>${state.gene} peak</span><b>${genes.peak.toFixed(1)}</b></div>`
      : "";
    card.innerHTML = `
      <canvas width="256" height="256"></canvas>
      <div class="cap">
        <div class="row"><span>${tile.slide_id}</span><span class="pill ${tile.split}">${tile.split}</span></div>
        <div class="row"><span>peak patch</span><b>${tile.max_patch.toFixed(2)}</b></div>
        <div class="row"><span>peak : mean</span><b>${tile.peak_to_mean.toFixed(2)}&times;</b></div>
        <div class="row"><span>pathway score</span><b>${score}</b></div>
        <div class="row"><span>patches firing</span><b>${tile.n_firing}/${state.bundle.tokens_per_tile}</b></div>
        ${coverage}
        ${geneRows}
        ${silent}
      </div>`;
    card.addEventListener("click", () => openModal(tile, block, maxValue, geneMax));
    gallery.appendChild(card);
    drawTile(card.querySelector("canvas"), tile, maxValue, { geneMax: geneMax });
  });
}

function openModal(tile, block, maxValue, geneMax) {
  const pathway = state.detail;
  document.getElementById("modal").classList.remove("hidden");
  document.getElementById("modalTitle").textContent = `${block.dictionary} block #${block.block} on ${tile.slide_id} tile ${tile.source_h5_row}`;
  document.getElementById("modalMeta").innerHTML =
    `${pathway.name} (${pathway.pathway_id}) &nbsp;·&nbsp; ${tile.tissue} &nbsp;·&nbsp; ${tile.split} split &nbsp;·&nbsp; <code>${tile.sequence_id}</code>`;

  const sorted = tile.patches.slice().sort((a, b) => b - a);
  document.getElementById("modalStats").innerHTML = `
    block held-out effect <b>${block.heldout_effect.toFixed(3)}</b> &nbsp;·&nbsp;
    train effect <b>${block.train_effect.toFixed(3)}</b> &nbsp;·&nbsp;
    &Delta;R&sup2; <b>${block.delta_r2.toFixed(4)}</b> &nbsp;·&nbsp;
    tile activity <b>${tile.activity.toFixed(3)}</b> &nbsp;·&nbsp;
    pathway score <b>${tile.pathway_score === null || tile.pathway_score === undefined ? "—" : tile.pathway_score.toFixed(3)}</b><br />
    patches firing <b>${tile.n_firing}/${state.bundle.tokens_per_tile}</b> &nbsp;·&nbsp;
    peak patch norm <b>${tile.max_patch.toFixed(3)}</b> &nbsp;·&nbsp;
    peak : mean-firing <b>${tile.peak_to_mean.toFixed(2)}&times;</b> &nbsp;·&nbsp;
    top-5 patch norms <b>${sorted.slice(0, 5).map((v) => v.toFixed(2)).join(", ")}</b>`;

  drawTile(document.getElementById("modalRaw"), tile, maxValue, { overlay: false });
  drawTile(document.getElementById("modalOverlay"), tile, maxValue, { opacity: Math.max(controls().opacity, 0.85), grid: true, geneMax: geneMax });
  drawHeat(document.getElementById("modalHeat"), tile, maxValue);

  const figure = document.getElementById("modalGeneFigure");
  const genes = geneStats(tile);
  document.getElementById("modalGrid").classList.toggle("with-gene", Boolean(genes));
  figure.classList.toggle("hidden", !genes);

  if (genes) {
    drawGeneHeat(document.getElementById("modalGene"), tile, geneMax);
    document.getElementById("modalGeneCaption").innerHTML =
      `${state.gene} per cell &mdash; ${genes.expressing} of ${genes.occupied} measured patches, ${genes.cells} cells, peak ${genes.peak.toFixed(1)}<br />grey = no cell measured, pale = cell without transcript`;
  }
}

// re-fetch the scripts, styles and data past the browser cache, then reload with the fresh copies
async function reloadAssets() {
  const button = document.getElementById("reload");
  const label = document.getElementById("reloadLabel");
  button.disabled = true;
  label.textContent = "refetching…";

  const assets = ["index.html", "app.js", "styles.css", "data/collections.json", `data/${state.slug}/index.json`,
    "data/manifold/blocks.json", "data/manifold/genes_index.json", `data/${state.slug}/manifold/labels.json`];
  if (state.pathway !== null) assets.push(`data/${state.slug}/pathways/${state.bundle.pathways[state.pathway].pathway_id}.json`);

  await Promise.all(assets.map((asset) => fetch(asset, { cache: "reload" }).catch(() => null)));
  jsonCache.clear();
  imageCache.clear();

  location.reload();
}

function renderCollectionTabs() {
  const holder = document.getElementById("collectionTabs");
  holder.innerHTML = "";

  // a single collection needs no switch, so the tabs stay out of the way
  if (state.collections.length < 2) return;

  state.collections.forEach((entry) => {
    const button = document.createElement("button");
    button.textContent = entry.collection_label;
    button.title = `${entry.n_pathways} gene sets`;
    button.className = entry.slug === state.slug ? "active" : "";
    button.addEventListener("click", () => selectCollection(entry.slug));
    holder.appendChild(button);
  });
}

async function selectCollection(slug) {
  if (slug === state.slug) return;

  const keptPathway = state.pathway === null ? null : state.bundle.pathways[state.pathway].pathway_id;
  const keptGene = state.gene;

  state.slug = slug;
  state.pathway = null;
  state.detail = null;
  state.blockIndex = 0;

  state.bundle = await loadJson(`data/${slug}/index.json`);
  await loadManifold();
  renderCollectionTabs();
  renderBundleLabel();
  renderSidebar(document.getElementById("search").value);

  // gene sets do not carry across collections, so fall back to the strongest one
  state.gene = keptGene;
  const same = state.bundle.pathways.findIndex((entry) => entry.pathway_id === keptPathway);
  if (state.bundle.pathways.length) selectPathway(same >= 0 ? same : 0);
}

function renderBundleLabel() {
  const collection = state.bundle.collection_label || "KEGG";
  document.getElementById("bundleLabel").textContent =
    `${state.bundle.label} · ${state.bundle.pathways.length} ${collection} gene sets · ${state.bundle.patch_grid}×${state.bundle.patch_grid} patch grid`;
  document.getElementById("sourceNote").textContent = state.bundle.encoder_note;
}

function bindControls() {
  document.getElementById("search").addEventListener("input", (event) => renderSidebar(event.target.value));
  document.getElementById("reload").addEventListener("click", reloadAssets);

  document.querySelectorAll("#manifoldTabs button").forEach((button) => {
    button.addEventListener("click", () => {
      state.manifoldView = button.dataset.view;
      activateManifoldTab(state.manifoldView);
      renderManifold();
    });
  });

  document.getElementById("manifoldScope").addEventListener("change", renderManifold);

  document.getElementById("crossColour").addEventListener("change", (event) => {
    state.crossColour = event.target.value;
    renderManifold();
  });

  document.querySelectorAll("#modeTabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#modeTabs button").forEach((other) => other.classList.remove("active"));
      button.classList.add("active");
      state.mode = button.dataset.mode;
      renderGallery();
    });
  });

  document.getElementById("opacity").addEventListener("input", renderGallery);
  document.getElementById("fraction").addEventListener("change", renderGallery);
  document.getElementById("normalize").addEventListener("change", renderGallery);
  document.getElementById("showGrid").addEventListener("change", renderGallery);

  const modal = document.getElementById("modal");
  document.getElementById("modalClose").addEventListener("click", () => modal.classList.add("hidden"));

  // dismiss only when the press starts and ends on the backdrop itself
  let pressedBackdrop = false;
  modal.addEventListener("mousedown", (event) => { pressedBackdrop = event.target === modal; });
  modal.addEventListener("click", (event) => {
    if (pressedBackdrop && event.target === modal) modal.classList.add("hidden");
    pressedBackdrop = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") modal.classList.add("hidden");
  });
}

async function init() {
  const manifest = await loadJson("data/collections.json");
  state.collections = manifest.collections;
  state.slug = state.collections[0].slug;

  state.bundle = await loadJson(`data/${state.slug}/index.json`);
  await loadManifold();

  renderCollectionTabs();
  renderBundleLabel();
  renderSidebar("");
  bindControls();
  if (state.bundle.pathways.length) selectPathway(0);
}

init();
