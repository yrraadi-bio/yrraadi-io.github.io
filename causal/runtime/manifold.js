import { GENE_STOPS, blockLabel, blockNumber, el, loadBulkJson, state, subset } from "./core.js";
import { COPY } from "./copy.js?v=20260819a";

const Plotly = globalThis.Plotly;

const MANIFOLD_PALETTE = ["#8FC0F0", "#F0A86A", "#7FD6A8", "#F08A7A", "#C4A2E8", "#E8CF7A", "#68C8CF", "#AAB8CC", "#C3D977", "#E3A6C8"];
const MISSING_COLOUR = "#324259";
const TISSUE_COLOURS = {
  Bowel: "#E0A061",
  Breast: "#EF8FA8",
  Lung: "#87BFE0",
  Pancreas: "#B79EE6",
  Skin: "#6FC9A3",
  Unknown: MISSING_COLOUR,
};
const MANIFOLD_PLOTS = ["manifoldMain", "manifoldSide"];

const AXIS_PAD = 0.04;
const LEGEND_WIDTH = 262;
const AXIS_FURNITURE = 120;
const TITLE_BAND = 70;
const PLOT_PAD = 4;
const RAMP_BAND = 54;
const PLOT_CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["resetCameraLastSave3d"] };

const CHROME = {
  ink: "#f2f6fb",
  muted: "rgba(224,235,248,0.62)",
  subtle: "rgba(200,218,240,0.58)",
  rule: "rgba(180,205,240,0.2)",
  grid: "rgba(180,205,240,0.12)",
  wall: "rgba(6,14,26,0.55)",
  panel: "rgba(9,19,35,0.92)",
};

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

function shorten(text, limit) {
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");

  return `${(boundary > limit * 0.6 ? cut.slice(0, boundary) : cut).replace(/[\s,;:]+$/, "")}…`;
}

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
  const tight = banded && gutter * holder.clientWidth < LEGEND_WIDTH;
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
    paper_bgcolor: "rgba(0,0,0,0)",
    font: { family: "Inter, system-ui, sans-serif", color: CHROME.muted },
    hoverlabel: { bgcolor: CHROME.panel, bordercolor: CHROME.rule, font: { family: "Inter, system-ui, sans-serif", size: 11.5, color: CHROME.ink } },
    modebar: { bgcolor: "rgba(0,0,0,0)", color: "rgba(200,218,240,0.4)", activecolor: "#7FB4FF" },
  };
}

function scaleFrom(stops) {
  return stops.map((stop, index) => [index / (stops.length - 1), `rgb(${stop[0]},${stop[1]},${stop[2]})`]);
}

// Lift the green ramp's dark end clear of the navy plot ground.
const EXPRESSION_SCALE = scaleFrom([[27, 94, 66], ...GENE_STOPS.slice(0, 4).reverse()]);

