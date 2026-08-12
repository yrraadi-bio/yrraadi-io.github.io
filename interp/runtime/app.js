import {
  CARD_LIMIT,
  CARDS_KEY,
  GENE_STOPS,
  SIDEBAR_DEFAULT,
  SIDEBAR_KEY,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  bindTabs,
  blockLabel,
  blockNumber,
  controls,
  el,
  loadImage,
  loadJson,
  markTab,
  resetAssetCaches,
  signed,
  state,
} from "./core.js";
import { COPY } from "./copy.js?v=20260811c";
import {
  loadBlockManifold,
  loadManifold,
  loadPathwayCoords,
  loadTilePathway,
  renderBlockManifold,
  renderCrossBlockMap,
  resizeManifold,
} from "./manifold.js?v=20260811c";
import { loadPathway } from "./pathway-data.js";

const BLOCK_ORDER = {
  valid: (block) => (validBlock(block.block_global_index) ? -2 : 0) - Math.abs(block.best_effect),
  effect: (block) => -Math.abs(block.best_effect),
  layer: (block) => block.layer * 1000 + block.block,
};

let request = 0;

// KEGG Level A is visible while Level B remains searchable.
function briteCategory(pathwayId) {
  const entry = state.brite[pathwayId];
  if (!entry) return "";

  return entry.category;
}

function pathwayCategory(pathwayId) {
  return briteCategory(pathwayId) || state.bundle.collection_label || "";
}

function briteSearchLabel(pathwayId) {
  const entry = state.brite[pathwayId];
  if (!entry) return "";

  return `${entry.category} ${entry.class}`;
}

function blockEntry(globalIndex) {
  return state.blocks.blocks.find((block) => block.block_global_index === globalIndex);
}

function dominantSets(globalIndex) {
  return state.dominance[globalIndex] || [];
}

function validBlock(globalIndex) {
  return dominantSets(globalIndex).length > 0;
}

function isDominant(globalIndex, slug, pathwayId) {
  return dominantSets(globalIndex).some((pick) => pick.slug === slug && pick.pathway_id === pathwayId);
}

function blockHaystack(block) {
  const sets = block.pathways.map((entry) => `${entry.name} ${entry.pathway_id} ${briteSearchLabel(entry.pathway_id)}`).join(" ");

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
    hay: `${pathway.name} ${pathway.pathway_id} ${briteSearchLabel(pathway.pathway_id)}`.toLowerCase(),
    mark: "",
    name: pathway.name,
    sub: [pathway.pathway_id, pathwayCategory(pathway.pathway_id)].filter(Boolean).join(" · "),
    count: `${pathway.n_supported_blocks} ft`,
    active: state.pathway === index,
    select: () => selectPathway(index),
  }));
}

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

async function selectPathway(index) {
  state.blockPick = null;

  await showPathway(index, () => 0);
}

// Paint everything attached to one pathway document.
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

  state.detail = await loadPathway(state.slug, entry.pathway_id).catch((error) => error);
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

  await Promise.all([
    loadPathwayCoords(entry.pathway_id),
    loadTilePathway(entry.pathway_id),
    loadBlockManifold(),
  ]);
  if (token === request) renderManifold();
}

async function selectBlock(globalIndex) {
  state.blockPick = globalIndex;

  const sets = blockEntry(globalIndex).pathways;
  const current = state.pathway === null ? null : state.bundle.pathways[state.pathway].pathway_id;

  // Keep the set already on screen when the selected block carries it.
  await showAssociation(sets.find((entry) => entry.pathway_id === current) || sets[0]);
}

async function showAssociation(entry) {
  if (entry.slug !== state.slug) await useCollection(entry.slug);

  const index = state.bundle.pathways.findIndex((pathway) => pathway.pathway_id === entry.pathway_id);

  await showPathway(index, (document) => {
    const at = document.blocks.findIndex((block) => block.block_global_index === state.blockPick);

    return at < 0 ? 0 : at;
  });
}

function renderHeader(entry) {
  const name = el("pathwayName");
  const lead = el("metaLead");
  const summary = el("supportedCount");
  const group = state.browse === "block" ? "" : pathwayCategory(entry.pathway_id);

  el("groupLead").classList.toggle("hidden", !group);
  el("pathwayGroup").textContent = group;

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

function renderCollectionPicker() {
  const picker = el("collectionSelect");
  picker.innerHTML = "";
  el("collectionWrap").classList.toggle("hidden", state.collections.length < 2);

  state.collections.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.slug;
    option.textContent = `${entry.collection_label} · ${entry.n_pathways} sets`;
    picker.appendChild(option);
  });

  picker.value = state.slug;
}

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

  // Gene sets do not carry across collections.
  state.gene = keptGene;
  const same = state.bundle.pathways.findIndex((entry) => entry.pathway_id === keptPathway);
  if (state.bundle.pathways.length) selectPathway(same >= 0 ? same : 0);
}

