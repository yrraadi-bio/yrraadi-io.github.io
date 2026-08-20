import {
  CARD_LIMIT,
  CARDS_KEY,
  GALLERY_LIMIT,
  GENE_STOPS,
  SIDEBAR_DEFAULT,
  SIDEBAR_KEY,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  bindTabs,
  blockNumber,
  controls,
  decimals,
  el,
  loadImage,
  loadJson,
  markTab,
  resetAssetCaches,
  state,
} from "./core.js";
import { COPY } from "./copy.js?v=20260819a";
import {
  loadBlockManifold,
  loadGeneCausal,
  loadManifold,
  loadTileGene,
  renderBlockManifold,
  renderCrossBlockMap,
  resizeManifold,
  tileExpression,
} from "./manifold.js?v=20260819a";
import { loadFeature, loadGene } from "./gene-data.js";

let request = 0;

function featureEntry(globalIndex) {
  return state.blocks.blocks.find((block) => block.block_global_index === globalIndex);
}

function geneEntry(symbol) {
  return state.genes.genes.find((gene) => gene.symbol === symbol);
}

function dominantGenes(globalIndex) {
  return state.dominance[globalIndex] || [];
}

function validFeature(globalIndex) {
  return dominantGenes(globalIndex).length > 0;
}

function isDominant(globalIndex, symbol) {
  return dominantGenes(globalIndex).some((pick) => pick.symbol === symbol);
}

// The card the page is built around, whichever axis is being browsed.
function activeCard() {
  if (state.browse === "block") {
    return state.featureDoc && state.featureDoc.genes.length ? state.featureDoc.genes[state.cardIndex] : null;
  }

  return state.geneDoc && state.geneDoc.blocks.length ? state.geneDoc.blocks[state.cardIndex] : null;
}

function activeCards() {
  if (state.browse === "block") return state.featureDoc ? state.featureDoc.genes : [];

  return state.geneDoc ? state.geneDoc.blocks : [];
}

function featureComparator() {
  if (state.blockSort === "layer") return (a, b) => (a.layer - b.layer) || (a.block - b.block);
  if (state.blockSort === "effect") return (a, b) => b.best_effect - a.best_effect;

  return (a, b) => (Number(validFeature(b.block_global_index)) - Number(validFeature(a.block_global_index)))
    || (b.best_effect - a.best_effect);
}

function geneComparator() {
  if (state.geneSort === "name") return (a, b) => a.symbol.localeCompare(b.symbol);
  if (state.geneSort === "breadth") return (a, b) => b.n_supported_features - a.n_supported_features;
  if (state.geneSort === "clustering") return (a, b) => clusteringOf(b) - clusteringOf(a);

  return (a, b) => b.best_effect - a.best_effect;
}

// Moran's I is undefined where a gene never varies, and those genes sort last.
function clusteringOf(entry) {
  return entry.clustering === null ? -Infinity : entry.clustering;
}

function clusteringText(entry) {
  return entry.clustering === null ? "n/a" : entry.clustering.toFixed(3);
}

function featureHaystack(block) {
  const genes = block.genes.map((entry) => entry.symbol).join(" ");

  return `#${blockNumber(block.layer, block.block)} ${block.layer}-${block.block} ${block.dictionary} ${genes}`.toLowerCase();
}

function featureRows() {
  return state.blocks.blocks.slice().sort(featureComparator()).map((block) => ({
    hay: featureHaystack(block),
    mark: validFeature(block.block_global_index) ? `<span class="valid-dot" title="${COPY.feature.validDot}"></span>` : "",
    name: `#${blockNumber(block.layer, block.block)}`,
    sub: `${block.dictionary} · ${block.best_effect.toFixed(decimals(block.best_effect))}`,
    count: COPY.feature.listGenes(block.n_genes),
    active: state.feature === block.block_global_index,
    select: () => selectFeature(block.block_global_index),
  }));
}

