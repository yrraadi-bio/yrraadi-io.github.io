"""Build the gene documents, feature documents, and the indices that drive the sidebar."""

from collections import defaultdict
from datetime import datetime

from pipeline.config import (CARDS_PER_TARGET, ENCODER_NOTE, EXPRESSION_DOMAIN, LABEL, MIN_EFFECT, PATCH_GRID,
                             PROTOCOL, TOKENS_PER_TILE, write_json)
from pipeline.clustering import NEIGHBOURS, entry as clustering_entry
from pipeline.evidence import carded, effects, leaders, ranked, winners

DOCUMENT_SCHEMA = 1
EXPORT_PER_TARGET = 24


def gene_documents(rows, features, scored, shared_name, destination):

    """Write one document per gene holding its ranked features.

    Args:
        rows (pandas.DataFrame): Admitted rows from ``ranked``.
        features (dict): Block global index to feature identity fields.
        scored (dict): Clustering scores keyed by block global index then gene symbol.
        shared_name (str): File name of the shared payload.
        destination (Path): Directory receiving the gene documents.

    Returns:
        list: Gene index entries in descending order of strongest decrease.
    """

    destination.mkdir(parents=True, exist_ok=True)
    entries = []

    for symbol, group in rows.groupby("gene", sort=False):
        first = next(group.itertuples(index=False))
        cards = [dict(features[int(row.block_global_index)], **effects(row),
                      **clustering_entry(scored, int(row.block_global_index), symbol))
                 for row in group.head(EXPORT_PER_TARGET).itertuples(index=False)]

        write_json(destination / f"{symbol}.json", {
            "symbol": symbol,
            "gene_index": int(first.target_index),
            "schema_version": DOCUMENT_SCHEMA,
            "shared": shared_name,
            "n_supported_features": int(len(group)),
            "observed_activity_gap": round(float(first.observed_activity_gap), 4),
            "blocks": cards,
        })

        entries.append({
            "symbol": symbol,
            "gene_index": int(first.target_index),
            "n_supported_features": int(len(group)),
            "best_effect": cards[0]["causal_decrease"],
            "clustering": cards[0]["clustering"],
        })

    entries.sort(key=lambda entry: -entry["best_effect"])

    return entries


def feature_documents(rows, features, tiles, lead, scored, shared_name, destination):

    """Write one document per feature holding its ranked genes and tiles.

    Args:
        rows (pandas.DataFrame): Admitted rows from ``ranked``.
        features (dict): Block global index to feature identity fields.
        tiles (dict): Block global index to tile reference lists.
        lead (dict): Block global index to its strongest-scoring gene symbol.
        scored (dict): Clustering scores keyed by block global index then gene symbol.
        shared_name (str): File name of the shared payload.
        destination (Path): Directory receiving the feature documents.

    Returns:
        tuple: Block global index to ranked gene cards, and to its admitted gene count.
    """

    destination.mkdir(parents=True, exist_ok=True)
    by_feature = {index: [] for index in features}
    supported = defaultdict(int)

    for index, group in rows.groupby("block_global_index", sort=False):
        supported[int(index)] = int(len(group))
        by_feature[int(index)] = [dict(effects(row), symbol=row.gene, gene_index=int(row.target_index),
                                       **clustering_entry(scored, int(index), row.gene))
                                  for row in group.head(EXPORT_PER_TARGET).itertuples(index=False)]

    # A feature with no admitted gene still carries tiles and a manifold, so it keeps a document.
    for index, cards in by_feature.items():
        write_json(destination / f"{index}.json", dict(features[index], **{
            "schema_version": DOCUMENT_SCHEMA,
            "shared": shared_name,
            "n_supported_genes": supported[index],
            "lead_gene": cards[0]["symbol"] if cards else lead[index],
            "genes": cards,
            "tiles": tiles[index],
        }))

    return by_feature, supported


