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
  browse: "block",
  blocks: null,
  dominance: {},
  blockPick: null,
  blockSort: "valid",
  foldCards: true,
  manifold: null,
  manifoldView: "pathway",
  crossColour: "strongest",
  manifoldCameras: {},
  blockManifold: null,
  tilePathway: null,
  tileGene: null,
};

// every element the app touches is reached by id, so one helper stands for the lookup throughout
function el(id) {
  return document.getElementById(id);
}

// the tab strips are the one place a group of elements is addressed at once
function tabs(id) {
  return [...document.querySelectorAll(`#${id} button`)];
}

// a strip carries exactly one choice, so it is always marked from that choice rather than toggled
function markTab(strip, key, value) {
  tabs(strip).forEach((button) => button.classList.toggle("active", button.dataset[key] === value));
}

function bindTabs(strip, key, choose) {
  tabs(strip).forEach((button) => button.addEventListener("click", () => choose(button.dataset[key])));
}

// the list can be folded to the strongest cards the rule kept, and the answer is remembered
const CARDS_KEY = "interp.foldCards";

// how many of the cards the rule kept a folded list holds
const CARD_LIMIT = 8;

const SIDEBAR_KEY = "interp.sidebarWidth";
const SIDEBAR_DEFAULT = 288;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 620;

// one in-flight promise per URL, so a repeated selection never refetches
const jsonCache = new Map();

// a refresh stamps a new epoch, which changes every URL and so misses the browser cache as well
let epoch = 0;

function bust(url) {
  return epoch ? `${url}${url.includes("?") ? "&" : "?"}v=${epoch}` : url;
}