function geneRows() {
  return state.genes.genes.slice().sort(geneComparator()).map((gene) => ({
    hay: gene.symbol.toLowerCase(),
    mark: "",
    name: gene.symbol,
    sub: `${gene.best_effect.toFixed(decimals(gene.best_effect))} · I ${clusteringText(gene)}`,
    count: COPY.gene.listFeatures(gene.n_supported_features),
    active: state.browse === "gene" && state.gene === gene.symbol,
    select: () => selectGene(gene.symbol),
  }));
}

function renderSidebar(filter) {
  const byFeature = state.browse === "block";
  const list = el("targetList");
  const needle = (filter || "").trim().toLowerCase();
  list.innerHTML = "";

  (byFeature ? featureRows() : geneRows()).forEach((row) => {
    if (needle && !row.hay.includes(needle)) return;

    const item = document.createElement("div");
    item.className = `pathway-item${row.active ? " active" : ""}`;
    item.innerHTML = `
      <div class="ptext">
        <div class="pname">${row.mark}${row.name}</div>
        <div class="pid" title="${row.sub}">${row.sub}</div>
      </div>
      <span class="count">${row.count}</span>`;
    item.addEventListener("click", row.select);
    list.appendChild(item);
  });

  if (!list.children.length) {
    const empty = byFeature ? COPY.listEmptyFeature : COPY.listEmptyGene;
    list.innerHTML = `<p class="gallery-note" style="padding:10px">${empty}</p>`;
  }
}

async function selectFeature(globalIndex) {
  const token = ++request;
  state.feature = globalIndex;

  openDetail();
  const document = await loadFeature(globalIndex).catch((error) => error);
  if (token !== request) return;

  if (document instanceof Error) {
    el("gallery").innerHTML = `<p class="gallery-note">${COPY.loadFailed(`feature ${globalIndex}`, document.message)}</p>`;
    return;
  }

  state.featureDoc = document;

  // Browsing features makes the feature's strongest gene the pair partner.
  if (state.browse === "block") {
    state.cardIndex = 0;
    state.gene = document.lead_gene;
  }

  await paint(token);
}

async function selectGene(symbol) {
  const token = ++request;
  state.gene = symbol;

  openDetail();
  const document = await loadGene(symbol).catch((error) => error);
  if (token !== request) return;

  if (document instanceof Error) {
    el("gallery").innerHTML = `<p class="gallery-note">${COPY.loadFailed(`${symbol}.json`, document.message)}</p>`;
    return;
  }

  state.geneDoc = document;
  state.cardIndex = 0;
  state.feature = document.blocks[0].block_global_index;
  state.featureDoc = await loadFeature(state.feature);
  if (token !== request) return;

  await paint(token);
}

function openDetail() {
  el("empty").classList.add("hidden");
  el("detail").classList.remove("hidden");
  el("gallery").innerHTML = `<p class="gallery-note">${COPY.loading}</p>`;
}

async function paint(token) {
  renderHeader();
  renderSidebar(el("search").value);
  renderCards();
  await syncGeneAssets();
  if (token !== request) return;

  renderGallery();

  await Promise.all([loadBlockManifold(), loadGeneCausal()]);
  if (token === request) renderManifold();
}

// The gene overlay is the one asset both the gallery and the manifold read.
async function syncGeneAssets() {
  state.tileGene = null;
  if (state.gene) await loadTileGene(state.gene);
}

async function pickFeatureCard(index) {
  const token = ++request;
  state.cardIndex = index;
  state.feature = state.geneDoc.blocks[index].block_global_index;
  state.featureDoc = await loadFeature(state.feature);
  if (token !== request) return;

  await paint(token);
}

async function pickGeneCard(index) {
  const token = ++request;
  state.cardIndex = index;
  state.gene = state.featureDoc.genes[index].symbol;

  await paint(token);
}

