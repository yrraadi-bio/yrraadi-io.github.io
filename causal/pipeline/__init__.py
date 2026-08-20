"""Expose the command-line interface that builds the causal explorer data."""

import argparse
from pathlib import Path

from pipeline import assets, clustering, documents, encode, expression, manifold, shared
from pipeline.config import (DEFAULT_INTERP, DEFAULT_OUT, DEFAULT_RANKINGS, DEFAULT_RUN, DEFAULT_SOURCE,
                             DEFAULT_XENIUM)
from pipeline.evidence import leaders, load_rankings, ranked, showcased as showcase
from pipeline.site import manifold_features, published_features


def build(rankings_path, interp_root, source_root, run_root, xenium_root, out_root):

    """Build every causal document, index, and colouring.

    Args:
        rankings_path (Path): Per-gene ranking parquet from the causal block scan.
        interp_root (Path): Root of the pathway explorer site.
        source_root (Path): Gene/pathway analysis root holding the per-tile counts.
        run_root (Path): BSF run root holding the activation cache and encoders.
        xenium_root (Path): Directory of Xenium slide shards holding tile images and transcripts.
        out_root (Path): Causal site root receiving ``data``.

    Returns:
        None
    """

    data_root = out_root / "data"
    data_root.mkdir(parents=True, exist_ok=True)

    features = published_features(interp_root)
    frame = load_rankings(rankings_path)
    scoped = frame[frame["block_global_index"].isin(features)].reset_index(drop=True)
    print(f"{len(scoped):,} gene-feature pairs over {scoped['gene'].nunique()} genes and {len(features)} features")

    scan_slide = scoped["slide"].iloc[0]
    admitted = ranked(scoped)
    lead = leaders(scoped)
    selectable = sorted(set(admitted["gene"].unique()) | set(lead.values()))
    axis = expression.gene_axis(source_root)
    counts, measured, slides = expression.tile_counts(source_root)

    showcased = showcase(admitted, lead, documents.EXPORT_PER_TARGET)
    encoded, written = encode.build(interp_root, run_root, xenium_root, features, showcased, counts, axis,
                                    out_root / "tiles")
    print(f"{written:,} tiles encoded past the published pool, filling every carded gene's gallery")

    payload, tiles = shared.build(interp_root, set(features), set(scoped["gene"].unique()), scan_slide,
                                  showcased, counts, axis, encoded)
    shared_name = shared.write(data_root, payload)
    size = (data_root / shared_name).stat().st_size
    on_slide = sum(1 for tile in payload["tiles"] if tile["slide_id"] == scan_slide)
    print(f"shared payload: {len(payload['tiles']):,} tiles ({on_slide} from {scan_slide}),"
          f" {len(payload['activations']):,} activations, {size / 1024 / 1024:.1f} MB gzipped")

    written = expression.build(counts, measured, slides, axis, selectable, data_root / "manifold" / "tile_genes")
    print(f"{written} per-tile expression maps, one for every selectable gene")

    scored = clustering.score(interp_root, features, selectable, counts, axis, slides)
    print(f"Moran's I over {len(features)} feature manifolds"
          f" ({clustering.NEIGHBOURS} nearest neighbours) for {len(selectable)} genes")

    catalogue, index = documents.build(scoped, features, tiles, scored, shared_name, data_root)
    print(f"{catalogue['n_genes']} genes carded of {catalogue['n_scanned_genes']} scanned")
    print(f"{index['n_blocks']} features, {index['n_cards']:,} gene cards over"
          f" {index['n_carried']:,} admitted associations")

    written = manifold.build(frame, manifold_features(interp_root), set(selectable),
                             data_root / "manifold" / "gene_causal")
    print(f"{written} cross-feature colourings")

    count, size = assets.manifolds(interp_root, features, data_root / "manifold")
    print(f"{count} tile manifolds and indexes copied in, {size / 1024 / 1024:.1f} MB gzipped")

    count, size, original = assets.tiles(interp_root, payload, out_root / "tiles")
    print(f"{count:,} tile images copied in, {size / 1024 / 1024:.1f} MB losslessly optimised"
          f" from {original / 1024 / 1024:.1f} MB")


def parser():

    """Build the causal pipeline argument parser.

    Returns:
        argparse.ArgumentParser: Configured parser.
    """

    root = argparse.ArgumentParser(prog="python -m pipeline", description="Build Causal Explorer data")
    root.add_argument("--rankings", default=DEFAULT_RANKINGS, help="per-gene causal ranking parquet")
    root.add_argument("--interp", default=DEFAULT_INTERP, help="pathway explorer root supplying the feature set")
    root.add_argument("--source", default=DEFAULT_SOURCE, help="analysis root supplying per-tile gene counts")
    root.add_argument("--run", default=DEFAULT_RUN, help="BSF run root supplying activations and encoders")
    root.add_argument("--xenium", default=DEFAULT_XENIUM, help="Xenium shard root supplying tile images")
    root.add_argument("--out", default=DEFAULT_OUT, help="causal site root holding data/")

    return root


def main(argv=None):

    """Run the causal data build.

    Args:
        argv (list or None): Optional argument vector.

    Returns:
        None
    """

    args = parser().parse_args(argv)
    build(Path(args.rankings), Path(args.interp), Path(args.source), Path(args.run), Path(args.xenium), Path(args.out))

__all__ = ["main"]
