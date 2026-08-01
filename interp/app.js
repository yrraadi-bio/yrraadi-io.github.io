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
  manifoldCameras: {},
  blockManifold: null,
  tilePathway: null,
  tileGene: null,
};

const SIDEBAR_KEY = "interp.sidebarWidth";
const SIDEBAR_DEFAULT = 288;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 620;

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

function rgb(colour) { return `rgb(${colour[0]},${colour[1]},${colour[2]})`; }

function rgba(colour, alpha) { return `rgba(${colour[0]},${colour[1]},${colour[2]},${alpha})`; }

// every canvas draws the same patch grid, so the geometry is derived in one place
function geometry(canvas) {
  const grid = state.bundle.patch_grid;

  return { ctx: canvas.getContext("2d"), grid: grid, size: canvas.width, cell: canvas.width / grid };
}

// a zero reference would divide the whole ramp by zero, so it falls back to unit scale
function heatScale(reference) { return reference > 0 ? reference : 1; }

function strokeGrid(ctx, grid, cell, size, colour) {
  ctx.strokeStyle = colour;
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

// one gridded heatmap, with the caller supplying the patch values and how a value becomes a colour
function drawPatchHeat(canvas, entries, background, colourOf) {
  const { ctx, grid, size, cell } = geometry(canvas);

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  entries.forEach(([patch, value]) => {
    ctx.fillStyle = colourOf(value);
    ctx.fillRect((patch % grid) * cell, Math.floor(patch / grid) * cell, cell, cell);
  });

  strokeGrid(ctx, grid, cell, size, "rgba(255,255,255,0.6)");
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
    const scale = heatScale(current.normalize === "tile" ? tile.max_patch : maxValue);
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
        ctx.fillStyle = rgba(ramp(shaped), (0.3 + 0.7 * shaped) * settings.opacity);
        ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
        lit.set(r * grid + c, shaped);
      }
    }

    // genes cover the whole patch so their footprint matches the block layer exactly
    const genes = geneMap(tile);
    if (genes) {
      const stats = geneStats(tile);
      const geneScale = heatScale(current.normalize === "tile" ? stats.peak : settings.geneMax);

      genes.map.forEach((value, patch) => {
        if (value <= 0) return;
        const shaped = Math.min(1, value / geneScale);
        ctx.fillStyle = rgba(geneRamp(0.25 + 0.75 * shaped), (0.45 + 0.5 * shaped) * settings.opacity);
        ctx.fillRect((patch % grid) * cell, Math.floor(patch / grid) * cell, cell + 0.5, cell + 0.5);
      });

      // ring the patches a gene now covers so the block underneath stays readable
      ctx.lineWidth = Math.max(1.5, cell * 0.12);
      lit.forEach((shaped, patch) => {
        if (!(genes.map.get(patch) > 0)) return;
        ctx.strokeStyle = rgba(ramp(Math.max(0.45, shaped)), (0.75 + 0.25 * shaped) * settings.opacity);
        ctx.strokeRect((patch % grid) * cell + ctx.lineWidth / 2, Math.floor(patch / grid) * cell + ctx.lineWidth / 2, cell - ctx.lineWidth, cell - ctx.lineWidth);
      });
    }

    if (settings.grid) strokeGrid(ctx, grid, cell, size, "rgba(255,255,255,0.35)");
  });
}

function drawHeat(canvas, tile, maxValue) {
  const scale = heatScale(controls().normalize === "tile" ? tile.max_patch : maxValue);
  const entries = tile.patches.map((value, patch) => [patch, value / scale]);

  drawPatchHeat(canvas, entries, "#fbfbfa", (value) => (value <= 0 ? "#f2f2f0" : rgb(ramp(value))));
}