async function loadDominance() {
  const payload = await loadJson("data/blocks/dominance.json");

  state.dominance = payload.blocks;
  el("blockInfo").innerHTML = COPY.blocks.panel(payload);
}

async function loadBrite() {
  state.brite = await loadJson("data/kegg/brite.json");
}

async function loadBlockIndex() {
  state.blocks = await loadJson("data/blocks/index.json");
  el("setInfo").innerHTML = COPY.byBlock.panel(state.blocks);
}

async function loadInitialData() {
  const manifest = await loadJson("data/collections.json");
  state.collections = manifest.collections;
  state.slug = state.collections[0].slug;
  state.bundle = await loadJson(`data/${state.slug}/index.json`);

  await Promise.all([loadManifold(), loadDominance(), loadBlockIndex(), loadBrite()]);
}

async function reloadAssets() {
  const button = el("reload");
  button.disabled = true;
  resetAssetCaches();

  const keptPathway = state.pathway === null ? null : state.bundle.pathways[state.pathway].pathway_id;
  const keptBlock = state.blockPick;

  state.collections = (await loadJson("data/collections.json")).collections;
  if (!state.collections.some((entry) => entry.slug === state.slug)) state.slug = state.collections[0].slug;

  state.bundle = await loadJson(`data/${state.slug}/index.json`);
  await Promise.all([loadManifold(), loadDominance(), loadBrite()]);
  if (state.blocks) await loadBlockIndex();

  renderCollectionPicker();
  renderSidebar(el("search").value);
  await reselect(keptPathway, keptBlock);

  button.disabled = false;
}

async function reselect(pathwayId, globalIndex) {
  if (state.browse === "block") {
    return selectBlock(blockEntry(globalIndex) ? globalIndex : state.blocks.blocks[0].block_global_index);
  }

  if (!state.bundle.pathways.length) return;

  const at = state.bundle.pathways.findIndex((entry) => entry.pathway_id === pathwayId);

  return selectPathway(at < 0 ? 0 : at);
}

async function selectBrowse(browse) {
  if (browse === state.browse) return;

  state.browse = browse;
  markTab("browseTabs", "browse", browse);
  el("collectionSelect").classList.toggle("hidden", browse === "block");
  el("blockSort").classList.toggle("hidden", browse !== "block");
  el("search").placeholder = browse === "block"
    ? "Search feature number or gene set…" : "Search pathway name or id…";

  if (browse === "block" && !state.blocks) await loadBlockIndex();

  renderSidebar(el("search").value);

  if (browse === "block") return selectBlock(carriedBlock());

  return selectPathway(state.pathway === null ? 0 : state.pathway);
}

function carriedBlock() {
  const selected = state.detail && state.detail.blocks[state.blockIndex];
  if (selected && blockEntry(selected.block_global_index)) return selected.block_global_index;

  return state.blocks.blocks[0].block_global_index;
}

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

// A gene selection cannot outlive the card that supplied it.
function keepGeneIfScored() {
  if (state.gene && !geneCards().some((gene) => gene.symbol === state.gene)) {
    state.gene = null;
    state.manifoldView = "pathway";
  }
}

function geneCards() {
  if (state.browse === "block") return blockEntry(state.blockPick).genes;

  return state.detail.genes;
}

async function pickGene(gene) {
  if (state.browse === "pathway") {
    state.gene = state.gene === gene.symbol ? null : gene.symbol;
    state.manifoldView = state.gene ? "gene" : "pathway";

    if (state.gene) {
      state.mode = "score";
      markTab("modeTabs", "mode", "score");
    }

    renderGenes();
    renderGallery();
    renderManifold();
    return;
  }

  const scored = state.detail.blocks[state.blockIndex].genes.some((entry) => entry.symbol === gene.symbol);

  // Bring forward the pooled gene's source set when needed.
  if (!scored) {
    state.gene = gene.symbol;
    state.manifoldView = "gene";

    await showAssociation(blockEntry(state.blockPick).pathways.find((entry) => entry.pathway_id === gene.pathway_id));
    return;
  }

  state.gene = state.gene === gene.symbol ? null : gene.symbol;
  state.manifoldView = state.gene ? "gene" : "pathway";

  renderGenes();
  renderGallery();
  renderManifold();
}

