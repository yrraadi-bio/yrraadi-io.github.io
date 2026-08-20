"""Read the feature set and manifold layout the pathway explorer already publishes."""

from pipeline.config import load_json

IDENTITY_FIELDS = ("block_global_index", "layer", "group_size", "block", "dictionary", "stable_rank", "n_tiles")


def published_features(interp_root):

    """Load the feature set the causal explorer reuses unchanged.

    Args:
        interp_root (Path): Root of the pathway explorer site.

    Returns:
        dict: Block global index to feature identity fields.
    """

    index = load_json(interp_root / "data" / "blocks" / "index.json")

    return {entry["block_global_index"]: {field: entry[field] for field in IDENTITY_FIELDS} for entry in index["blocks"]}


def manifold_features(interp_root):

    """List the features carrying a cross-feature map position.

    Args:
        interp_root (Path): Root of the pathway explorer site.

    Returns:
        list: Block global indices in cross-feature map row order.
    """

    return load_json(interp_root / "data" / "manifold" / "blocks.json")["block_global_index"]