// standalone gene panel: grey where no cell was measured, pale where a cell carries no transcript
function drawGeneHeat(canvas, tile, geneMax) {
  const scale = heatScale(controls().normalize === "tile" ? geneStats(tile).peak : geneMax);

  drawPatchHeat(canvas, [...geneMap(tile).map], "#eceff2",
    (value) => (value > 0 ? rgb(geneRamp(0.25 + 0.75 * Math.min(1, value / scale))) : "#f8fbf9"));
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
    list.innerHTML = `<p class="gallery-note" style="padding:10px">${COPY.sidebarEmpty}</p>`;
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
  document.getElementById("supportedCount").textContent = COPY.supportedBlocks(entry.n_supported_blocks);
  document.getElementById("basicCorrelation").classList.add("hidden");
  document.getElementById("geneList").innerHTML = "";
  document.getElementById("blockList").innerHTML = "";
  document.getElementById("gallery").innerHTML = `<p class="gallery-note">${COPY.loading}</p>`;

  renderSidebar(document.getElementById("search").value);

  state.detail = await loadPathway(entry.pathway_id).catch((error) => error);

  // a later click may have won the race, so only paint if this pathway is still selected
  if (state.pathway !== index) return;

  if (state.detail instanceof Error) {
    document.getElementById("gallery").innerHTML = `<p class="gallery-note">${COPY.loadFailed(entry.pathway_id, state.detail.message)}</p>`;
    return;
  }

  keepGeneIfScored();

  renderGenes();
  renderBlocks();
  renderGallery();

  await Promise.all([loadPathwayCoords(entry.pathway_id), loadTilePathway(entry.pathway_id), loadBlockManifold()]);
  if (state.pathway === index) renderManifold();
}

// a gene overlay only has patch values on tiles whose block offered that gene, so the selection
// cannot outlive the card that made it
function keepGeneIfScored() {
  const block = state.detail.blocks[state.blockIndex];
  if (state.gene && !block.genes.some((gene) => gene.symbol === state.gene)) {
    state.gene = null;
    state.manifoldView = "pathway";
  }
}

