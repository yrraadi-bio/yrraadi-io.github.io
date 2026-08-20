export const state = {
  genes: null,
  blocks: null,
  dominance: {},
  browse: "block",
  gene: null,
  feature: null,
  geneDoc: null,
  featureDoc: null,
  cardIndex: 0,
  blockSort: "valid",
  geneSort: "effect",
  foldCards: true,
  manifold: null,
  manifoldView: "tile",
  crossColour: "causal",
  manifoldCameras: {},
  blockManifold: null,
  geneCausal: null,
  tileGene: null,
};

export const CARDS_KEY = "causal.foldCards";
export const CARD_LIMIT = 8;
export const GALLERY_LIMIT = 12;
export const SIDEBAR_KEY = "causal.sidebarWidth";
export const SIDEBAR_DEFAULT = 288;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 620;
export const GENE_STOPS = [[237, 248, 233], [186, 228, 179], [116, 196, 118], [35, 139, 69], [0, 68, 27]];

// Every element the app touches is reached by id.
export function el(id) {
  return document.getElementById(id);
}

// Tab strips are the one place a group of elements is addressed at once.
export function tabs(id) {
  return [...document.querySelectorAll(`#${id} button`)];
}

export function markTab(strip, key, value) {
  tabs(strip).forEach((button) => button.classList.toggle("active", button.dataset[key] === value));
}

export function bindTabs(strip, key, choose) {
  tabs(strip).forEach((button) => button.addEventListener("click", () => choose(button.dataset[key])));
}

// One in-flight promise per URL keeps repeated selections from refetching.
const jsonCache = new Map();
const gzipJsonCache = new Map();
const imageCache = new Map();
let epoch = 0;

function bust(url) {
  return epoch ? `${url}${url.includes("?") ? "&" : "?"}v=${epoch}` : url;
}

export function loadJson(url) {
  const target = bust(url);
  if (jsonCache.has(target)) return jsonCache.get(target);

  // Stable data names must be revalidated so an old index cannot mix with new data.
  const promise = fetch(target, { cache: "no-cache" }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  jsonCache.set(target, promise);
  promise.catch(() => jsonCache.delete(target));

  return promise;
}

export function loadGzipJson(url) {
  const target = bust(url);
  if (gzipJsonCache.has(target)) return gzipJsonCache.get(target);

  const promise = fetch(target, { cache: "no-cache" }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!globalThis.DecompressionStream) throw new Error("gzip decompression is unavailable");

    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json();
  });
  gzipJsonCache.set(target, promise);
  promise.catch(() => gzipJsonCache.delete(target));

  return promise;
}

// Bulk assets nobody reads by hand are stored gzipped, so callers name the JSON they want.
export function loadBulkJson(url) {
  return loadGzipJson(`${url}.gz`);
}

export function loadImage(src) {
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

export function resetAssetCaches() {
  epoch = Date.now();
  jsonCache.clear();
  gzipJsonCache.clear();
  imageCache.clear();
}

// Read settings from the inputs so restored form state cannot desync.
export function controls() {
  return {
    fraction: parseFloat(el("fraction").value),
    normalize: el("normalize").value,
    opacity: parseFloat(el("opacity").value),
    grid: el("showGrid").checked,
  };
}

export function signed(value, digits = 3) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
}

export function decimals(value) {
  return Math.abs(value) >= 0.1 ? 3 : 4;
}

export function blockNumber(layer, block) {
  return `${layer}-${String(block).padStart(3, "0")}`;
}

export function blockLabel(block) {
  return `feature #${blockNumber(block.layer, block.block)}`;
}

export function subset(values, rows) {
  return rows.map((index) => values[index]);
}