function robustRange(values) {
  const finite = values.filter((value) => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return [0, 1];

  const low = finite[Math.floor(finite.length * 0.02)];
  const high = finite[Math.floor(finite.length * 0.98)];

  return high > low ? [low, high] : [finite[0], finite[finite.length - 1] + 1];
}

function xyz(source, rows) {
  return { x: subset(source.x, rows), y: subset(source.y, rows), z: subset(source.z, rows) };
}

function markers(name, coords, hover, marker, options) {
  return Object.assign({ type: "scatter3d", mode: "markers", name: name, ...coords, text: hover,
                        hoverinfo: "text", marker: marker }, options || {});
}

function colourbar(title) {
  return { title: { text: title, side: "top", font: { size: 10.5, color: CHROME.muted } },
           orientation: "h", x: 0.5, xanchor: "center", y: 0, yanchor: "top", len: 0.52, thickness: 11,
           xpad: 4, ypad: 4,
           outlinecolor: CHROME.rule, outlinewidth: 1, tickfont: { size: 9.5, color: CHROME.subtle } };
}

function bindCameraMemory(id) {
  el(id).on("plotly_relayout", (event) => {
    if (event["scene.camera"]) state.manifoldCameras[id] = event["scene.camera"];
  });
}

async function paintManifold(id, traces, title, subtitle, legend, coords) {
  const holder = el(id);
  if (!holder.dataset.bound) holder.innerHTML = "";

  await Plotly.react(holder, traces, manifoldLayout(id, title, subtitle, legend, coords), PLOT_CONFIG);
  Plotly.Plots.resize(holder);

  if (!holder.dataset.bound) {
    bindCameraMemory(id);
    holder.dataset.bound = "1";
  }
}

function manifoldMessage(text) {
  MANIFOLD_PLOTS.forEach((id) => {
    const holder = el(id);
    Plotly.purge(holder);
    delete holder.dataset.bound;
    holder.innerHTML = id === "manifoldMain" ? `<p class="gallery-note" style="padding:16px">${text}</p>` : "";
  });

  el("manifoldNote").textContent = "";
}

export function resizeManifold() {
  requestAnimationFrame(() => {
    MANIFOLD_PLOTS.map((id) => el(id)).filter((plot) => plot && plot.data)
      .forEach((plot) => Plotly.Plots.resize(plot));
  });
}

export async function loadManifold() {
  const [blocks, tiles, index] = await Promise.all([
    loadBulkJson("data/manifold/blocks.json"),
    loadBulkJson("data/manifold/tiles.json"),
    loadBulkJson("data/manifold/block_manifolds_index.json"),
  ]);

  state.manifold = {
    blocks: blocks,
    tiles: tiles,
    exported: new Set(index.blocks.map((record) => record.key)),
    maxTiles: index.max_tiles,
  };
}

function blockManifoldKey(card) {
  const [layer, group] = card.dictionary.split(" ");

  return `${layer}_${group}_b${card.block}`;
}

export async function loadBlockManifold() {
  state.blockManifold = null;
  if (!state.manifold || !state.featureDoc) return;

  const key = blockManifoldKey(state.featureDoc);
  if (!state.manifold.exported.has(key)) return;

  const payload = await loadBulkJson(`data/manifold/block_manifolds/${key}.json`);
  if (blockManifoldKey(state.featureDoc) === key) state.blockManifold = payload;
}

export async function loadTileGene(symbol) {
  const payload = await loadBulkJson(`data/manifold/tile_genes/${symbol}.json`);

  state.tileGene = {
    symbol: payload.symbol,
    unmeasured: new Set(payload.unmeasured_slides || []),
    value: new Map(payload.rows.map((row, index) => [row, payload.values[index]])),
  };

  return state.tileGene;
}

export async function loadGeneCausal() {
  state.geneCausal = null;
  if (!state.gene) return;

  const payload = await loadBulkJson(`data/manifold/gene_causal/${state.gene}.json`).catch(() => null);
  if (payload && payload.symbol === state.gene) state.geneCausal = payload;
}

// The gallery reads a tile's expression straight off its own slide and row.
export function tileExpression(tile) {
  const gene = state.tileGene;
  if (!gene || gene.unmeasured.has(tile.slide_id)) return null;

  return gene.value.has(tile.row) ? gene.value.get(tile.row) : 0;
}

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

function tileValueTraces(positions, values, title, scale, missingLabel) {
  const payload = state.blockManifold;
  const known = positions.filter((index) => values[index] !== null && Number.isFinite(values[index]));
  const missing = positions.filter((index) => values[index] === null || !Number.isFinite(values[index]));
  const [low, high] = robustRange(known.map((index) => values[index]));
  const traces = [];

  if (missing.length) {
    traces.push(markers(`${missingLabel} (${missing.length.toLocaleString()})`, xyz(payload, missing),
                       tileHover(missing), { size: 2.2, color: MISSING_COLOUR }));
  }

  traces.push(markers(title, xyz(payload, known), tileHover(known), {
    size: 3.0,
    color: known.map((index) => values[index]),
    colorscale: scale,
    cmin: low,
    cmax: high,
    colorbar: colourbar(title),
  }, { showlegend: false }));

  return traces;
}

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
                  { size: 3.0, color: colour });
  });
}

function geneTileValues(positions) {
  const payload = state.blockManifold;
  const tiles = state.manifold.tiles;
  const gene = state.tileGene;
  const values = new Array(payload.tile_rows.length).fill(null);

  positions.forEach((index) => {
    const row = payload.tile_rows[index];

    // A slide whose panel lacks the gene stays grey.
    if (gene.unmeasured.has(tiles.slides[tiles.slide_code[row]])) return;
    values[index] = gene.value.has(row) ? gene.value.get(row) : 0;
  });

  return values;
}

