"""The one gene set each block's held-out evidence singles out, read from the analysis rather than from the site."""

import pandas as pd

# where an effect starts to count against a block's strongest one, and the margin that strongest one must win by
MIN_EFFECT = 0.1

# how many sets a block cards: past its strongest few the tail only repeats that the block is promiscuous
SETS_PER_BLOCK = 8


def supported_effects(roots, extra=()):

    """Read every association the analysis reproduced on held-out tissue, pooled over collections.

    A block is scored against every collection annotated on the same encoder run, so the set it
    points at has to be decided over all of them at once: a block whose strongest KEGG pathway beats
    its strongest Hallmark set has not singled out the Hallmark set.

    Args:
        roots (list): (key, Path) pairs naming each collection and its analysis root.
        extra (tuple): Further columns to carry, for callers that also draw these rows.

    Returns:
        pd.DataFrame: key, pathway_id, block_global_index, heldout_effect and ``extra`` of supported rows
    """

    frames = []

    for key, root in roots:
        frame = pd.read_parquet(root / "pathway_transfer_heldout.parquet",
                                columns=["block_global_index", "pathway_id", "heldout_effect", "supported", *extra])
        frame = frame[frame["supported"]].drop(columns=["supported"])
        frame["key"] = key
        frames.append(frame)

    return pd.concat(frames, ignore_index=True)


def ranked(effects):

    """Order the associations worth carding, strongest held-out effect first.

    Both builds cut a block's cards from this order, so there has to be one order rather than two: a
    stable sort keeps two effects that agree to the last digit in the order they were read, which is
    what makes the cut reproducible between them.

    Args:
        effects (pd.DataFrame): Supported rows from :func:`supported_effects`.

    Returns:
        pd.DataFrame: The rows above ``MIN_EFFECT``, largest |held-out r| first.
    """

    strong = effects[effects["heldout_effect"].abs() > MIN_EFFECT]

    return strong.assign(magnitude=strong["heldout_effect"].abs()).sort_values("magnitude", ascending=False, kind="stable")


def carded(effects, blocks):

    """Name every (set, block) pair the block-first view will show a card for.

    Both builds have to agree on this: the bundle exports these pairs and the block view lists them,
    and a pair one side knows about and the other does not is a card the reader cannot open.

    Args:
        effects (pd.DataFrame): Supported rows from :func:`supported_effects`.
        blocks (set): Block global indices that have a tile manifold and so appear in the view.

    Returns:
        dict: (key, pathway_id) -> set of block global indices carding that set
    """

    rows = ranked(effects)
    rows = rows[rows["block_global_index"].isin(blocks)]
    pairs = {}

    for global_index, group in rows.groupby("block_global_index", sort=False):
        for row in group.head(SETS_PER_BLOCK).itertuples(index=False):
            pairs.setdefault((row.key, row.pathway_id), set()).add(int(global_index))

    return pairs


def winners(effects):

    """Pick the set each block points at, or nothing where its evidence spreads across several.

    A block that tracks a dozen sets equally well has told us nothing about any of them, so its
    strongest association counts only when it stands clear of the block's other real ones: its
    |held-out r| must beat the mean of the others above ``MIN_EFFECT`` by a further ``MIN_EFFECT``.

    Args:
        effects (pd.DataFrame): Supported rows from :func:`supported_effects`.

    Returns:
        dict: block global index (int) -> (key, pathway_id)
    """

    ranked = effects.assign(magnitude=effects["heldout_effect"].abs()).sort_values("magnitude", ascending=False)
    picks = {}

    for global_index, group in ranked.groupby("block_global_index", sort=False):
        magnitudes = group["magnitude"].to_numpy()
        others = magnitudes[1:][magnitudes[1:] > MIN_EFFECT]

        if magnitudes[0] > MIN_EFFECT + (others.mean() if len(others) else 0.0):
            picks[int(global_index)] = (group.iloc[0]["key"], group.iloc[0]["pathway_id"])

    return picks
