"""Select supported associations and derive the shared published-block plan."""

from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from pipeline.config import BLOCKS_PER_DICTIONARY, DEFAULT_PLAN_NAME, MIN_MANIFOLD_TILES, collection_roots, load_json, write_json

MIN_EFFECT = 0.1
SETS_PER_BLOCK = 8
PROPER_TOKENS = {"NOTCH": "Notch", "WNT": "Wnt", "HEDGEHOG": "Hedgehog", "P53": "p53", "DN": "down", "UP": "up"}
ACRONYM_TOKENS = {"AKT", "DNA", "JAK", "KRAS", "MTOR", "MYC", "NFKB", "TGF", "TNFA", "UV"}
PLAN_VERSION = 1


def supported_effects(roots, extra=()):

    """Pool held-out-supported associations across collections.

    Args:
        roots (list): ``(key, Path)`` collection roots.
        extra (tuple): Additional columns to carry.

    Returns:
        pandas.DataFrame: Supported association rows with collection keys.
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

    """Rank cardable associations by held-out effect magnitude.

    Args:
        effects (pandas.DataFrame): Supported association rows.

    Returns:
        pandas.DataFrame: Rows above ``MIN_EFFECT`` in stable magnitude order.
    """

    strong = effects[effects["heldout_effect"].abs() > MIN_EFFECT]

    return strong.assign(magnitude=strong["heldout_effect"].abs()).sort_values("magnitude", ascending=False, kind="stable")


def carded(effects, blocks):

    """Name every set-block pair shown by the block-first view.

    Args:
        effects (pandas.DataFrame): Supported association rows.
        blocks (set): Published block global indices.

    Returns:
        dict: ``(collection, pathway_id)`` to carded block indices.
    """

    rows = ranked(effects)
    rows = rows[rows["block_global_index"].isin(blocks)]
    pairs = {}

    for global_index, group in rows.groupby("block_global_index", sort=False):
        for row in group.head(SETS_PER_BLOCK).itertuples(index=False):
            pairs.setdefault((row.key, row.pathway_id), set()).add(int(global_index))

    return pairs


def winners(effects):

    """Pick associations that stand clear of each block's evidence tail.

    Args:
        effects (pandas.DataFrame): Supported association rows.

    Returns:
        dict: Block global index to ranked ``(collection, pathway_id)`` winners.
    """

    picks = {}

    for global_index, group in ranked(effects).groupby("block_global_index", sort=False):
        magnitudes = group["magnitude"].to_numpy()
        margin = MIN_EFFECT + (magnitudes[1:].mean() if len(magnitudes) > 1 else 0.0)
        clear = group[group["magnitude"] > margin]

        if len(clear):
            picks[int(global_index)] = [(row.key, row.pathway_id) for row in clear.itertuples(index=False)]

    return picks


def load_blocks_index(root, profile):

    """Load the combined block status table or its task shards.

    Args:
        root (Path): Gene/pathway analysis output root.
        profile (dict): Model profile.

    Returns:
        pandas.DataFrame: Canonical block status table.
    """

    combined = root / "all_blocks_status.parquet"
    if combined.is_file():
        return pd.read_parquet(combined)

    frames = []
    for task_index in range(len(profile["dictionaries"])):
        frame = pd.read_parquet(root / "block_status" / f"task_{task_index:02d}.parquet")
        frame["block_global_index"] = task_index * BLOCKS_PER_DICTIONARY + frame["block"].to_numpy()
        frames.append(frame)

    return pd.concat(frames, ignore_index=True)


def sentence_case(name):

    """Lower an all-capitals set name while retaining symbols.

    Args:
        name (str): Collection display name.

    Returns:
        str: Sentence-cased display name.
    """

    if name != name.upper():
        return name

    tokens = name.split()
    words = []
    for token in tokens:
        if token in PROPER_TOKENS:
            words.append(PROPER_TOKENS[token])
        elif token in ACRONYM_TOKENS or any(character.isdigit() for character in token):
            words.append(token)
        else:
            words.append(token.lower())

    if tokens[0] not in PROPER_TOKENS and words[0] != tokens[0]:
        words[0] = words[0].capitalize()

    return " ".join(words)


def load_pathway_names(root, suffix=""):

    """Map frozen set identifiers to display names.

    Args:
        root (Path): Gene/pathway analysis output root.
        suffix (str): Collection suffix to strip.

    Returns:
        dict: Set identifier to display name.
    """

    sets = load_json(root / "expanded_kegg_gene_sets.json")

    return {key: sentence_case(value["name"].replace(suffix, "") if suffix else value["name"]) for key, value in sets.items()}


def card_requirements(profile, collection, blocks):

    """Map one collection's sets to their required published cards.

    Args:
        profile (dict): Model profile.
        collection (str): Collection name.
        blocks (set): Published block global indices.

    Returns:
        defaultdict: Pathway identifier to required block indices.
    """

    pairs = carded(supported_effects(collection_roots(profile)), blocks)
    wanted = defaultdict(set)

    for (key, pathway), indices in pairs.items():
        if key == collection:
            wanted[pathway].update(indices)

    return wanted


def required_blocks(profile, collection, data_root):

    """Read legacy manifold eligibility and derive required cards.

    Args:
        profile (dict): Model profile.
        collection (str): Collection name.
        data_root (Path): Site ``data`` directory.

    Returns:
        defaultdict: Pathway identifier to required block indices.
    """

    index = load_json(data_root / "manifold" / "block_manifolds_index.json")
    blocks = {entry["block_global_index"] for entry in index["blocks"]}

    return card_requirements(profile, collection, blocks)


def select_pathways(root, n_pathways, n_blocks, required):

    """Select pathways and their strongest supported block cards.

    Args:
        root (Path): Gene/pathway analysis output root.
        n_pathways (int): Number of evidence-ranked pathways.
        n_blocks (int): Number of strongest blocks per pathway.
        required (dict): Pathway identifier to additional required blocks.

    Returns:
        tuple: Ordered pathway ids, block rows by pathway, and supported counts.
    """

    columns = ["block_global_index", "pathway_id", "train_effect", "heldout_effect", "delta_r2",
               "supported", "ci_low", "ci_high", "same_direction", "evidence_provenance"]
    transfer = pd.read_parquet(root / "pathway_transfer_heldout.parquet", columns=columns)

    supported = transfer[transfer["supported"]].copy()
    supported["abs_heldout"] = supported["heldout_effect"].abs()

    counts = supported.groupby("pathway_id").size().sort_values(ascending=False)
    top = counts.head(n_pathways).index
    ordered = top.tolist() + sorted(set(required) - set(top))

    per_pathway = {}
    for pathway in ordered:
        rows = supported[supported["pathway_id"] == pathway].sort_values("abs_heldout", ascending=False)
        kept = pd.concat([rows.head(n_blocks), rows[rows["block_global_index"].isin(required[pathway])]])
        per_pathway[pathway] = kept[~kept.index.duplicated()].sort_values("abs_heldout", ascending=False).reset_index(drop=True)

    return ordered, per_pathway, counts


def candidate_blocks(roots, n_pathways, n_blocks):

    """Collect blocks selected independently by every sibling collection.

    Args:
        roots (list): ``(collection, analysis root Path)`` pairs.
        n_pathways (int): Evidence-ranked pathways per collection.
        n_blocks (int): Strongest blocks per pathway.

    Returns:
        set: Candidate block global indices.
    """

    candidates = set()

    for _, root in roots:
        _, per_pathway, _ = select_pathways(root, n_pathways, n_blocks, defaultdict(set))
        for rows in per_pathway.values():
            candidates.update(int(value) for value in rows["block_global_index"])

    return candidates


def firing_counts(root, profile, candidates):

    """Count firing tiles with the manifold exporter's coordinate rule.

    Args:
        root (Path): Analysis root carrying encoder activity.
        profile (dict): Model profile.
        candidates (set): Candidate block global indices.

    Returns:
        dict: Block global index to firing tile count.
    """

    by_task = defaultdict(list)
    for global_index in candidates:
        by_task[int(global_index) // BLOCKS_PER_DICTIONARY].append(int(global_index))

    counts = {}
    for task_index, indices in sorted(by_task.items()):
        group_size = profile["dictionaries"][task_index][1]
        frame = pd.read_parquet(root / "tile_block_activity" / f"task_{task_index:02d}.parquet", columns=["signed_coordinate_mean"])
        local_blocks = np.asarray([global_index % BLOCKS_PER_DICTIONARY for global_index in indices], dtype=np.int64)
        live = np.zeros(len(indices), dtype=np.int64)

        for values in frame["signed_coordinate_mean"]:
            # shape: [512, group_size]
            coordinates = np.asarray(values).reshape(BLOCKS_PER_DICTIONARY, group_size)
            live += np.abs(coordinates[local_blocks]).sum(axis=1) > 0

        for global_index, n_tiles in zip(indices, live):
            counts[global_index] = int(n_tiles)

    return counts


def plan_document(profile, roots, run_root, n_pathways, n_blocks, candidates, basis):

    """Build a plan document from candidate block indices.

    Args:
        profile (dict): Model profile.
        roots (list): ``(collection, analysis root Path)`` pairs.
        run_root (Path): Encoder run root.
        n_pathways (int): Evidence-ranked pathways per collection.
        n_blocks (int): Strongest blocks per pathway.
        candidates (set): Candidate block global indices.
        basis (str): Candidate selection provenance.

    Returns:
        dict: Published-block plan.
    """

    counts = firing_counts(roots[0][1], profile, candidates)
    blocks = []

    for global_index in sorted(candidates):
        n_tiles = counts[global_index]
        if n_tiles < MIN_MANIFOLD_TILES:
            continue

        task_index = global_index // BLOCKS_PER_DICTIONARY
        layer, group_size = profile["dictionaries"][task_index]
        blocks.append({
            "block_global_index": global_index,
            "layer": int(layer),
            "group_size": int(group_size),
            "block": global_index % BLOCKS_PER_DICTIONARY,
            "n_firing_tiles": n_tiles,
        })

    return {
        "version": PLAN_VERSION,
        "basis": basis,
        "run_root": str(run_root),
        "dictionaries": [{"layer": int(layer), "group_size": int(group_size)} for layer, group_size in profile["dictionaries"]],
        "source_roots": {collection: str(root) for collection, root in roots},
        "n_pathways": n_pathways,
        "n_blocks": n_blocks,
        "min_firing_tiles": MIN_MANIFOLD_TILES,
        "blocks": blocks,
    }


def derive_plan(profile, roots, run_root, n_pathways, n_blocks):

    """Derive the compact block plan shared by all collection bundles.

    Args:
        profile (dict): Model profile.
        roots (list): ``(collection, analysis root Path)`` pairs.
        run_root (Path): Encoder run root.
        n_pathways (int): Evidence-ranked pathways per collection.
        n_blocks (int): Strongest blocks per pathway.

    Returns:
        dict: Validated published-block plan.
    """

    candidates = candidate_blocks(roots, n_pathways, n_blocks)

    return plan_document(profile, roots, run_root, n_pathways, n_blocks, candidates, "analysis_selection")


def published_candidates(data_root):

    """Collect block cards from existing published collection bundles.

    Args:
        data_root (Path): Site ``data`` directory.

    Returns:
        set: Published block global indices.
    """

    candidates = set()

    for path in sorted(data_root.glob("*/pathways/*.json")):
        document = load_json(path)
        candidates.update(int(block["block_global_index"]) for block in document["blocks"])

    return candidates


def manifold_candidates(data_root):

    """Read the active manifold set for one-time plan bootstrapping.

    Args:
        data_root (Path): Site ``data`` directory.

    Returns:
        set: Existing manifold block global indices.
    """

    path = data_root / "manifold" / "block_manifolds_index.json"
    if not path.is_file():
        return set()

    return {int(entry["block_global_index"]) for entry in load_json(path)["blocks"]}


def validate_plan(plan, profile, roots, run_root, n_pathways, n_blocks):

    """Reject a stale or encoder-incompatible block plan.

    Args:
        plan (dict): Published-block plan.
        profile (dict): Model profile.
        roots (list): ``(collection, analysis root Path)`` pairs.
        run_root (Path): Encoder run root.
        n_pathways (int): Requested pathway limit.
        n_blocks (int): Requested per-pathway block limit.

    Returns:
        dict: The validated plan.
    """

    expected_dictionaries = [{"layer": int(layer), "group_size": int(group_size)} for layer, group_size in profile["dictionaries"]]
    expected_roots = {collection: str(root) for collection, root in roots}

    if plan["version"] != PLAN_VERSION:
        raise ValueError(f"block plan version {plan['version']} does not match {PLAN_VERSION}")
    if plan["run_root"] != str(run_root):
        raise ValueError(f"block plan run root {plan['run_root']} does not match {run_root}")
    if plan["dictionaries"] != expected_dictionaries:
        raise ValueError("block plan dictionaries do not match the selected model profile")
    if plan["source_roots"] != expected_roots:
        raise ValueError("block plan collection roots do not match this build")
    if plan["n_pathways"] != n_pathways or plan["n_blocks"] != n_blocks:
        raise ValueError("block plan selection limits do not match this build; use --refresh-plan to replace it")
    if plan["min_firing_tiles"] != MIN_MANIFOLD_TILES:
        raise ValueError("block plan manifold eligibility threshold does not match this pipeline")

    return plan


def load_or_create_plan(path, profile, roots, run_root, n_pathways, n_blocks, data_root, refresh=False):

    """Load a compatible plan or derive and write one.

    Args:
        path (Path): Plan JSON path.
        profile (dict): Model profile.
        roots (list): ``(collection, analysis root Path)`` pairs.
        run_root (Path): Encoder run root.
        n_pathways (int): Evidence-ranked pathways per collection.
        n_blocks (int): Strongest blocks per pathway.
        data_root (Path): Site data root with optional published bundles.
        refresh (bool): Whether to replace an existing plan.

    Returns:
        dict: Published-block plan.
    """

    if path.is_file() and not refresh:
        return validate_plan(load_json(path), profile, roots, run_root, n_pathways, n_blocks)

    candidates = manifold_candidates(data_root) if not refresh else set()
    basis = "manifold_bootstrap"

    if not candidates and not refresh:
        candidates = published_candidates(data_root)
        basis = "published_bundles"

    plan = (plan_document(profile, roots, run_root, n_pathways, n_blocks, candidates, basis)
            if candidates else derive_plan(profile, roots, run_root, n_pathways, n_blocks))
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, plan)

    return plan


def resolve_plan_path(data_root, value):

    """Resolve an optional plan path against the site data root.

    Args:
        data_root (Path): Site ``data`` directory.
        value (str or None): Optional explicit plan path.

    Returns:
        Path: Plan path.
    """

    return data_root / DEFAULT_PLAN_NAME if value is None else Path(value)


def published_blocks(plan):

    """Return the block indices named by a plan.

    Args:
        plan (dict): Published-block plan.

    Returns:
        set: Block global indices.
    """

    return {entry["block_global_index"] for entry in plan["blocks"]}