function loadJson(url) {
  const target = bust(url);
  if (jsonCache.has(target)) return jsonCache.get(target);

  // the bundle is rebuilt in place under stable names, so every document is revalidated against the
  // server rather than read from the browser cache, which would otherwise mix an old index with new data
  const promise = fetch(target, { cache: "no-cache" }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  jsonCache.set(target, promise);
  promise.catch(() => jsonCache.delete(target));

  return promise;
}

// read display settings straight from the inputs so restored form state never desyncs
function controls() {
  return {
    fraction: parseFloat(el("fraction").value),
    normalize: el("normalize").value,
    opacity: parseFloat(el("opacity").value),
    grid: el("showGrid").checked,
  };
}

const imageCache = new Map();

function loadImage(src) {
  const target = bust(src);
  if (imageCache.has(target)) return imageCache.get(target);

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${target}`));
    img.src = target;
  });
  imageCache.set(target, promise);
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

// blue ramp for the block norm, green for gene expression
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

// |best_effect| never reaches 1, so the offset sorts every valid block ahead of every other one
// while both groups stay ranked by the same correlation inside themselves
const BLOCK_ORDER = {
  valid: (block) => (validBlock(block.block_global_index) ? -2 : 0) - Math.abs(block.best_effect),
  effect: (block) => -Math.abs(block.best_effect),
  layer: (block) => block.layer * 1000 + block.block,
};

// a correlation is read by its sign as much as by its size, so the sign is always printed
function signed(value, digits = 3) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

// the block list is searched by its own number, its dictionary, and the sets it carries
function blockHaystack(block) {
  const sets = block.pathways.map((entry) => `${entry.name} ${entry.pathway_id}`).join(" ");

  return `#${blockNumber(block.layer, block.block)} ${block.layer}-${block.block} ${block.dictionary} ${sets}`.toLowerCase();
}

function blockRows() {
  const order = BLOCK_ORDER[state.blockSort];

  return state.blocks.blocks.slice().sort((a, b) => order(a) - order(b)).map((block) => ({
    hay: blockHaystack(block),
    mark: validBlock(block.block_global_index) ? `<span class="valid-dot" title="${COPY.byBlock.validDot}"></span>` : "",
    name: `#${blockNumber(block.layer, block.block)}`,
    sub: `${block.dictionary} · r ${signed(block.best_effect)}`,
    count: COPY.byBlock.listSets(block.n_sets),
    active: state.blockPick === block.block_global_index,
    select: () => selectBlock(block.block_global_index),
  }));
}

function pathwayRows() {
  return state.bundle.pathways.map((pathway, index) => ({
    hay: `${pathway.name} ${pathway.pathway_id}`.toLowerCase(),
    mark: "",
    name: pathway.name,
    sub: pathway.pathway_id,
    count: `${pathway.n_supported_blocks} ft`,
    active: state.pathway === index,
    select: () => selectPathway(index),
  }));
}

// both axes are browsed through the same list, so only the rows differ between them
function renderSidebar(filter) {
  const byBlock = state.browse === "block";
  const list = el("pathwayList");
  const needle = (filter || "").trim().toLowerCase();
  list.innerHTML = "";

  (byBlock ? blockRows() : pathwayRows()).forEach((row) => {
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
    const empty = byBlock ? COPY.byBlock.listEmpty : COPY.sidebarEmpty;
    list.innerHTML = `<p class="gallery-note" style="padding:10px">${empty}</p>`;
  }
}

function loadPathway(pathwayId) {
  return loadJson(`data/${state.slug}/pathways/${pathwayId}.json`);
}

// one token per selection, so a slower document never paints over a newer choice in either view
let request = 0;

async function selectPathway(index) {
  state.blockPick = null;

  await showPathway(index, () => 0);
}

// paint everything that hangs off one pathway document; blockOf picks which of its cards is selected
async function showPathway(index, blockOf) {
  const token = ++request;
  const entry = state.bundle.pathways[index];
  state.pathway = index;
  state.blockIndex = 0;

  el("empty").classList.add("hidden");
  el("detail").classList.remove("hidden");
  el("basicCorrelation").classList.add("hidden");
  el("geneList").innerHTML = "";
  el("gallery").innerHTML = `<p class="gallery-note">${COPY.loading}</p>`;
  renderHeader(entry);

  renderSidebar(el("search").value);

  state.detail = await loadPathway(entry.pathway_id).catch((error) => error);
  if (token !== request) return;

  if (state.detail instanceof Error) {
    el("gallery").innerHTML = `<p class="gallery-note">${COPY.loadFailed(entry.pathway_id, state.detail.message)}</p>`;
    return;
  }

  state.blockIndex = blockOf(state.detail);
  keepGeneIfScored();

  renderCards();
  renderGenes();
  renderGallery();

  await Promise.all([loadPathwayCoords(entry.pathway_id), loadTilePathway(entry.pathway_id), loadBlockManifold()]);
  if (token === request) renderManifold();
}

// the transposed view: one block, and every gene set it reproduces
async function selectBlock(globalIndex) {
  state.blockPick = globalIndex;

  const sets = selectableSets(globalIndex);
  const current = state.pathway === null ? null : state.bundle.pathways[state.pathway].pathway_id;

  // a block usually carries the set already on screen, and keeping it makes the two views comparable
  await showAssociation(sets.find((entry) => entry.pathway_id === current) || sets[0]);
}

// one (block, set) pair, whichever collection the set belongs to
async function showAssociation(entry) {
  if (entry.slug !== state.slug) await useCollection(entry.slug);

  const index = state.bundle.pathways.findIndex((pathway) => pathway.pathway_id === entry.pathway_id);

  await showPathway(index, (document) => {
    const at = document.blocks.findIndex((block) => block.block_global_index === state.blockPick);
    return at < 0 ? 0 : at;
  });
}

function blockEntry(globalIndex) {
  return state.blocks.blocks.find((block) => block.block_global_index === globalIndex);
}

// a block lists every set it reproduces, but only the ones the bundle exported can be opened
function selectableSets(globalIndex) {
  return blockEntry(globalIndex).pathways.filter((entry) => entry.drawable);
}

function renderHeader(entry) {
  const name = el("pathwayName");
  const lead = el("metaLead");
  const summary = el("supportedCount");

  if (state.browse === "block") {
    const block = blockEntry(state.blockPick);

    name.textContent = COPY.byBlock.title(blockNumber(block.layer, block.block));
    lead.classList.add("hidden");
    summary.innerHTML = COPY.byBlock.meta(block, COPY.byBlock.sets(block.n_sets));
    return;
  }

  const template = state.bundle.pathway_url_template || "https://www.kegg.jp/pathway/{pathway_id}";

  name.textContent = entry.name;
  lead.classList.remove("hidden");
  el("pathwayId").textContent = entry.pathway_id;
  el("keggLink").href = template.replace("{pathway_id}", entry.pathway_id);
  summary.textContent = COPY.supportedBlocks(entry.n_supported_blocks);
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

// the pathway view lists the genes this set puts inside the block; the block view pools all of its sets
function geneCards() {
  if (state.browse === "block") return blockEntry(state.blockPick).genes;

  return state.detail.blocks[state.blockIndex].genes;
}

async function pickGene(gene) {
  const scored = state.detail.blocks[state.blockIndex].genes.some((entry) => entry.symbol === gene.symbol);

  // a pooled gene may be measured only by another of the block's sets, which then has to come forward
  if (!scored) {
    state.gene = gene.symbol;
    state.manifoldView = "gene";

    await showAssociation(selectableSets(state.blockPick).find((entry) => entry.pathway_id === gene.pathway_id));
    return;
  }

  state.gene = state.gene === gene.symbol ? null : gene.symbol;

  // selecting a gene recolours the manifold by that gene, deselecting returns to the pathway
  state.manifoldView = state.gene ? "gene" : "pathway";

  renderGenes();
  renderGallery();
  renderManifold();
}

function renderGenes() {
  const block = state.detail.blocks[state.blockIndex];
  const holder = el("geneList");
  const genes = geneCards();
  holder.innerHTML = "";

  // a set can reproduce in a block without any of its genes being measured there, and an empty
  // heading reads as a broken page rather than as an absence
  el("geneSection").classList.toggle("hidden", genes.length === 0);

  const strongest = Math.max(...genes.map((gene) => gene.clustering));
  const sets = state.browse === "block" ? blockEntry(state.blockPick).pathways : [];

  genes.forEach((gene) => {
    const source = sets.find((entry) => entry.pathway_id === gene.pathway_id);
    const chip = document.createElement("div");
    // dashed border marks genes absent from some slide panels
    chip.className = `gene-chip${gene.train_slides < 46 ? " partial" : ""}${state.gene === gene.symbol ? " active" : ""}`;
    chip.title = COPY.genes.chipTitle(gene, blockLabel(block)) + (source ? COPY.genes.viaSet(source.name) : "");
    chip.innerHTML = `
      <div class="sym">${gene.symbol}</div>
      <div class="grow">
        <span class="lvl" title="${COPY.genes.clusteringLabel}">I ${gene.clustering.toFixed(2)}</span>
        <span class="lvl" title="${COPY.genes.activationLabel}">r ${signed(gene.activation_r, 2)}</span>
      </div>
      <div class="meter"><span style="width:${strongest > 0 ? (gene.clustering / strongest) * 100 : 0}%"></span></div>`;
    chip.addEventListener("click", () => pickGene(gene));
    holder.appendChild(chip);
  });
}

function renderBasicCorrelation() {
  const badge = el("basicCorrelation");
  const output = el("basicCorrelationValue");

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

  output.textContent = `r ${signed(value)}`;
  badge.classList.add(value >= 0 ? "positive" : "negative");
  badge.title = COPY.correlation.title(state.detail.name, block);
}

// the two views differ only in which axis is a list of cards, so one place decides which one is drawn
function renderCards() {
  const byBlock = state.browse === "block";

  el("blocksSection").classList.toggle("hidden", byBlock);
  el("setsSection").classList.toggle("hidden", !byBlock);

  if (byBlock) return renderSets();

  return renderBlocks();
}

// the three numbers every card reports, whichever axis the card is on
function effectRows(entry) {
  return `<table>
      <tr title="${COPY.blocks.heldoutR}"><td>held-out r</td><td class="val">${entry.heldout_effect.toFixed(3)}</td></tr>
      <tr title="${COPY.blocks.trainR}"><td>training r</td><td class="val">${entry.train_effect.toFixed(3)}</td></tr>
      <tr title="${COPY.blocks.deltaR2}"><td>&Delta;R&sup2; held-out</td><td class="val">${entry.delta_r2.toFixed(4)}</td></tr>
    </table>`;
}

// the cards ranked by |held-out r|. folded, the list holds the strongest CARD_LIMIT cards the rule
// kept and the card the page is built around, and nothing else; opened, it holds every card. the bar
// scales over every card rather than the drawn ones, so a hidden card cannot restretch the visible
function fillCards(holder, button, entries, describe) {
  const strongest = Math.max(...entries.map((entry) => Math.abs(entry.heldout_effect)), 0);
  const rows = entries.map((entry, index) => [entry, describe(entry, index)]);

  const rank = new Map();
  rows.filter(([, shown]) => shown.picked).forEach(([entry], index) => rank.set(entry, index));

  const kept = ([entry, shown]) => shown.active || (shown.picked && rank.get(entry) < CARD_LIMIT);
  const drawn = state.foldCards ? rows.filter(kept) : rows;

  holder.innerHTML = "";

  drawn.forEach(([entry, shown]) => {
    const card = document.createElement("div");
    card.className = `block-card${shown.extra}${dulled(shown.picked)}${shown.active ? " active" : ""}`
      + (shown.select ? "" : " inert");
    card.title = `${shown.title ? `${shown.title} · ` : ""}${COPY.blocks.mark(shown.picked)}`
      + (shown.select ? "" : ` · ${COPY.blocks.inert}`);
    card.innerHTML = `
      <div class="bhead">
        <span class="bid">${shown.head}</span>
        ${shown.tag ? `<span class="tag">${shown.tag}</span>` : ""}
      </div>
      ${effectRows(entry)}
      <div class="bar"><span style="width:${strongest > 0 ? (Math.abs(entry.heldout_effect) / strongest) * 100 : 0}%"></span></div>`;
    if (shown.select) card.addEventListener("click", shown.select);
    holder.appendChild(card);
  });

  markToggle(button, rows.length - rows.filter(kept).length);
}

// the folded cards are counted whether the list is folded or not, so the control reads the same either way
function markToggle(id, folded) {
  const button = el(id);

  button.classList.toggle("hidden", folded === 0);
  button.textContent = COPY.blocks.foldToggle(state.foldCards, folded);
  button.title = COPY.blocks.foldTitle;
  button.setAttribute("aria-pressed", String(state.foldCards));
}

// the answer is remembered, since a reader who opened one list usually wants the next opened too
function toggleCards() {
  state.foldCards = !state.foldCards;
  localStorage.setItem(CARDS_KEY, String(state.foldCards));

  renderCards();
}

// a block is valid when the held-out evidence singles out one of its sets
function validBlock(globalIndex) {
  return Boolean(state.dominance[globalIndex]);
}

// the one set a block's held-out evidence points at, decided at build time over every set it carries
function isDominant(globalIndex, slug, pathwayId) {
  const pick = state.dominance[globalIndex];

  return Boolean(pick) && pick.slug === slug && pick.pathway_id === pathwayId;
}

// a card the rule did not pick keeps its numbers and loses its colour
function dulled(picked) {
  return picked ? "" : " dull";
}

// every gene set the selected block carries, as the transpose of the block cards
function renderSets() {
  const block = blockEntry(state.blockPick);
  const current = state.bundle.pathways[state.pathway].pathway_id;
  renderBasicCorrelation();

  fillCards(el("setList"), "setMore", block.pathways, (entry) => ({
    picked: isDominant(block.block_global_index, entry.slug, entry.pathway_id),
    extra: " set-card",
    active: entry.drawable && entry.pathway_id === current,
    title: COPY.byBlock.setTitle(entry),
    head: entry.name,
    tag: entry.collection_label,
    select: entry.drawable ? () => showAssociation(entry) : null,
  }));
}

function renderBlocks() {
  renderBasicCorrelation();

  fillCards(el("blockList"), "blockMore", state.detail.blocks, (block, index) => ({
    picked: isDominant(block.block_global_index, state.slug, state.detail.pathway_id),
    extra: "",
    active: state.blockIndex === index,
    title: "",
    head: `#${blockNumber(block.layer, block.block)}`,
    tag: "",
    select: () => pickBlockCard(index),
  }));
}

async function pickBlockCard(index) {
  state.blockIndex = index;

  // the cards rank genes inside this block, so a gene the new block cannot score is dropped
  keepGeneIfScored();

  renderBlocks();
  renderGenes();
  renderGallery();

  // the manifold belongs to this block, so selecting a card loads a different embedding
  await loadBlockManifold();
  renderManifold();
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
  el(`${prefix}Min`).textContent = low;
  el(`${prefix}Max`).textContent = high;
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
  const holder = el("geneScale");

  if (!state.gene) {
    holder.classList.add("hidden");
    return;
  }

  holder.classList.remove("hidden");
  el("geneScaleName").textContent = state.gene;

  setScaleTicks("geneScale", "0", controls().normalize === "tile" ? "tile peak" : geneMax.toFixed(1));
}

/* ---------- 3D block manifold ---------- */

// the theme's register: pastels, which are the only categorical colours that hold their hue on navy
const MANIFOLD_PALETTE = ["#8FC0F0", "#F0A86A", "#7FD6A8", "#F08A7A", "#C4A2E8", "#E8CF7A", "#68C8CF", "#AAB8CC", "#C3D977", "#E3A6C8"];
const AXIS_PAD = 0.04;

// magenta sits outside every colour scale used for the points, so the marked block cannot blend in
const HIGHLIGHT = "#FF5ECB";

// the plot chrome tracks the site theme's tokens, so a plot reads as part of the page
const CHROME = {
  ink: "#f2f6fb",
  muted: "rgba(224,235,248,0.62)",
  subtle: "rgba(200,218,240,0.58)",
  rule: "rgba(180,205,240,0.2)",
  // the cube is ruled far more densely than the page, so its lines sit under the page's hairline
  grid: "rgba(180,205,240,0.12)",
  // a recess rather than a lit box, so the dark end of a sequential ramp still reads inside the cube
  wall: "rgba(6,14,26,0.55)",
  panel: "rgba(9,19,35,0.92)",
};

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
    title: { text: title, font: { size: 12, color: CHROME.muted } },
    range: axisRange(values),
    showbackground: true,
    backgroundcolor: CHROME.wall,
    gridcolor: CHROME.grid,
    zeroline: false,
    showticklabels: true,
    ticks: "outside",
    tickfont: { size: 9.5, color: CHROME.muted },
    showspikes: false,
  };
}

// a legend of many categories cannot sit over the cube, so it claims a band on the left and the cube keeps the middle
const LEGEND_WIDTH = 262;

// the axis titles and ticks are drawn outside the cube, so the band only takes width they and the cube cannot use
const AXIS_FURNITURE = 120;

// a legend entry cut mid-word reads as a defect, so it stops at a word and says it was cut
function shorten(text, limit) {
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");

  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).replace(/[\s,;:]+$/, "")}…`;
}

// the serif title and its caption need their own band above the cube
const TITLE_BAND = 70;
const PLOT_PAD = 4;

// the ramp lies in a band below the cube, which every plot reserves so the pair keeps one cube size
const RAMP_BAND = 54;

function legendGutter(holder) {
  const width = holder.clientWidth;
  const cube = holder.clientHeight - TITLE_BAND - RAMP_BAND;
  const spare = (width - cube - AXIS_FURNITURE) / 2;

  return Math.min(LEGEND_WIDTH, Math.max(0, spare)) / width;
}

function manifoldLayout(id, title, subtitle, showLegend, coords) {
  const blocks = coords || state.manifold.blocks;
  const holder = el(id);
  const banded = showLegend === "gutter";
  const gutter = banded ? legendGutter(holder) : 0;

  // too narrow a band leaves the legend overhanging the cube, so it stops being an opaque panel
  const tight = banded && gutter * holder.clientWidth < LEGEND_WIDTH;

  // the page sets its headings in the theme's serif, so a plot title follows and its caption stays in Inter
  // a long set name overruns the narrow half of a pair, so both lines are cut to what the panel holds
  const heading = shorten(title, Math.max(20, Math.floor(holder.clientWidth / 10.5)));
  const line = subtitle ? shorten(subtitle, Math.max(30, Math.floor(holder.clientWidth / 6))) : "";

  const caption = line
    ? `<br><span style="font-family:Inter,system-ui,sans-serif;font-size:11.5px;fill:${CHROME.muted}">${line}</span>`
    : "";

  return {
    title: {
      text: `${heading}${caption}`,
      x: 0.5,
      xanchor: "center",
      font: { family: "Instrument Serif, Georgia, serif", size: 21, color: CHROME.ink },
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
      font: { size: 10.5, color: CHROME.muted },
      bgcolor: banded && !tight ? CHROME.panel : "rgba(9,19,35,0.78)",
      bordercolor: CHROME.rule,
      borderwidth: 1,
      x: banded ? 0 : 0.01,
      xanchor: "left",
      y: banded ? 0.5 : 0.99,
      yanchor: banded ? "middle" : "top",
    },
    margin: { l: PLOT_PAD, r: PLOT_PAD, t: TITLE_BAND, b: RAMP_BAND },
    // the plot sits on the frame's glass, so it brings no paper of its own
    paper_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Inter, system-ui, sans-serif", color: CHROME.muted },
    hoverlabel: { bgcolor: CHROME.panel, bordercolor: CHROME.rule, font: { family: "Inter, system-ui, sans-serif", size: 11.5, color: CHROME.ink } },
    modebar: { bgcolor: "rgba(0,0,0,0)", color: "rgba(200,218,240,0.4)", activecolor: "#7FB4FF" },
  };
}

const PLOT_CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["resetCameraLastSave3d"] };

// the gallery's own ramps, reused so a colour means the same thing in the tiles and in the manifold
function scaleFrom(stops) {
  return stops.map((stop, index) => [index / (stops.length - 1), `rgb(${stop[0]},${stop[1]},${stop[2]})`]);
}

// The tiles are drawn on pale tissue, where more expression has to mean darker. The manifold is points on
// navy, where that would make the strongest tiles the ones that vanish, so the same greens run the other
// way and the darkest stop is lifted clear of the ground.
const EXPRESSION_SCALE = scaleFrom([[27, 94, 66], ...GENE_STOPS.slice(0, 4).reverse()]);
// muted slate, so tiles carrying no value stay quiet against the ground rather than lighting up
const MISSING_COLOUR = "#5B708C";
const TISSUE_COLOURS = {
  Bowel: "#E0A061",
  Breast: "#EF8FA8",
  Lung: "#87BFE0",
  Pancreas: "#B79EE6",
  Skin: "#6FC9A3",
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
  const scope = el("manifoldScope").value;
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
// it lies below the cube like the gallery's scale bars, which also keeps the axis titles their room at the sides
function colourbar(title) {
  return { title: { text: title, side: "top", font: { size: 10.5, color: CHROME.muted } },
           orientation: "h", x: 0.5, xanchor: "center", y: 0, yanchor: "top", len: 0.52, thickness: 11,
           xpad: 4, ypad: 4,
           outlinecolor: CHROME.rule, outlinewidth: 1, tickfont: { size: 9.5, color: CHROME.subtle } };
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
    const strongest = code >= 0 ? legend[code].name
      : code === -2 ? COPY.hover.strongestOther : COPY.hover.strongestNone;

    return COPY.hover.block(blockNumber(blocks.layer[i], blocks.block[i]), strongest);
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

  return `feature #${blockNumber(state.manifold.blocks.layer[at], state.manifold.blocks.block[at])}`;
}