function renderHeader() {
  const name = el("targetName");
  const lead = el("metaLead");
  const summary = el("supportedCount");
  lead.innerHTML = "";

  if (state.browse === "block") {
    const block = featureEntry(state.feature);

    name.textContent = COPY.feature.title(blockNumber(block.layer, block.block));
    summary.innerHTML = COPY.feature.meta(block, COPY.feature.genes(block.n_genes));
  } else {
    const gene = geneEntry(state.gene);

    name.textContent = state.gene;
    summary.innerHTML = COPY.gene.meta(state.geneDoc, COPY.gene.features(gene.n_supported_features));
  }

  renderPairEffect();
}

function renderPairEffect() {
  const badge = el("pairEffect");
  const output = el("pairEffectValue");
  const card = activeCard();
  badge.classList.remove("hidden", "positive", "negative");

  if (!card) {
    output.textContent = COPY.pair.none;
    badge.title = COPY.pair.noneTitle;
    badge.classList.add("negative");
    return;
  }

  output.textContent = `−${card.causal_decrease.toFixed(decimals(card.causal_decrease))}`;
  badge.classList.add("positive");
  badge.title = COPY.pair.title(state.gene, Object.assign({}, featureEntry(state.feature), card));
}

function effectRows(entry) {
  return `<table>
      <tr title="${COPY.cards.causalDecrease}"><td>causal decrease</td><td class="val">${entry.causal_decrease.toFixed(decimals(entry.causal_decrease))}</td></tr>
      <tr title="${COPY.cards.decreaseFraction}"><td>consistency</td><td class="val">${Math.round(entry.decrease_fraction * 100)}%</td></tr>
      <tr title="${COPY.cards.gapShare}"><td>share of gap</td><td class="val">${entry.gap_pct.toFixed(2)}%</td></tr>
      <tr title="${COPY.cards.clustering(state.genes.clustering_neighbours)}"><td>clustering</td><td class="val">${clusteringText(entry)}</td></tr>
    </table>`;
}

// The selected card survives folding even when the dominance rule greys it.
function cardCuts(rows) {
  const lit = rows.filter(([, shown]) => shown.picked);
  const strongestLit = new Set(lit.slice(0, CARD_LIMIT).map(([entry]) => entry));
  const listed = rows.filter(([, shown], index) => shown.active || shown.picked || index < CARD_LIMIT);

  return { listed: listed, folded: listed.filter(([entry, shown]) => shown.active || strongestLit.has(entry)) };
}

function fillCards(holder, toggle, entries, describe) {
  const strongest = Math.max(...entries.map((entry) => entry.causal_decrease), 0);
  const rows = entries.map((entry, index) => [entry, describe(entry, index)]);
  const { listed, folded } = cardCuts(rows);
  holder.innerHTML = "";

  (state.foldCards ? folded : listed).forEach(([entry, shown]) => {
    const card = document.createElement("div");
    card.className = `block-card${shown.extra}${shown.picked ? "" : " dull"}${shown.active ? " active" : ""}`;
    card.title = `${shown.title ? `${shown.title} · ` : ""}${COPY.cards.mark(shown.picked)}`;
    card.innerHTML = `
      <div class="bhead">
        <span class="bid">${shown.head}</span>
        ${shown.tag ? `<span class="tag">${shown.tag}</span>` : ""}
      </div>
      ${shown.sub ? `<div class="bsub">${shown.sub}</div>` : ""}
      ${effectRows(entry)}
      <div class="bar"><span style="width:${strongest > 0 ? (entry.causal_decrease / strongest) * 100 : 0}%"></span></div>`;
    card.addEventListener("click", shown.select);
    holder.appendChild(card);
  });

  markToggle(toggle, listed.length - folded.length);
}

function markToggle(id, hidden) {
  const button = el(id);

  button.classList.toggle("hidden", hidden === 0);
  button.textContent = COPY.cards.foldToggle(state.foldCards, hidden);
  button.title = COPY.cards.foldTitle;
  button.setAttribute("aria-pressed", String(state.foldCards));
}

function toggleCards() {
  state.foldCards = !state.foldCards;
  localStorage.setItem(CARDS_KEY, String(state.foldCards));
  renderCards();
}