function renderGenes() {
  const block = state.detail.blocks[state.blockIndex];
  const holder = el("geneList");
  const genes = geneCards();
  const byPathway = state.browse === "pathway";
  holder.innerHTML = "";
  el("geneSection").classList.toggle("hidden", genes.length === 0);
  el("geneSectionTitle").textContent = byPathway ? COPY.genes.pathwayHeading : COPY.genes.featureHeading;
  el("geneInfoText").textContent = byPathway ? COPY.genes.pathwayInfo : COPY.genes.featureInfo;

  const strongest = Math.max(0, ...genes.map((gene) => byPathway ? gene.detection : gene.clustering));
  const sets = byPathway ? [] : blockEntry(state.blockPick).pathways;

  genes.forEach((gene) => {
    const source = sets.find((entry) => entry.pathway_id === gene.pathway_id);
    const chip = document.createElement("div");
    const strength = byPathway ? gene.detection : gene.clustering;
    const first = byPathway ? `${Math.round(gene.detection * 100)}%` : `I ${gene.clustering.toFixed(2)}`;
    const second = byPathway ? `r ${signed(gene.pathway_r, 2)}` : `r ${signed(gene.activation_r, 2)}`;
    const firstTitle = byPathway ? COPY.genes.pathwayDetectionLabel : COPY.genes.clusteringLabel;
    const secondTitle = byPathway ? COPY.genes.pathwayCorrelationLabel : COPY.genes.activationLabel;
    chip.className = `gene-chip${gene.train_slides < 46 ? " partial" : ""}${state.gene === gene.symbol ? " active" : ""}`;
    chip.title = (byPathway ? COPY.genes.pathwayTitle(gene, state.detail.name) : COPY.genes.featureTitle(gene, blockLabel(block)))
      + (source ? COPY.genes.viaSet(source.name) : "");
    chip.innerHTML = `
      <div class="sym">${gene.symbol}</div>
      <div class="grow">
        <span class="lvl" title="${firstTitle}">${first}</span>
        <span class="lvl" title="${secondTitle}">${second}</span>
      </div>
      <div class="meter"><span style="width:${strongest > 0 ? (strength / strongest) * 100 : 0}%"></span></div>`;
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

function renderCards() {
  const byBlock = state.browse === "block";

  el("blocksSection").classList.toggle("hidden", byBlock);
  el("setsSection").classList.toggle("hidden", !byBlock);
  renderBasicCorrelation();

  if (byBlock) return renderSets();

  return renderBlocks();
}

function effectRows(entry) {
  return `<table>
      <tr title="${COPY.blocks.heldoutR}"><td>held-out r</td><td class="val">${entry.heldout_effect.toFixed(3)}</td></tr>
      <tr title="${COPY.blocks.trainR}"><td>training r</td><td class="val">${entry.train_effect.toFixed(3)}</td></tr>
      <tr title="${COPY.blocks.deltaR2}"><td>&Delta;R&sup2; held-out</td><td class="val">${entry.delta_r2.toFixed(4)}</td></tr>
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
  const strongest = Math.max(...entries.map((entry) => Math.abs(entry.heldout_effect)), 0);
  const rows = entries.map((entry, index) => [entry, describe(entry, index)]);
  const { listed, folded } = cardCuts(rows);
  holder.innerHTML = "";

  (state.foldCards ? folded : listed).forEach(([entry, shown]) => {
    const card = document.createElement("div");
    card.className = `block-card${shown.extra}${shown.picked ? "" : " dull"}${shown.active ? " active" : ""}`;
    card.title = `${shown.title ? `${shown.title} · ` : ""}${COPY.blocks.mark(shown.picked)}`;
    card.innerHTML = `
      <div class="bhead">
        <span class="bid">${shown.head}</span>
        ${shown.tag ? `<span class="tag">${shown.tag}</span>` : ""}
      </div>
      ${shown.sub ? `<div class="bsub">${shown.sub}</div>` : ""}
      ${effectRows(entry)}
      <div class="bar"><span style="width:${strongest > 0 ? (Math.abs(entry.heldout_effect) / strongest) * 100 : 0}%"></span></div>`;
    card.addEventListener("click", shown.select);
    holder.appendChild(card);
  });

  markToggle(toggle, listed.length - folded.length);
}

function markToggle(id, hidden) {
  const button = el(id);

  button.classList.toggle("hidden", hidden === 0);
  button.textContent = COPY.blocks.foldToggle(state.foldCards, hidden);
  button.title = COPY.blocks.foldTitle(CARD_LIMIT);
  button.setAttribute("aria-pressed", String(state.foldCards));
}

function toggleCards() {
  state.foldCards = !state.foldCards;
  localStorage.setItem(CARDS_KEY, String(state.foldCards));
  renderCards();
}

function renderSets() {
  const block = blockEntry(state.blockPick);
  const current = state.bundle.pathways[state.pathway].pathway_id;

  fillCards(el("setList"), "setMore", block.pathways, (entry) => ({
    picked: isDominant(block.block_global_index, entry.slug, entry.pathway_id),
    extra: " set-card",
    active: entry.pathway_id === current,
    title: COPY.byBlock.setTitle(entry),
    head: entry.name,
    sub: "",
    tag: briteCategory(entry.pathway_id) || entry.collection_label,
    select: () => showAssociation(entry),
  }));
}

function renderBlocks() {
  fillCards(el("blockList"), "blockMore", state.detail.blocks, (block, index) => ({
    picked: isDominant(block.block_global_index, state.slug, state.detail.pathway_id),
    extra: "",
    active: state.blockIndex === index,
    title: "",
    head: `#${blockNumber(block.layer, block.block)}`,
    sub: "",
    tag: "",
    select: () => pickBlockCard(index),
  }));
}

