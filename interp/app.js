"use strict";

const state = {
  bundle: null,
  detail: null,
  pathway: null,
  blockIndex: 0,
  mode: "block",
  gene: null,
};

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

const payloadCache = new Map();

function loadPathway(pathwayId) {
  if (payloadCache.has(pathwayId)) return payloadCache.get(pathwayId);
  const promise = fetch(`data/pathways/${pathwayId}.json`).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  payloadCache.set(pathwayId, promise);

  // drop failures so a later click retries instead of replaying a rejected promise
  promise.catch(() => payloadCache.delete(pathwayId));

  return promise;
}

async function selectPathway(index) {
  const entry = state.bundle.pathways[index];
  state.pathway = index;
  state.blockIndex = 0;

  document.getElementById("empty").classList.add("hidden");
  document.getElementById("detail").classList.remove("hidden");
  document.getElementById("pathwayName").textContent = entry.name;
  document.getElementById("pathwayId").textContent = entry.pathway_id;
  document.getElementById("keggLink").href = `https://www.kegg.jp/pathway/${entry.pathway_id}`;
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
    chip.title = `${gene.symbol} · mean ${gene.mean} log1p CPM · sd ${gene.std} · measured on ${gene.train_slides}/46 training and ${gene.heldout_slides}/12 held-out slides · click to overlay its per-cell expression on the tiles`;
    chip.innerHTML = `
      <div class="grow"><span class="sym">${gene.symbol}</span><span class="lvl">${gene.mean.toFixed(2)}</span></div>
      <div class="meter"><span style="width:${strongest > 0 ? (gene.mean / strongest) * 100 : 0}%"></span></div>`;
    chip.addEventListener("click", () => {
      state.gene = state.gene === gene.symbol ? null : gene.symbol;
      renderGenes();
      renderGallery();
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
    14&times;14 grid as the block activation &mdash; patches with no measured cell stay unmarked.
    <button id="clearGene">clear ${state.gene}</button>`;
  document.getElementById("clearGene").addEventListener("click", () => {
    state.gene = null;
    renderGenes();
    renderGallery();
  });
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
    card.addEventListener("click", () => {
      state.blockIndex = index;
      renderBlocks();
      renderGallery();
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

  const assets = ["index.html", "app.js", "styles.css", "data/index.json"];
  if (state.pathway !== null) assets.push(`data/pathways/${state.bundle.pathways[state.pathway].pathway_id}.json`);

  await Promise.all(assets.map((asset) => fetch(asset, { cache: "reload" }).catch(() => null)));
  payloadCache.clear();
  imageCache.clear();

  location.reload();
}

function bindControls() {
  document.getElementById("search").addEventListener("input", (event) => renderSidebar(event.target.value));
  document.getElementById("reload").addEventListener("click", reloadAssets);

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
  const response = await fetch("data/index.json");
  state.bundle = await response.json();
  const built = state.bundle.built ? ` · data built ${state.bundle.built}` : "";
  document.getElementById("bundleLabel").textContent =
    `${state.bundle.label} · ${state.bundle.pathways.length} KEGG pathways · ${state.bundle.patch_grid}×${state.bundle.patch_grid} patch grid${built}`;
  document.getElementById("sourceNote").textContent = state.bundle.encoder_note;
  renderSidebar("");
  bindControls();
  if (state.bundle.pathways.length) selectPathway(0);
}

init();