function renderCards() {
  const byFeature = state.browse === "block";

  el("featuresSection").classList.toggle("hidden", byFeature);
  el("genesSection").classList.toggle("hidden", !byFeature);

  if (byFeature) return renderGeneCards();

  return renderFeatureCards();
}

function renderGeneCards() {
  const holder = el("geneCardList");
  const genes = state.featureDoc.genes;

  if (!genes.length) {
    holder.innerHTML = `<p class="gallery-note">${COPY.feature.silent}</p>`;
    el("geneMore").classList.add("hidden");
    return;
  }

  fillCards(holder, "geneMore", genes, (entry, index) => ({
    picked: isDominant(state.feature, entry.symbol),
    extra: " set-card",
    active: state.cardIndex === index,
    title: COPY.feature.geneTitle(entry),
    head: entry.symbol,
    sub: "",
    tag: "",
    select: () => pickGeneCard(index),
  }));
}

function renderFeatureCards() {
  fillCards(el("featureList"), "featureMore", state.geneDoc.blocks, (block, index) => ({
    picked: isDominant(block.block_global_index, state.gene),
    extra: "",
    active: state.cardIndex === index,
    title: COPY.gene.featureTitle(block),
    head: `#${blockNumber(block.layer, block.block)}`,
    sub: "",
    tag: block.dictionary,
    select: () => pickFeatureCard(index),
  }));
}

const BLOCK_STOPS = [[240, 247, 255], [198, 219, 239], [107, 174, 214], [33, 113, 181], [8, 48, 107]];

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

function ramp(t) {
  return interpolate(BLOCK_STOPS, t);
}

function geneRamp(t) {
  return interpolate(GENE_STOPS, t);
}

// Expression of the selected gene per patch.
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

// Keep only the strongest requested fraction of firing patches.
function cutoff(tile, fraction) {
  const firing = tile.patches.filter((value) => value > 0).sort((a, b) => b - a);
  if (!firing.length) return Infinity;

  const keep = Math.max(1, Math.round(firing.length * fraction));

  return firing[Math.min(keep, firing.length) - 1];
}

function rgb(colour) {
  return `rgb(${colour[0]},${colour[1]},${colour[2]})`;
}

function rgba(colour, alpha) {
  return `rgba(${colour[0]},${colour[1]},${colour[2]},${alpha})`;
}

function geometry(canvas) {
  const grid = state.genes.patch_grid;

  return { ctx: canvas.getContext("2d"), grid: grid, size: canvas.width, cell: canvas.width / grid };
}

function heatScale(reference) {
  return reference > 0 ? reference : 1;
}

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
  const grid = state.genes.patch_grid;
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

    for (let row = 0; row < grid; row += 1) {
      for (let column = 0; column < grid; column += 1) {
        const patch = row * grid + column;
        const raw = tile.patches[patch];
        if (raw <= 0 || raw < cut) continue;

        // Rescale the surviving band across the full ramp.
        const value = Math.min(1, raw / scale);
        const shaped = floor < 1 ? (value - floor) / (1 - floor) : 1;
        ctx.fillStyle = rgba(ramp(shaped), (0.3 + 0.7 * shaped) * settings.opacity);
        ctx.fillRect(column * cell, row * cell, cell + 0.5, cell + 0.5);
        lit.set(patch, shaped);
      }
    }

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

      // Ring gene-covered patches so the feature layer stays readable.
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

function drawGeneHeat(canvas, tile, geneMax) {
  const scale = heatScale(controls().normalize === "tile" ? geneStats(tile).peak : geneMax);

  drawPatchHeat(canvas, [...geneMap(tile).map], "#eceff2",
    (value) => (value > 0 ? rgb(geneRamp(0.25 + 0.75 * Math.min(1, value / scale))) : "#f8fbf9"));
}

// The edit only reaches a tile the feature fires on, so the gene ranking runs over those.
function activeTiles() {
  const tiles = state.featureDoc.tiles.slice().sort((a, b) => tileExpression(b) - tileExpression(a));

  return tiles.slice(0, GALLERY_LIMIT);
}