async function pickBlockCard(index) {
  state.blockIndex = index;
  keepGeneIfScored();
  renderCards();
  renderGenes();
  renderGallery();

  await loadBlockManifold();
  renderManifold();
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
  const grid = state.bundle.patch_grid;

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

      // Ring gene-covered patches so the block layer stays readable.
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

function activeTiles() {
  const pathway = state.detail;
  const block = pathway.blocks[state.blockIndex];

  if (state.mode === "score") {
    // Score order stays fixed while the overlay follows the selected block.
    const key = String(block.block_global_index);
    const tiles = pathway.score_tiles.map((tile) => Object.assign({}, tile, tile.by_block[key]));

    return { tiles: tiles, block: block };
  }

  return { tiles: block.tiles, block: block };
}

function tileScore(tile) {
  return tile.pathway_score === null || tile.pathway_score === undefined ? "n/a" : tile.pathway_score.toFixed(3);
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

  if (!state.gene) {
    holder.classList.add("hidden");
    return;
  }

  holder.classList.remove("hidden");
  el("geneScaleName").textContent = state.gene;
  setScaleTicks("geneScale", "0", controls().normalize === "tile" ? "tile peak" : geneMax.toFixed(1));
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

  const maxValue = Math.max(...tiles.map((tile) => tile.max_patch));
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
  el("modalStats").innerHTML = COPY.modal.stats(block, tile, tileScore(tile), state.bundle.tokens_per_tile, top);

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

function syncRecipe() {
  const cross = state.manifoldView === "cross";
  el("recipeCross").classList.toggle("hidden", !cross);
  el("recipeTile").classList.toggle("hidden", cross);
}

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
  el("manifoldFrame").classList.toggle("paired", !cross);
  syncRecipe();

  if (cross) return renderCrossBlockMap();

  return renderBlockManifold(geneAvailable);
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
  let last = window.scrollY;

  const update = () => {
    const at = window.scrollY;
    const moved = at - last;

    dock.classList.toggle("lifted", at > 6);
    if (Math.abs(moved) > 6) dock.classList.toggle("gone", moved > 0 && at > 140);
    if (at <= 140) dock.classList.remove("gone");

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
  el("collectionSelect").addEventListener("change", (event) => selectCollection(event.target.value));
  el("sidebarToggle").addEventListener("click", toggleSidebar);
  el("reload").addEventListener("click", reloadAssets);
  ["blockMore", "setMore"].forEach((id) => el(id).addEventListener("click", toggleCards));

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
}

async function init() {
  state.foldCards = localStorage.getItem(CARDS_KEY) !== "false";

  await loadInitialData();
  renderCollectionPicker();
  renderSidebar("");
  bindControls();

  // Open on the feature axis.
  await selectBlock(state.blocks.blocks[0].block_global_index);
}

if (typeof document !== "undefined") init();