def feature_index(features, by_feature, supported, tiles, lead, built):

    """Build the feature-first index driving the sidebar.

    Args:
        features (dict): Block global index to feature identity fields.
        by_feature (dict): Block global index to ranked gene cards.
        supported (dict): Block global index to its admitted gene count.
        tiles (dict): Block global index to tile reference lists.
        lead (dict): Block global index to its strongest-scoring gene symbol.
        built (str): Build timestamp.

    Returns:
        dict: Feature-first index document.
    """

    blocks = []

    for index, identity in features.items():
        cards = by_feature[index]
        blocks.append(dict(identity, **{
            "best_effect": cards[0]["causal_decrease"] if cards else 0,
            "n_genes": supported[index],
            "n_cards": min(len(cards), CARDS_PER_TARGET),
            "n_tiles_shown": len(tiles[index]) if index in tiles else 0,
            "lead_gene": cards[0]["symbol"] if cards else lead[index],
            "genes": cards[:CARDS_PER_TARGET],
        }))

    blocks.sort(key=lambda block: -block["best_effect"])

    return {
        "built": built,
        "n_blocks": len(blocks),
        "n_carried": sum(block["n_genes"] for block in blocks),
        "n_cards": sum(block["n_cards"] for block in blocks),
        "min_effect": MIN_EFFECT,
        "genes_per_block": CARDS_PER_TARGET,
        "blocks": blocks,
    }


def dominance(rows, picks, cards_of, built, n_blocks):

    """Keep the dominance winners whose genes are carded on the feature.

    Args:
        rows (pandas.DataFrame): Admitted rows from ``ranked``.
        picks (dict): Block global index to winning gene symbols.
        cards_of (dict): Gene symbol to the feature indices carding it.
        built (str): Build timestamp.
        n_blocks (int): Number of published features.

    Returns:
        dict: Dominance document.
    """

    kept, uncarded = {}, 0

    for index, symbols in picks.items():
        drawn = [{"symbol": symbol} for symbol in symbols if symbol in cards_of and index in cards_of[symbol]]
        uncarded += len(symbols) - len(drawn)

        if drawn:
            kept[str(index)] = drawn

    return {
        "built": built,
        "margin": MIN_EFFECT,
        "n_blocks": n_blocks,
        "n_dominant": len(kept),
        "n_blocks_scored": int(rows["block_global_index"].nunique()),
        "n_margin": len(picks),
        "n_unlisted": len(picks) - len(kept),
        "n_lit": sum(len(symbols) for symbols in kept.values()),
        "n_uncarded": uncarded,
        "blocks": kept,
    }


def build(effects_frame, features, tiles, scored, shared_name, data_root):

    """Write every causal document and index.

    Args:
        effects_frame (pandas.DataFrame): Gene-feature rows from ``load_rankings``.
        features (dict): Block global index to feature identity fields.
        tiles (dict): Block global index to ordered tile references.
        scored (dict): Clustering scores keyed by block global index then gene symbol.
        shared_name (str): File name of the shared payload.
        data_root (Path): Causal site ``data`` directory.

    Returns:
        tuple: Gene index document and feature index document.
    """

    built = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    (data_root / "blocks").mkdir(parents=True, exist_ok=True)
    rows = ranked(effects_frame)
    lead = leaders(effects_frame)
    sample = next(effects_frame.itertuples(index=False))

    genes = gene_documents(rows, features, scored, shared_name, data_root / "genes")
    by_feature, supported = feature_documents(rows, features, tiles, lead, scored, shared_name, data_root / "features")
    index = feature_index(features, by_feature, supported, tiles, lead, built)

    catalogue = {
        "built": built,
        "label": LABEL,
        "encoder_note": ENCODER_NOTE,
        "protocol": PROTOCOL,
        "expression_domain": EXPRESSION_DOMAIN,
        "slide": sample.slide,
        "tissue": sample.tissue,
        "patch_grid": PATCH_GRID,
        "tokens_per_tile": TOKENS_PER_TILE,
        "min_effect": MIN_EFFECT,
        "features_per_gene": CARDS_PER_TARGET,
        "clustering_neighbours": NEIGHBOURS,
        "n_genes": len(genes),
        "n_scanned_genes": int(effects_frame["gene"].nunique()),
        "genes": genes,
    }

    write_json(data_root / "genes" / "index.json", catalogue)
    write_json(data_root / "blocks" / "index.json", index)
    write_json(data_root / "blocks" / "dominance.json",
               dominance(rows, winners(rows), carded(rows), built, len(features)))

    return catalogue, index
