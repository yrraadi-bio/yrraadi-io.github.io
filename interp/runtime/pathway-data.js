import { loadGzipJson, loadJson } from "./core.js";

const PATHWAY_SCHEMA = 2;
const SHARED_SCHEMA = 1;


function tileRecord(shared, index, symbols) {
  const source = shared.tiles[index];
  const geneValues = Object.fromEntries(symbols.filter((symbol) => symbol in source.gene_values)
    .map((symbol) => [symbol, source.gene_values[symbol]]));

  return { ...source, gene_values: geneValues };
}

function activationRecord(shared, index, tile, block) {
  const source = shared.activations[index];
  if (source.tile !== tile || source.block !== block) {
    throw new Error(`shared activation ${index} does not match tile ${tile} and feature ${block}`);
  }

  const activation = { ...source };
  delete activation.tile;
  delete activation.block;

  return activation;
}

function expandPathway(document, shared) {
  if (document.schema_version !== PATHWAY_SCHEMA) throw new Error(`unsupported pathway schema ${document.schema_version}`);
  if (shared.schema_version !== SHARED_SCHEMA) throw new Error(`unsupported shared schema ${shared.schema_version}`);

  const blocks = document.blocks.map((block) => {
    const symbols = block.genes.map((gene) => gene.symbol);
    const tiles = block.tiles.map((reference) => ({
      ...tileRecord(shared, reference.tile, symbols),
      pathway_score: reference.pathway_score,
      ...activationRecord(shared, reference.activation, reference.tile, block.block_global_index),
    }));

    return { ...block, tiles: tiles };
  });
  const symbols = document.genes.map((gene) => gene.symbol);
  const scoreTiles = document.score_tiles.map((reference) => {
    const byBlock = {};

    reference.activations.forEach((index) => {
      const source = shared.activations[index];
      byBlock[String(source.block)] = activationRecord(shared, index, reference.tile, source.block);
    });

    return {
      ...tileRecord(shared, reference.tile, symbols),
      pathway_score: reference.pathway_score,
      by_block: byBlock,
      n_blocks_firing: reference.n_blocks_firing,
    };
  });
  const pathway = { ...document };
  delete pathway.schema_version;
  delete pathway.shared;
  delete pathway.score_tiles;

  return { ...pathway, blocks: blocks, score_tiles: scoreTiles };
}

export async function loadPathway(slug, pathwayId) {
  const document = await loadJson(`data/${slug}/pathways/${pathwayId}.json`);
  if (!("schema_version" in document)) return document;

  const shared = await loadGzipJson(`data/${slug}/${document.shared}`);
  return expandPathway(document, shared);
}