function blockLabel(block) {
  return `feature #${blockNumber(block.layer, block.block)}`;
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
  markers(`selected feature: ${label}`, spot, [label],
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

function strongestTraces(rows) {
  const blocks = state.manifold.blocks;
  const labels = state.manifold.labels;
  const traces = [];

  const background = rows.filter((index) => labels.code[index] < 0);
  if (background.length) {
    traces.push(markers(`no reproduced pathway (${background.length})`, xyz(blocks, background),
                       blockHover(background), { size: 2.0, color: MISSING_COLOUR, opacity: 0.5 }));
  }

  labels.legend.forEach((entry, code) => {
    const rowsFor = rows.filter((index) => labels.code[index] === code);
    if (!rowsFor.length) return;

    traces.push(markers(`${shorten(entry.name, 34)} (${rowsFor.length})`, xyz(blocks, rowsFor), blockHover(rowsFor),
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
  el(id).on("plotly_relayout", (event) => {
    if (event["scene.camera"]) state.manifoldCameras[id] = event["scene.camera"];
  });
}

// both views finish the same way: draw into one holder, then keep the camera binding alive
async function paintManifold(id, traces, title, subtitle, legend, coords) {
  const holder = el(id);

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
    const holder = el(id);
    Plotly.purge(holder);
    delete holder.dataset.bound;
    holder.innerHTML = id === "manifoldMain" ? `<p class="gallery-note" style="padding:16px">${text}</p>` : "";
  });

  el("manifoldNote").textContent = "";
}

// the two views are built from different inputs, so each carries its own construction note
function syncRecipe() {
  const cross = state.manifoldView === "cross";
  el("recipeCross").classList.toggle("hidden", !cross);
  el("recipeTile").classList.toggle("hidden", cross);
}

// the gene tab only exists while a gene the tiles can be coloured by is selected
function syncGeneTab() {
  const tab = el("manifoldGeneTab");
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
  markTab("manifoldTabs", "view", state.manifoldView);
  el("crossControl").classList.toggle("hidden", !cross);
  el("scopeControl").classList.toggle("hidden", cross);

  // the cross-block map is one map of its own, so only the tile views come as a pair
  el("manifoldFrame").classList.toggle("paired", !cross);
  syncRecipe();

  if (cross) return renderCrossBlockMap();

  return renderBlockManifold(geneAvailable);
}

// the selected block's own manifold: its tiles, embedded from the coordinates that block assigns them
async function renderBlockManifold(geneAvailable) {
  const note = el("manifoldNote");
  const card = state.detail.blocks[state.blockIndex];
  const payload = state.blockManifold;
  const entry = state.detail;
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
  const note = el("manifoldNote");
  const blocks = state.manifold.blocks;
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
    traces = strongestTraces(rows);
    title = COPY.cross.strongest.title(collection);
    subtitle = COPY.cross.strongest.subtitle(state.manifold.labels.legend.length, state.manifold.labels.n_other);
    legend = "gutter";
    note.textContent = COPY.cross.strongest.note;
  }

  note.innerHTML = COPY.cross.prefix + note.innerHTML;

  const marked = highlightTraces();
  const marker = selectedLabel();
  if (marker) {
    subtitle = `${subtitle} · ${COPY.cross.markedSubtitle(marker)}`;
    note.innerHTML += COPY.cross.marked(marker, COPY.cross.where[state.browse]);
  } else {
    note.innerHTML += COPY.cross.unmarked(selectedCardLabel(), state.detail.pathway_id, total);
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

// a set with no exported per-block effects simply leaves the cross-block colouring empty
async function loadPathwayCoords(pathwayId) {
  if (!state.manifold) return;

  state.manifold.pathway = state.manifold.pathways.has(pathwayId)
    ? await loadJson(`data/${state.slug}/manifold/pathways/${pathwayId}.json`).catch(() => null)
    : null;
}

function renderGallery() {
  if (!state.detail) return;

  const pathway = state.detail;
  const { tiles, block } = activeTiles();
  const gallery = el("gallery");
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
    const silent = tile.n_firing === 0 ? '<div class="row silent">this feature is silent here</div>' : "";
    const coverage = state.mode === "score"
      ? `<div class="row"><span>features firing here</span><b>${tile.n_blocks_firing}/${pathway.blocks.length}</b></div>`
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
  el("modal").classList.remove("hidden");
  el("modalTitle").textContent = COPY.modal.title(block, tile);
  el("modalMeta").innerHTML = COPY.modal.meta(pathway, tile);

  const sorted = tile.patches.slice().sort((a, b) => b - a);
  const top = sorted.slice(0, 5).map((value) => value.toFixed(2)).join(", ");
  el("modalStats").innerHTML =
    COPY.modal.stats(block, tile, tileScore(tile), state.bundle.tokens_per_tile, top);

  drawTile(el("modalRaw"), tile, maxValue, { overlay: false });
  drawTile(el("modalOverlay"), tile, maxValue, { opacity: Math.max(controls().opacity, 0.85), grid: true, geneMax: geneMax });
  drawHeat(el("modalHeat"), tile, maxValue);

  const grid = state.bundle.patch_grid;
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

// re-read the built data and repaint the cards, the plots and the tiles in place; the document itself
// stays, so a change to the scripts or the styles still needs a browser reload
async function reloadAssets() {
  const button = el("reload");
  button.disabled = true;

  epoch = Date.now();
  jsonCache.clear();
  imageCache.clear();

  const keptPathway = state.pathway === null ? null : state.bundle.pathways[state.pathway].pathway_id;
  const keptBlock = state.blockPick;

  state.collections = (await loadJson("data/collections.json")).collections;
  if (!state.collections.some((entry) => entry.slug === state.slug)) state.slug = state.collections[0].slug;

  state.bundle = await loadJson(`data/${state.slug}/index.json`);
  await Promise.all([loadManifold(), loadDominance()]);
  if (state.blocks) await loadBlockIndex();

  renderCollectionPicker();
  renderSidebar(el("search").value);
  await reselect(keptPathway, keptBlock);

  button.disabled = false;
}

// put the same selection back on screen, or the nearest one the rebuilt data still holds
async function reselect(pathwayId, globalIndex) {
  if (state.browse === "block") {
    return selectBlock(blockEntry(globalIndex) ? globalIndex : state.blocks.blocks[0].block_global_index);
  }

  if (!state.bundle.pathways.length) return;

  const at = state.bundle.pathways.findIndex((entry) => entry.pathway_id === pathwayId);

  return selectPathway(at < 0 ? 0 : at);
}

// the collection the list is drawn from, chosen above the list itself
function renderCollectionPicker() {
  const picker = el("collectionSelect");
  picker.innerHTML = "";

  // a single collection needs no switch, so the control stays out of the way
  el("collectionWrap").classList.toggle("hidden", state.collections.length < 2);

  state.collections.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.slug;
    option.textContent = `${entry.collection_label} · ${entry.n_pathways} sets`;
    picker.appendChild(option);
  });

  picker.value = state.slug;
}

// swap the collection every pathway lookup reads from, without deciding what is shown next
async function useCollection(slug) {
  state.slug = slug;
  state.bundle = await loadJson(`data/${slug}/index.json`);
  await loadManifold();
  renderCollectionPicker();
}

async function selectCollection(slug) {
  if (slug === state.slug) return;

  const keptPathway = state.pathway === null ? null : state.bundle.pathways[state.pathway].pathway_id;
  const keptGene = state.gene;

  state.pathway = null;
  state.detail = null;
  state.blockIndex = 0;

  await useCollection(slug);
  renderSidebar(el("search").value);

  // gene sets do not carry across collections, so fall back to the strongest one
  state.gene = keptGene;
  const same = state.bundle.pathways.findIndex((entry) => entry.pathway_id === keptPathway);
  if (state.bundle.pathways.length) selectPathway(same >= 0 ? same : 0);
}

// both axes grey their cards from this one map, so it is loaded before anything is drawn
async function loadDominance() {
  const payload = await loadJson("data/blocks/dominance.json");

  state.dominance = payload.blocks;
  el("blockInfo").innerHTML = COPY.blocks.panel(payload);
}

// the block index carries the cuts its panel quotes, so the panel is written as it arrives
async function loadBlockIndex() {
  state.blocks = await loadJson("data/blocks/index.json");
  el("setInfo").innerHTML = COPY.byBlock.panel(state.blocks);
}

// the axis the list is browsed along: gene sets and their blocks, or blocks and their gene sets
async function selectBrowse(browse) {
  if (browse === state.browse) return;

  state.browse = browse;
  markTab("browseTabs", "browse", browse);

  // a collection holds gene sets, while a block belongs to no single one, so the picker follows the axis
  el("collectionSelect").classList.toggle("hidden", browse === "block");
  el("blockSort").classList.toggle("hidden", browse !== "block");
  el("search").placeholder = browse === "block"
    ? "Search feature number or gene set…" : "Search pathway name or id…";

  if (browse === "block" && !state.blocks) await loadBlockIndex();

  renderSidebar(el("search").value);

  // the block carrying the set on screen is the one that continues the thought
  if (browse === "block") return selectBlock(carriedBlock());

  return selectPathway(state.pathway === null ? 0 : state.pathway);
}

// entering the block view from a pathway keeps the selected card, which is already a block of that set
function carriedBlock() {
  const selected = state.detail && state.detail.blocks[state.blockIndex];
  if (selected && blockEntry(selected.block_global_index)) return selected.block_global_index;

  return state.blocks.blocks[0].block_global_index;
}

// stepping the list is the quickest way to sweep it, and the selection is rebuilt on every step
function stepList(delta) {
  const items = [...document.querySelectorAll("#pathwayList .pathway-item")];
  const at = items.findIndex((item) => item.classList.contains("active"));
  const target = Math.min(items.length - 1, Math.max(0, at + delta));

  if (at < 0 || target === at) return;

  items[target].click();
  requestAnimationFrame(() => {
    const active = document.querySelector("#pathwayList .pathway-item.active");
    if (active) active.scrollIntoView({ block: "nearest" });
  });
}

function resizeManifold() {
  requestAnimationFrame(() => {
    MANIFOLD_PLOTS.map((id) => el(id)).filter((plot) => plot && plot.data)
      .forEach((plot) => Plotly.Plots.resize(plot));
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

// The bar floats over the page rather than reserving a strip of it, so reading downward has to clear it:
// it leaves on the way down and returns on the first move back up, where its controls are wanted.
function bindDockLift() {
  const dock = document.querySelector(".dock");
  let last = window.scrollY;

  const update = () => {
    const at = window.scrollY;
    const moved = at - last;

    dock.classList.toggle("lifted", at > 6);

    // the settling frames at the end of a gesture must not undo the direction it was going in
    if (Math.abs(moved) > 6) dock.classList.toggle("gone", moved > 0 && at > 140);
    if (at <= 140) dock.classList.remove("gone");

    last = at;
  };

  window.addEventListener("scroll", update, { passive: true });
  update();
}

function bindControls() {
  bindDockLift();

  el("search").addEventListener("input", (event) => renderSidebar(event.target.value));
  el("collectionSelect").addEventListener("change", (event) => selectCollection(event.target.value));
  el("sidebarToggle").addEventListener("click", toggleSidebar);
  el("reload").addEventListener("click", reloadAssets);
  ["blockMore", "setMore"].forEach((id) => el(id).addEventListener("click", toggleCards));
  bindSidebarResize();

  bindTabs("browseTabs", "browse", selectBrowse);

  bindTabs("manifoldTabs", "view", (view) => {
    state.manifoldView = view;
    renderManifold();
  });

  bindTabs("modeTabs", "mode", (mode) => {
    state.mode = mode;
    markTab("modeTabs", "mode", mode);
    renderGallery();
  });

  // a select that only changes what is drawn is bound by the state field it writes and what it repaints
  const selects = {
    blockSort: ["blockSort", () => renderSidebar(el("search").value)],
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

  const modal = el("modal");
  el("modalClose").addEventListener("click", () => modal.classList.add("hidden"));

  // dismiss only when the press starts and ends on the backdrop itself
  let pressedBackdrop = false;
  modal.addEventListener("mousedown", (event) => { pressedBackdrop = event.target === modal; });
  modal.addEventListener("click", (event) => {
    if (pressedBackdrop && event.target === modal) modal.classList.add("hidden");
    pressedBackdrop = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") modal.classList.add("hidden");

    // the search field is left in: typing a filter and stepping its results is one gesture
    const held = event.target.tagName === "SELECT" || !modal.classList.contains("hidden");
    if (held) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      stepList(event.key === "ArrowDown" ? 1 : -1);
    }
  });
}

async function init() {
  state.foldCards = localStorage.getItem(CARDS_KEY) !== "false";

  const manifest = await loadJson("data/collections.json");
  state.collections = manifest.collections;
  state.slug = state.collections[0].slug;

  state.bundle = await loadJson(`data/${state.slug}/index.json`);
  await Promise.all([loadManifold(), loadDominance(), loadBlockIndex()]);

  renderCollectionPicker();
  renderSidebar("");
  bindControls();

  // the site opens on the feature axis, which is the one that names what a feature carries
  await selectBlock(state.blocks.blocks[0].block_global_index);
}

init();