function tileScore(tile) {
  const value = tileExpression(tile);

  return value === null ? "n/a" : value.toFixed(3);
}

function setScaleTicks(prefix, low, high) {
  el(`${prefix}Min`).textContent = low;
  el(`${prefix}Max`).textContent = high;
}

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
  const holder = el("geneScale");

  if (!state.gene || !geneMax) {
    holder.classList.add("hidden");
    return;
  }

  holder.classList.remove("hidden");
  el("geneScaleName").textContent = state.gene;
  setScaleTicks("geneScale", "0", controls().normalize === "tile" ? "tile peak" : geneMax.toFixed(1));
}

function renderGallery() {
  if (!state.featureDoc) return;

  const tiles = activeTiles();
  const gallery = el("gallery");
  const card = activeCard();
  gallery.innerHTML = "";

  if (!tiles.length) {
    gallery.innerHTML = `<p class="gallery-note">${COPY.gallery.empty}</p>`;
    return;
  }

  const maxValue = Math.max(...tiles.map((tile) => tile.max_patch));
  const geneMax = state.gene ? Math.max(0, ...tiles.map((tile) => (geneStats(tile) || { peak: 0 }).peak)) : 0;
  const scanSlide = state.genes.slide;
  const onSlide = tiles.filter((tile) => tile.slide_id === scanSlide).length;
  renderScaleBar(tiles);
  renderGeneScale(geneMax);

  const expressing = tiles.filter((tile) => tileExpression(tile) > 0).length;

  el("galleryNote").innerHTML = COPY.gallery.basis(tiles.length, state.featureDoc.tiles.length, state.gene, expressing)
    + COPY.gallery.provenance(scanSlide, onSlide, tiles.length);

  tiles.forEach((tile) => {
    const item = document.createElement("div");
    item.className = "tile-card";
    const silent = tile.n_firing === 0 ? '<div class="row silent">this feature is silent here</div>' : "";
    const genes = geneStats(tile);
    const expression = state.tileGene
      ? `<div class="row"><span>${state.gene} on tile</span><b>${tileScore(tile)}</b></div>`
      : "";
    const geneRows = genes
      ? `<div class="row gene-row"><span>${state.gene} patches</span><b>${genes.expressing}/${genes.occupied}</b></div>
         <div class="row"><span>${state.gene} peak</span><b>${genes.peak.toFixed(1)}</b></div>`
      : "";

    item.innerHTML = `
      <canvas width="256" height="256"></canvas>
      <div class="cap">
        <div class="row"><span>${tile.slide_id}${tile.slide_id === scanSlide ? ' <span class="pill scan" title="This tile comes from the slide every causal number on this page was measured on.">scan</span>' : ""}</span><span class="pill ${tile.split}">${tile.split}</span></div>
        <div class="row"><span>peak patch</span><b>${tile.max_patch.toFixed(2)}</b></div>
        <div class="row"><span>peak : mean</span><b>${tile.peak_to_mean.toFixed(2)}&times;</b></div>
        <div class="row"><span>patches firing</span><b>${tile.n_firing}/${state.genes.tokens_per_tile}</b></div>
        ${expression}
        ${geneRows}
        ${silent}
      </div>`;
    item.addEventListener("click", () => openModal(tile, card, maxValue, geneMax));
    gallery.appendChild(item);
    drawTile(item.querySelector("canvas"), tile, maxValue, { geneMax: geneMax });
  });
}