function renderGenes() {
  const block = state.detail.blocks[state.blockIndex];
  const holder = document.getElementById("geneList");
  holder.innerHTML = "";

  const strongest = Math.max(...block.genes.map((gene) => gene.clustering));

  block.genes.forEach((gene) => {
    const chip = document.createElement("div");
    // dashed border marks genes absent from some slide panels
    chip.className = `gene-chip${gene.train_slides < 46 ? " partial" : ""}${state.gene === gene.symbol ? " active" : ""}`;
    chip.title = COPY.genes.chipTitle(gene, blockLabel(block));
    chip.innerHTML = `
      <div class="grow"><span class="sym">${gene.symbol}</span><span class="lvl">${gene.clustering.toFixed(2)} ${gene.activation_r >= 0 ? "↑" : "↓"}</span></div>
      <div class="meter"><span style="width:${strongest > 0 ? (gene.clustering / strongest) * 100 : 0}%"></span></div>`;
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
}

function renderBasicCorrelation() {
  const badge = document.getElementById("basicCorrelation");
  const output = document.getElementById("basicCorrelationValue");
  if (!state.detail || !state.detail.blocks.length) {
    badge.classList.add("hidden");
    return;
  }

  const block = state.detail.blocks[state.blockIndex];
  const value = block.basic_r;
  badge.classList.remove("hidden", "positive", "negative");

  if (!Number.isFinite(value)) {
    output.textContent = COPY.correlation.unavailable;
    badge.title = COPY.correlation.unavailableTitle;
    return;
  }

  output.textContent = `r ${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(3)}`;
  badge.classList.add(value >= 0 ? "positive" : "negative");
  badge.title = COPY.correlation.title(state.detail.name, block);
}

// every card explains the same three numbers, so one panel is moved to whichever marker is asked
function bindBlockInfo(marker) {
  const panel = document.getElementById("blockInfo");

  const show = () => {
    panel.innerHTML = COPY.blocks.panel;
    panel.classList.add("open");

    // the cards wrap across the row, so the panel is nudged back inside the window
    const mark = marker.getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(mark.left - 6, window.innerWidth - panel.offsetWidth - 12))}px`;
    panel.style.top = `${mark.bottom + 8}px`;
  };

  const hide = () => panel.classList.remove("open");

  marker.addEventListener("mouseenter", show);
  marker.addEventListener("focus", show);
  marker.addEventListener("mouseleave", hide);
  marker.addEventListener("blur", hide);

  // the marker sits inside the card, whose click would swap the selected block
  marker.addEventListener("click", (event) => event.stopPropagation());
}

function renderBlocks() {
  const pathway = state.detail;
  const holder = document.getElementById("blockList");
  const strongest = Math.max(...pathway.blocks.map((b) => Math.abs(b.heldout_effect)));
  holder.innerHTML = "";
  renderBasicCorrelation();

  pathway.blocks.forEach((block, index) => {
    const card = document.createElement("div");
    card.className = `block-card${state.blockIndex === index ? " active" : ""}`;
    const width = strongest > 0 ? (Math.abs(block.heldout_effect) / strongest) * 100 : 0;
    card.innerHTML = `
      <div class="bhead">
        <span class="bid">#${blockNumber(block.layer, block.block)}</span>
        <span class="info card-info" tabindex="0" role="button" aria-label="${COPY.blocks.infoLabel}">
          <span class="info-mark" aria-hidden="true">i</span>
        </span>
      </div>
      <table>
        <tr title="${COPY.blocks.heldoutR}"><td>held-out r</td><td class="val">${block.heldout_effect.toFixed(3)}</td></tr>
        <tr title="${COPY.blocks.trainR}"><td>training r</td><td class="val">${block.train_effect.toFixed(3)}</td></tr>
        <tr title="${COPY.blocks.deltaR2}"><td>&Delta;R&sup2; held-out</td><td class="val">${block.delta_r2.toFixed(4)}</td></tr>
      </table>
      <div class="bar"><span style="width:${width}%"></span></div>`;
    bindBlockInfo(card.querySelector(".card-info"));
    card.addEventListener("click", async () => {
      state.blockIndex = index;

      // the cards rank genes inside this block, so a gene the new block cannot score is dropped
      keepGeneIfScored();

      renderBlocks();
      renderGenes();
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

// a slide panel too thin to score the set leaves the tile without one, so it reads as n/a rather than as zero
function tileScore(tile) {
  return tile.pathway_score === null || tile.pathway_score === undefined ? "n/a" : tile.pathway_score.toFixed(3);
}

// both ramps label their two ends, from the same two elements
function setScaleTicks(prefix, low, high) {
  document.getElementById(`${prefix}Min`).textContent = low;
  document.getElementById(`${prefix}Max`).textContent = high;
}

// label the ramp with the values its two ends actually correspond to
function renderScaleBar(tiles) {
  const current = controls();
  const peaks = tiles.map((tile) => tile.max_patch).filter((value) => value > 0);
  const cuts = tiles.map((tile) => cutoff(tile, current.fraction)).filter((value) => Number.isFinite(value));

  if (!peaks.length) return setScaleTicks("scale", "", "");

  if (current.normalize === "gallery") {
    return setScaleTicks("scale", Math.min(...cuts).toFixed(1), Math.max(...peaks).toFixed(1));
  }

  return setScaleTicks("scale", "cutoff", "tile peak");
}

function renderGeneScale(geneMax) {
  const holder = document.getElementById("geneScale");

  if (!state.gene) {
    holder.classList.add("hidden");
    return;
  }

  holder.classList.remove("hidden");
  document.getElementById("geneScaleName").textContent = state.gene;

  setScaleTicks("geneScale", "0", controls().normalize === "tile" ? "tile peak" : geneMax.toFixed(1));
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

// a legend of many categories cannot sit over the cube, so it claims a band on the left and the cube keeps the middle
const LEGEND_WIDTH = 290;

// the axis titles and ticks are drawn outside the cube, so the band only takes width they and the cube cannot use
const AXIS_FURNITURE = 120;

function legendGutter(holder) {
  const width = holder.clientWidth;
  const cube = holder.clientHeight - 66;
  const spare = (width - cube - AXIS_FURNITURE) / 2;

  return Math.min(LEGEND_WIDTH, Math.max(0, spare)) / width;
}

function manifoldLayout(id, title, subtitle, showLegend, coords) {
  const blocks = coords || state.manifold.blocks;
  const banded = showLegend === "gutter";
  const gutter = banded ? legendGutter(document.getElementById(id)) : 0;

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
      camera: state.manifoldCameras[id] || { eye: { x: 1.45, y: 1.45, z: 1.05 } },
      domain: { x: [gutter, 1 - gutter], y: [0, 1] },
    },
    showlegend: Boolean(showLegend),
    legend: {
      itemsizing: "constant",
      font: { size: 10.5 },
      bgcolor: banded ? "#FFFFFF" : "rgba(255,255,255,0.85)",
      bordercolor: "#DEDCD4",
      borderwidth: 1,
      x: banded ? 0 : 0.01,
      xanchor: "left",
      y: banded ? 0.5 : 0.99,
      yanchor: banded ? "middle" : "top",
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

const EXPRESSION_SCALE = scaleFrom(GENE_STOPS);
const MISSING_COLOUR = "#D7D5CE";
const TISSUE_COLOURS = {
  Bowel: "#B66D2A",
  Breast: "#B64B63",
  Lung: "#4E7D96",
  Pancreas: "#8667A7",
  Skin: "#3B8B70",
  Unknown: MISSING_COLOUR,
};

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

    return COPY.hover.tile(tiles.tile_id[row], tiles.slides[tiles.slide_code[row]],
                          tiles.tissues[tiles.tissue_code[row]], split, payload.activation[index]);
  });
}

// the cross-block map and the tile manifolds both hold parallel x/y/z arrays, so one picker serves both
function xyz(source, rows) {
  return { x: subset(source.x, rows), y: subset(source.y, rows), z: subset(source.z, rows) };
}

// every manifold trace is this same scatter3d shell, so callers pass only what differs
function markers(name, coords, hover, marker, options) {
  return Object.assign({ type: "scatter3d", mode: "markers", name: name, ...coords, text: hover,
                        hoverinfo: "text", marker: marker }, options || {});
}

// one colourbar spec, so a ramp reads the same wherever it appears
function colourbar(title) {
  return { title: { text: title, side: "right", font: { size: 11 } }, thickness: 13, len: 0.62 };
}

// tiles with no value are drawn in grey rather than dropped, so the shape of the manifold survives
function tileValueTraces(positions, values, title, scale, missingLabel) {
  const payload = state.blockManifold;
  const known = positions.filter((index) => values[index] !== null && Number.isFinite(values[index]));
  const missing = positions.filter((index) => values[index] === null || !Number.isFinite(values[index]));
  const [low, high] = robustRange(known.map((index) => values[index]));
  const traces = [];

  if (missing.length) {
    traces.push(markers(`${missingLabel} (${missing.length.toLocaleString()})`, xyz(payload, missing),
                       tileHover(missing), { size: 2.2, color: MISSING_COLOUR, opacity: 0.5 }));
  }

  traces.push(markers(title, xyz(payload, known), tileHover(known), {
    size: 3.0,
    color: known.map((index) => values[index]),
    colorscale: scale,
    cmin: low,
    cmax: high,
    opacity: 0.9,
    colorbar: colourbar(title),
  }, { showlegend: false }));

  return traces;
}

// one fixed-colour trace per tissue keeps labels comparable across blocks
function tissueTraces(positions) {
  const payload = state.blockManifold;
  const tiles = state.manifold.tiles;
  const tissueOf = (index) => tiles.tissue_code[payload.tile_rows[index]];

  const present = [...new Set(positions.map(tissueOf))]
    .sort((first, second) => tiles.tissues[first].localeCompare(tiles.tissues[second]));

  return present.map((code, position) => {
    const tissue = tiles.tissues[code];
    const rows = positions.filter((index) => tissueOf(index) === code);
    const colour = TISSUE_COLOURS[tissue] || MANIFOLD_PALETTE[position % MANIFOLD_PALETTE.length];

    return markers(`${tissue} (${rows.length.toLocaleString()})`, xyz(payload, rows), tileHover(rows),
                  { size: 3.0, color: colour, opacity: tissue === "Unknown" ? 0.55 : 0.9 });
  });
}

function pathwayTileValues(positions) {
  const payload = state.blockManifold;
  const scores = state.tilePathway.values;
  const values = new Array(payload.tile_rows.length).fill(null);

  positions.forEach((index) => {
    values[index] = scores[payload.tile_rows[index]];
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
    const dominant = code >= 0 ? legend[code].name
      : code === -2 ? COPY.hover.dominantOther : COPY.hover.dominantNone;

    return COPY.hover.block(blockNumber(blocks.layer[i], blocks.block[i]), dominant);
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

// a block is named by the encoder layer it was fit on and its index inside that dictionary,
// padded so the 512 indices of a dictionary line up in a column of cards
function blockNumber(layer, block) {
  return `${layer}-${String(block).padStart(3, "0")}`;
}

function selectedLabel() {
  const at = selectedRow();
  if (at < 0) return null;

  return `block #${blockNumber(state.manifold.blocks.layer[at], state.manifold.blocks.block[at])}`;
}

function blockLabel(block) {
  return `block #${blockNumber(block.layer, block.block)}`;
}

// the card's own name, needed to explain the rare block that transfers but is not in the embedding
function selectedCardLabel() {
  const block = state.detail.blocks[state.blockIndex];

  return block ? blockLabel(block) : null;
}

// a haloed, labelled, floor-tethered marker, because a thin ring is unfindable among 3,354 points
function highlightTraces() {
  const blocks = state.manifold.blocks;
  const at = selectedRow();
  if (at < 0) return [];

  const label = selectedLabel();
  const spot = { x: [blocks.x[at]], y: [blocks.y[at]], z: [blocks.z[at]] };

  return [{
    type: "scatter3d",
    mode: "lines",
    x: [blocks.x[at], blocks.x[at]], y: [blocks.y[at], blocks.y[at]], z: [axisRange(blocks.z)[0], blocks.z[at]],
    line: { color: HIGHLIGHT, width: 2.5, dash: "dot" },
    hoverinfo: "skip",
    showlegend: false,
  },
  markers("halo", spot, null, { size: 26, color: HIGHLIGHT, opacity: 0.18, line: { width: 0 } },
         { hoverinfo: "skip", showlegend: false }),
  markers(`selected block: ${label}`, spot, [label],
         { size: 13, color: "rgba(0,0,0,0)", line: { color: HIGHLIGHT, width: 3.5 }, symbol: "circle" },
         { mode: "markers+text", textposition: "top center",
           textfont: { size: 12, color: HIGHLIGHT, family: "Inter, system-ui, sans-serif" },
           hovertemplate: COPY.hover.selected(label), showlegend: true })];
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

  return [markers(title, xyz(blocks, rows), blockHover(rows), {
    size: 2.9,
    color: picked.map((value) => (value === null ? 0 : value)),
    colorscale: scale || "RdBu",
    reversescale: Boolean(!scale),
    cmin: -bound,
    cmax: bound,
    opacity: 0.88,
    colorbar: colourbar(title),
  }, { showlegend: false })];
}

function dominantTraces(rows) {
  const blocks = state.manifold.blocks;
  const labels = state.manifold.labels;
  const traces = [];

  const background = rows.filter((index) => labels.code[index] < 0);
  if (background.length) {
    traces.push(markers(`no dominant pathway (${background.length})`, xyz(blocks, background),
                       blockHover(background), { size: 2.0, color: MISSING_COLOUR, opacity: 0.5 }));
  }

  labels.legend.forEach((entry, code) => {
    const rowsFor = rows.filter((index) => labels.code[index] === code);
    if (!rowsFor.length) return;

    traces.push(markers(`${entry.name.slice(0, 38)} (${rowsFor.length})`, xyz(blocks, rowsFor), blockHover(rowsFor),
                       { size: 3.4, color: MANIFOLD_PALETTE[code % MANIFOLD_PALETTE.length], opacity: 0.92 }));
  });

  return traces;
}

function dictionaryTrace(rows) {
  const blocks = state.manifold.blocks;
  const layers = subset(blocks.layer, rows);

  return [markers("layer", xyz(blocks, rows), blockHover(rows), {
    size: 2.9,
    color: layers,
    colorscale: "Viridis",
    cmin: Math.min(...layers),
    cmax: Math.max(...layers),
    opacity: 0.88,
    colorbar: colourbar("encoder layer"),
  }, { showlegend: false })];
}

const MANIFOLD_PLOTS = ["manifoldMain", "manifoldSide"];

// each plot rotates alone, so its viewpoint survives a recolouring without touching its neighbour
function bindCameraMemory(id) {
  document.getElementById(id).on("plotly_relayout", (event) => {
    if (event["scene.camera"]) state.manifoldCameras[id] = event["scene.camera"];
  });
}

// both views finish the same way: draw into one holder, then keep the camera binding alive
async function paintManifold(id, traces, title, subtitle, legend, coords) {
  const holder = document.getElementById(id);

  // an earlier message left plain markup behind, which react would draw around
  if (!holder.dataset.bound) holder.innerHTML = "";

  await Plotly.react(holder, traces, manifoldLayout(id, title, subtitle, legend, coords), PLOT_CONFIG);

  // pairing changes the holder's width without a window resize, so the drawing has to be told to refill it
  Plotly.Plots.resize(holder);

  if (!holder.dataset.bound) {
    bindCameraMemory(id);
    holder.dataset.bound = "1";
  }
}

// a view with nothing to draw replaces the plots with the reason
function manifoldMessage(text) {
  MANIFOLD_PLOTS.forEach((id) => {
    const holder = document.getElementById(id);
    Plotly.purge(holder);
    delete holder.dataset.bound;
    holder.innerHTML = id === "manifoldMain" ? `<p class="gallery-note" style="padding:16px">${text}</p>` : "";
  });

  document.getElementById("manifoldNote").textContent = "";
}

function activateManifoldTab(view) {
  document.querySelectorAll("#manifoldTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

// the two views are built from different inputs, so each carries its own construction note
function syncRecipe() {
  const cross = state.manifoldView === "cross";
  document.getElementById("recipeCross").classList.toggle("hidden", !cross);
  document.getElementById("recipeTile").classList.toggle("hidden", cross);
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
  const cross = state.manifoldView === "cross";
  activateManifoldTab(state.manifoldView);
  document.getElementById("crossControl").classList.toggle("hidden", !cross);
  document.getElementById("scopeControl").classList.toggle("hidden", cross);

  // the cross-block map is one map of its own, so only the tile views come as a pair
  document.getElementById("manifoldFrame").classList.toggle("paired", !cross);
  syncRecipe();

  if (cross) return renderCrossBlockMap();

  return renderBlockManifold(geneAvailable);
}

// the selected block's own manifold: its tiles, embedded from the coordinates that block assigns them
async function renderBlockManifold(geneAvailable) {
  const note = document.getElementById("manifoldNote");
  const card = state.detail.blocks[state.blockIndex];
  const payload = state.blockManifold;
  const entry = state.bundle.pathways[state.pathway];
  const label = blockLabel(card);

  if (!payload) {
    manifoldMessage(COPY.tile.missing(label, state.manifold.exported.size));
    return;
  }

  const positions = tileRows();
  let traces = [];
  let title = "";
  let subtitle = "";
  let legend = false;

  if (state.manifoldView === "gene") {
    const gene = await loadTileGene(state.gene);

    // a slower fetch must not paint over a newer selection
    if (!gene || gene.symbol !== state.gene || state.manifoldView !== "gene") return;

    traces = tileValueTraces(positions, geneTileValues(positions), `${state.gene} count`, EXPRESSION_SCALE,
                            COPY.tile.gene.missing);
    title = COPY.tile.gene.title(state.gene);
    subtitle = COPY.tile.gene.subtitle(label);
    legend = true;
    note.innerHTML = COPY.tile.gene.note(state.gene, entry.name);
  } else {
    if (!state.tilePathway) return manifoldMessage(COPY.tile.noScore(entry.pathway_id));

    traces = tileValueTraces(positions, pathwayTileValues(positions), "pathway score", "Viridis",
                            COPY.tile.pathway.missing);
    title = COPY.tile.pathway.title(entry.name);
    subtitle = COPY.tile.pathway.subtitle(label, entry.pathway_id);
    legend = true;
    note.innerHTML = COPY.tile.pathway.note(payload.n_tiles.toLocaleString())
      + (geneAvailable ? COPY.tile.pathway.geneSwitch(state.gene) : "");
  }

  if (payload.n_tiles >= state.manifold.maxTiles) {
    note.innerHTML += COPY.tile.capped(state.manifold.maxTiles.toLocaleString());
  }

  await paintManifold("manifoldMain", traces, title, subtitle, legend, payload);
  await paintTissue(positions, payload);
}

// the right-hand plot: the same tile positions, coloured by the slide's tissue of origin
async function paintTissue(positions, payload) {
  const tiles = state.manifold.tiles;
  const present = new Set(positions.map((index) => tiles.tissues[tiles.tissue_code[payload.tile_rows[index]]]));
  const known = [...present].filter((tissue) => tissue !== "Unknown").length;

  await paintManifold("manifoldSide", tissueTraces(positions), COPY.tile.tissue.title,
                     COPY.tile.tissue.subtitle(known, tiles.slides.length), true, payload);
}

// the secondary view: one point per block, which compares blocks rather than looking inside one
async function renderCrossBlockMap() {
  const note = document.getElementById("manifoldNote");
  const blocks = state.manifold.blocks;
  const entry = state.bundle.pathways[state.pathway];
  const collection = state.bundle.collection_label || "pathway";
  const total = blocks.n_blocks.toLocaleString();

  const rows = manifoldRows();
  let traces = [];
  let title = "";
  let subtitle = "";
  let legend = false;

  if (state.crossColour === "layer") {
    const layers = blocks.dictionaries.map((name) => name.split(" ")[0].slice(1)).join(", ");

    traces = dictionaryTrace(rows);
    title = COPY.cross.layer.title;
    subtitle = COPY.cross.layer.subtitle;
    note.innerHTML = COPY.cross.layer.note(layers);
  } else if (state.crossColour === "gene" && state.gene && state.manifold.genes.has(state.gene)) {
    const coords = await loadJson(`data/manifold/genes/${state.gene}.json`);
    if (state.crossColour !== "gene" || coords.symbol !== state.gene) return;

    traces = continuousTrace(rows, coords.values, `${state.gene} effect`);
    title = COPY.cross.gene.title(state.gene);
    subtitle = COPY.cross.gene.subtitle(state.manifold.genes.get(state.gene).n_supported_blocks);
    note.textContent = COPY.cross.gene.note(state.gene);
  } else if (state.crossColour === "coordinate" && state.manifold.pathway) {
    const pathway = state.manifold.pathway;

    traces = continuousTrace(rows, pathway.values, "training effect");
    title = COPY.cross.pathway.title(pathway.name);
    subtitle = COPY.cross.pathway.subtitle(pathway.supported_blocks.length.toLocaleString());
    note.textContent = COPY.cross.pathway.note;
  } else {
    traces = dominantTraces(rows);
    title = COPY.cross.dominant.title(collection);
    subtitle = COPY.cross.dominant.subtitle(state.manifold.labels.legend.length, state.manifold.labels.n_other);
    legend = "gutter";
    note.textContent = COPY.cross.dominant.note;
  }

  note.innerHTML = COPY.cross.prefix + note.innerHTML;

  const marked = highlightTraces();
  const marker = selectedLabel();
  if (marker) {
    subtitle = `${subtitle} · ${COPY.cross.markedSubtitle(marker)}`;
    note.innerHTML += COPY.cross.marked(marker);
  } else {
    note.innerHTML += COPY.cross.unmarked(selectedCardLabel(), entry.pathway_id, total);
  }

  await paintManifold("manifoldMain", traces.concat(marked), title, subtitle, legend || marked.length > 0);
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
  gallery.innerHTML = "";

  if (!tiles.length) {
    gallery.innerHTML = `<p class="gallery-note">${COPY.gallery.empty}</p>`;
    return;
  }

  const maxValue = Math.max(...tiles.map((t) => t.max_patch));
  const geneMax = state.gene ? Math.max(0, ...tiles.map((tile) => (geneStats(tile) || { peak: 0 }).peak)) : 0;
  renderScaleBar(tiles);
  renderGeneScale(geneMax);

  tiles.forEach((tile) => {
    const card = document.createElement("div");
    card.className = "tile-card";
    const score = tileScore(tile);
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
  document.getElementById("modalTitle").textContent = COPY.modal.title(block, tile);
  document.getElementById("modalMeta").innerHTML = COPY.modal.meta(pathway, tile);

  const sorted = tile.patches.slice().sort((a, b) => b - a);
  const top = sorted.slice(0, 5).map((value) => value.toFixed(2)).join(", ");
  document.getElementById("modalStats").innerHTML =
    COPY.modal.stats(block, tile, tileScore(tile), state.bundle.tokens_per_tile, top);

  drawTile(document.getElementById("modalRaw"), tile, maxValue, { overlay: false });
  drawTile(document.getElementById("modalOverlay"), tile, maxValue, { opacity: Math.max(controls().opacity, 0.85), grid: true, geneMax: geneMax });
  drawHeat(document.getElementById("modalHeat"), tile, maxValue);

  const figure = document.getElementById("modalGeneFigure");
  const genes = geneStats(tile);
  document.getElementById("modalGrid").classList.toggle("with-gene", Boolean(genes));
  figure.classList.toggle("hidden", !genes);

  if (genes) {
    drawGeneHeat(document.getElementById("modalGene"), tile, geneMax);
    document.getElementById("modalGeneCaption").innerHTML = COPY.modal.geneCaption(state.gene, genes);
  }
}

// re-fetch the scripts, styles and data past the browser cache, then reload with the fresh copies
async function reloadAssets() {
  document.getElementById("reload").disabled = true;

  const assets = ["index.html", "app.js", "copy.js", "styles.css", "data/collections.json", `data/${state.slug}/index.json`,
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
  renderSidebar(document.getElementById("search").value);

  // gene sets do not carry across collections, so fall back to the strongest one
  state.gene = keptGene;
  const same = state.bundle.pathways.findIndex((entry) => entry.pathway_id === keptPathway);
  if (state.bundle.pathways.length) selectPathway(same >= 0 ? same : 0);
}

function resizeManifold() {
  requestAnimationFrame(() => {
    MANIFOLD_PLOTS.map((id) => document.getElementById(id)).filter((plot) => plot && plot.data)
      .forEach((plot) => Plotly.Plots.resize(plot));
  });
}

function toggleSidebar() {
  const layout = document.querySelector(".layout");
  const button = document.getElementById("sidebarToggle");
  const collapsed = layout.classList.toggle("sidebar-collapsed");
  const visible = !collapsed;

  button.setAttribute("aria-expanded", String(visible));
  button.title = visible ? "Hide pathway list" : "Show pathway list";
  document.getElementById("sidebarToggleGlyph").textContent = visible ? "‹" : "›";

  resizeManifold();
}

function setSidebarWidth(width, remember) {
  const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
  document.querySelector(".layout").style.setProperty("--sidebar-width", `${clamped}px`);

  if (remember) localStorage.setItem(SIDEBAR_KEY, String(clamped));

  resizeManifold();
}

function bindSidebarResize() {
  const handle = document.getElementById("sidebarResize");
  const stored = Number(localStorage.getItem(SIDEBAR_KEY));

  if (stored) setSidebarWidth(stored, false);

  handle.addEventListener("pointerdown", (event) => {
    const origin = document.getElementById("pathwaySidebar").getBoundingClientRect().left;

    handle.classList.add("dragging");
    document.body.classList.add("resizing");
    event.preventDefault();

    const drag = (move) => setSidebarWidth(move.clientX - origin, false);
    const stop = (up) => {
      window.removeEventListener("pointermove", drag);
      window.removeEventListener("pointerup", stop);
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing");
      setSidebarWidth(up.clientX - origin, true);
    };

    window.addEventListener("pointermove", drag);
    window.addEventListener("pointerup", stop);
  });

  handle.addEventListener("dblclick", () => setSidebarWidth(SIDEBAR_DEFAULT, true));
}

function bindControls() {
  document.getElementById("search").addEventListener("input", (event) => renderSidebar(event.target.value));
  document.getElementById("sidebarToggle").addEventListener("click", toggleSidebar);
  bindSidebarResize();
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
  renderSidebar("");
  bindControls();
  if (state.bundle.pathways.length) selectPathway(0);
}

init();