export async function renderBlockManifold() {
  const note = el("manifoldNote");
  const payload = state.blockManifold;
  const label = blockLabel(state.featureDoc);

  if (!payload) {
    manifoldMessage(COPY.tile.missing(label, state.manifold.exported.size));
    return;
  }

  const positions = tileRows();
  const values = geneTileValues(positions);
  const missing = positions.filter((index) => values[index] === null).length;

  const traces = tileValueTraces(positions, values, `${state.gene} count`, EXPRESSION_SCALE, COPY.tile.gene.missing);
  const title = COPY.tile.gene.title(state.gene);
  const subtitle = COPY.tile.gene.subtitle(label);
  note.innerHTML = COPY.tile.gene.note(state.gene, label, missing);

  if (payload.n_tiles >= state.manifold.maxTiles) {
    note.innerHTML += COPY.tile.capped(state.manifold.maxTiles.toLocaleString());
  }

  await paintManifold("manifoldMain", traces, title, subtitle, true, payload);
  await paintTissue(positions, payload);
}

async function paintTissue(positions, payload) {
  const tiles = state.manifold.tiles;
  const present = new Set(positions.map((index) => tiles.tissues[tiles.tissue_code[payload.tile_rows[index]]]));
  const known = [...present].filter((tissue) => tissue !== "Unknown").length;

  await paintManifold("manifoldSide", tissueTraces(positions), COPY.tile.tissue.title,
                     COPY.tile.tissue.subtitle(known, tiles.slides.length), true, payload);
}

const HIGHLIGHT = "#FF5ECB";

let strongestByFeature = null;

function strongestGene(globalIndex) {
  if (!strongestByFeature) {
    strongestByFeature = new Map(state.blocks.blocks.map((block) => [block.block_global_index,
                                                                    block.genes.length ? block.genes[0].symbol : COPY.hover.strongestNone]));
  }

  return strongestByFeature.has(globalIndex) ? strongestByFeature.get(globalIndex) : COPY.hover.strongestNone;
}

function blockHover(indices) {
  const blocks = state.manifold.blocks;

  return indices.map((index) => COPY.hover.block(blockNumber(blocks.layer[index], blocks.block[index]),
                                                strongestGene(blocks.block_global_index[index])));
}

function manifoldRows() {
  return state.manifold.blocks.block_global_index.map((value, index) => index);
}

function selectedRow() {
  if (!state.manifold || state.feature === null) return -1;

  return state.manifold.blocks.block_global_index.indexOf(state.feature);
}

function selectedLabel() {
  const at = selectedRow();
  if (at < 0) return null;

  return `feature #${blockNumber(state.manifold.blocks.layer[at], state.manifold.blocks.block[at])}`;
}

function highlightTraces() {
  const blocks = state.manifold.blocks;
  const at = selectedRow();
  if (at < 0) return [];

  const label = selectedLabel();
  const spot = { x: [blocks.x[at]], y: [blocks.y[at]], z: [blocks.z[at]] };

  return [{
    type: "scatter3d",
    mode: "lines",
    x: [blocks.x[at], blocks.x[at]],
    y: [blocks.y[at], blocks.y[at]],
    z: [axisRange(blocks.z)[0], blocks.z[at]],
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
    colorbar: colourbar(title),
  }, { showlegend: false })];
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
    colorbar: colourbar("encoder layer"),
  }, { showlegend: false })];
}

export async function renderCrossBlockMap() {
  const note = el("manifoldNote");
  const blocks = state.manifold.blocks;
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
  } else if (state.geneCausal) {
    // Red sits at the positive end so the strongest decreases, the finding, read hottest.
    traces = continuousTrace(rows, state.geneCausal.values, `${state.gene} decrease`, "RdBu");
    title = COPY.cross.causal.title(state.gene);
    subtitle = COPY.cross.causal.subtitle(state.geneCausal.supported_blocks.length.toLocaleString());
    note.textContent = COPY.cross.causal.note(state.gene);
  } else {
    manifoldMessage(COPY.cross.causal.missing(state.gene || "this feature"));
    return;
  }

  note.innerHTML = COPY.cross.prefix + note.innerHTML;

  const marked = highlightTraces();
  const marker = selectedLabel();
  if (marker) {
    subtitle = `${subtitle} · ${COPY.cross.markedSubtitle(marker)}`;
    note.innerHTML += COPY.cross.marked(marker);
  } else {
    note.innerHTML += COPY.cross.unmarked(blockLabel(state.featureDoc), total);
  }

  await paintManifold("manifoldMain", traces.concat(marked), title, subtitle, legend || marked.length > 0);
}
