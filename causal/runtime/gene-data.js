import { loadGzipJson, loadJson } from "./core.js";

const DOCUMENT_SCHEMA = 1;
const SHARED_SCHEMA = 1;

function activationRecord(shared, index, tile) {
  const source = shared.activations[index];
  if (source.tile !== tile) throw new Error(`shared activation ${index} does not match tile ${tile}`);

  const activation = { ...source };
  delete activation.tile;
  delete activation.block;

  return activation;
}

// A feature's tiles are its own, so the document only carries positions into the shared payload.
function expandFeature(document, shared) {
  if (document.schema_version !== DOCUMENT_SCHEMA) throw new Error(`unsupported feature schema ${document.schema_version}`);
  if (shared.schema_version !== SHARED_SCHEMA) throw new Error(`unsupported shared schema ${shared.schema_version}`);

  const tiles = document.tiles.map((reference) => ({
    ...shared.tiles[reference.tile],
    ...activationRecord(shared, reference.activation, reference.tile),
  }));
  const feature = { ...document };
  delete feature.schema_version;
  delete feature.shared;

  return { ...feature, tiles: tiles };
}

export async function loadFeature(globalIndex) {
  const document = await loadJson(`data/features/${globalIndex}.json`);
  const shared = await loadGzipJson(`data/${document.shared}`);

  return expandFeature(document, shared);
}

export async function loadGene(symbol) {
  return loadJson(`data/genes/${symbol}.json`);
}