function openModal(tile, card, maxValue, geneMax) {
  const block = featureEntry(state.feature);
  el("modal").classList.remove("hidden");
  el("modalTitle").textContent = COPY.modal.title(block, tile);
  el("modalMeta").innerHTML = COPY.modal.meta(state.gene || "no gene selected", tile);

  const sorted = tile.patches.slice().sort((a, b) => b - a);
  const top = sorted.slice(0, 5).map((value) => value.toFixed(2)).join(", ");
  el("modalStats").innerHTML = COPY.modal.stats(card, tile, state.genes.tokens_per_tile, top);

  drawTile(el("modalRaw"), tile, maxValue, { overlay: false });
  drawTile(el("modalOverlay"), tile, maxValue, { opacity: Math.max(controls().opacity, 0.85), grid: true, geneMax: geneMax });
  drawHeat(el("modalHeat"), tile, maxValue);

  const grid = state.genes.patch_grid;
  el("modalOverlayCaption").innerHTML = COPY.modal.overlayCaption(controls().fraction);
  el("modalHeatCaption").innerHTML = COPY.modal.heatCaption(grid * grid);

  const figure = el("modalGeneFigure");
  const genes = geneStats(tile);
  el("modalGrid").classList.toggle("with-gene", Boolean(genes));
  figure.classList.toggle("hidden", !genes);

  if (genes) {
    drawGeneHeat(el("modalGene"), tile, geneMax);
    el("modalGeneCaption").innerHTML = COPY.modal.geneCaption(state.gene, genes);
  }
}

function syncRecipe() {
  const cross = state.manifoldView === "cross";
  el("recipeCross").classList.toggle("hidden", !cross);
  el("recipeTile").classList.toggle("hidden", cross);
}

// The tile tab names the gene it is about to paint.
function syncGeneTab() {
  el("manifoldTileTab").textContent = `${state.gene} expression`;
}

async function renderManifold() {
  if (!state.manifold || !state.featureDoc) return;

  syncGeneTab();
  const cross = state.manifoldView === "cross";
  markTab("manifoldTabs", "view", state.manifoldView);
  el("crossControl").classList.toggle("hidden", !cross);
  el("scopeControl").classList.toggle("hidden", cross);
  el("manifoldFrame").classList.toggle("paired", !cross);
  syncRecipe();

  if (cross) return renderCrossBlockMap();

  return renderBlockManifold();
}

async function loadDominance() {
  state.dominance = (await loadJson("data/blocks/dominance.json")).blocks;
}

async function loadIndices() {
  const [genes, blocks] = await Promise.all([
    loadJson("data/genes/index.json"),
    loadJson("data/blocks/index.json"),
  ]);

  state.genes = genes;
  state.blocks = blocks;
  el("featureInfo").innerHTML = COPY.gene.panel(blocks, genes);
  el("geneInfo").innerHTML = COPY.feature.panel(blocks, genes);
  el("headInfo").innerHTML = COPY.head.panel(genes);
}

async function loadInitialData() {
  await Promise.all([loadIndices(), loadDominance()]);
  await loadManifold();
}

async function reloadAssets() {
  const button = el("reload");
  button.disabled = true;
  resetAssetCaches();

  const keptGene = state.gene;
  const keptFeature = state.feature;

  await loadInitialData();
  renderSidebar(el("search").value);

  if (state.browse === "block") await selectFeature(featureEntry(keptFeature) ? keptFeature : state.blocks.blocks[0].block_global_index);
  else await selectGene(geneEntry(keptGene) ? keptGene : state.genes.genes[0].symbol);

  button.disabled = false;
}

async function selectBrowse(browse) {
  if (browse === state.browse) return;

  state.browse = browse;
  markTab("browseTabs", "browse", browse);
  el("blockSort").classList.toggle("hidden", browse !== "block");
  el("geneSort").classList.toggle("hidden", browse !== "gene");
  el("search").placeholder = browse === "block" ? "Search feature number or gene…" : "Search gene symbol…";

  renderSidebar(el("search").value);

  if (browse === "block") return selectFeature(state.feature);

  return selectGene(state.gene && geneEntry(state.gene) ? state.gene : state.genes.genes[0].symbol);
}

function stepList(delta) {
  const items = [...document.querySelectorAll("#targetList .pathway-item")];
  const at = items.findIndex((item) => item.classList.contains("active"));
  const target = Math.min(items.length - 1, Math.max(0, at + delta));

  if (at < 0 || target === at) return;

  items[target].click();
  requestAnimationFrame(() => {
    const active = document.querySelector("#targetList .pathway-item.active");
    if (active) active.scrollIntoView({ block: "nearest" });
  });
}

function toggleSidebar() {
  const layout = document.querySelector(".layout");
  const button = el("sidebarToggle");
  const collapsed = layout.classList.toggle("sidebar-collapsed");
  const visible = !collapsed;

  button.setAttribute("aria-expanded", String(visible));
  button.title = visible ? "Hide the list" : "Show the list";
  el("sidebarToggleGlyph").textContent = visible ? "‹" : "›";
  resizeManifold();
}

function setSidebarWidth(width, remember) {
  const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
  document.querySelector(".layout").style.setProperty("--sidebar-width", `${clamped}px`);

  if (remember) localStorage.setItem(SIDEBAR_KEY, String(clamped));

  resizeManifold();
}

function bindSidebarResize() {
  const handle = el("sidebarResize");
  const stored = Number(localStorage.getItem(SIDEBAR_KEY));
  if (stored) setSidebarWidth(stored, false);

  handle.addEventListener("pointerdown", (event) => {
    const origin = el("pathwaySidebar").getBoundingClientRect().left;

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

function bindDockLift() {
  const dock = document.querySelector(".dock");
  const layout = document.querySelector(".layout");
  let last = window.scrollY;

  const update = () => {
    const at = window.scrollY;
    const moved = at - last;

    dock.classList.toggle("lifted", at > 6);
    if (Math.abs(moved) > 6) dock.classList.toggle("gone", moved > 0 && at > 140);
    if (at <= 140) dock.classList.remove("gone");
    layout.classList.toggle("dock-gone", dock.classList.contains("gone"));

    last = at;
  };

  window.addEventListener("scroll", update, { passive: true });
  update();
}

function bindModal() {
  const modal = el("modal");
  el("modalClose").addEventListener("click", () => modal.classList.add("hidden"));

  // Dismiss only when the press starts and ends on the backdrop.
  let pressedBackdrop = false;
  modal.addEventListener("mousedown", (event) => { pressedBackdrop = event.target === modal; });
  modal.addEventListener("click", (event) => {
    if (pressedBackdrop && event.target === modal) modal.classList.add("hidden");
    pressedBackdrop = false;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") modal.classList.add("hidden");

    const held = event.target.tagName === "SELECT" || !modal.classList.contains("hidden");
    if (held) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      stepList(event.key === "ArrowDown" ? 1 : -1);
    }
  });
}

function bindControls() {
  bindDockLift();
  bindSidebarResize();
  bindModal();

  el("search").addEventListener("input", (event) => renderSidebar(event.target.value));
  el("sidebarToggle").addEventListener("click", toggleSidebar);
  el("reload").addEventListener("click", reloadAssets);
  ["featureMore", "geneMore"].forEach((id) => el(id).addEventListener("click", toggleCards));

  bindTabs("browseTabs", "browse", selectBrowse);
  bindTabs("manifoldTabs", "view", (view) => {
    state.manifoldView = view;
    renderManifold();
  });

  const selects = {
    blockSort: ["blockSort", () => renderSidebar(el("search").value)],
    geneSort: ["geneSort", () => renderSidebar(el("search").value)],
    crossColour: ["crossColour", renderManifold],
  };

  Object.entries(selects).forEach(([id, [field, repaint]]) => {
    el(id).addEventListener("change", (event) => {
      state[field] = event.target.value;
      repaint();
    });
  });

  el("manifoldScope").addEventListener("change", renderManifold);
  el("opacity").addEventListener("input", renderGallery);
  ["fraction", "normalize", "showGrid"].forEach((id) => el(id).addEventListener("change", renderGallery));
}

async function init() {
  state.foldCards = localStorage.getItem(CARDS_KEY) !== "false";

  await loadInitialData();
  renderSidebar("");
  bindControls();

  // Open on the feature axis.
  await selectFeature(state.blocks.blocks[0].block_global_index);
}

if (typeof document !== "undefined") init();
