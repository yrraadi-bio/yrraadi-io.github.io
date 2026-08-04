"""Check that every document the explorer can navigate to exists and agrees with the ones pointing at it."""

import argparse
import json
from pathlib import Path


def load(path):

    """Read a JSON document.

    Args:
        path (Path): File to read.

    Returns:
        dict: Parsed document.
    """

    return json.loads(path.read_text())


def check_blocks(data, problems):

    """Check the block-first index against the manifolds, cards and dominance it depends on.

    Args:
        data (Path): Site ``data/`` directory.
        problems (list): Collected problem strings, appended to.

    Returns:
        dict: The block index.
    """

    index = load(data / "blocks" / "index.json")
    picks = load(data / "blocks" / "dominance.json")["blocks"]
    manifolds = {entry["block_global_index"]: entry for entry in load(data / "manifold" / "block_manifolds_index.json")["blocks"]}
    documents = {}

    for block in index["blocks"]:
        global_index = block["block_global_index"]
        label = f"#{block['layer']}-{block['block']}"

        if global_index not in manifolds:
            problems.append(f"{label}: listed with no tile manifold")
        elif not (data / "manifold" / "block_manifolds" / f"{manifolds[global_index]['key']}.json").is_file():
            problems.append(f"{label}: manifold indexed but its file is missing")

        selectable = [entry for entry in block["pathways"] if "drawable" in entry]

        if not selectable:
            problems.append(f"{label}: no selectable set, the page cannot open")

        for entry in selectable:
            key = (entry["slug"], entry["pathway_id"])
            if key not in documents:
                path = data / entry["slug"] / "pathways" / f"{entry['pathway_id']}.json"
                documents[key] = load(path) if path.is_file() else None

            document = documents[key]

            if document is None:
                problems.append(f"{label}: {entry['pathway_id']} marked selectable but its document is missing")
            elif not any(card["block_global_index"] == global_index for card in document["blocks"]):
                problems.append(f"{label}: {entry['pathway_id']} marked selectable but carries no card for it")

        # a gene chip opens the set that measured it, so that set has to be one of the cards on screen
        carded = {entry["pathway_id"] for entry in selectable}
        for gene in block["genes"]:
            if gene["pathway_id"] not in carded:
                problems.append(f"{label}: gene {gene['symbol']} points at uncarded {gene['pathway_id']}")

    listed = {block["block_global_index"] for block in index["blocks"]}
    for key, pick in picks.items():
        if int(key) not in listed:
            problems.append(f"dominance credits block {key} that the list does not hold")
        elif not any(entry["pathway_id"] == pick["pathway_id"] for entry in
                     next(block for block in index["blocks"] if block["block_global_index"] == int(key))["pathways"]):
            problems.append(f"dominance credits block {key} for a set it does not card")

    return index


def check_pathways(data, problems):

    """Check every collection bundle against the tiles and manifolds its cards reach for.

    Args:
        data (Path): Site ``data/`` directory.
        problems (list): Collected problem strings, appended to.

    Returns:
        int: Pathway documents checked.
    """

    collections = load(data / "collections.json")["collections"]
    seen = 0

    for entry in collections:
        slug = entry["slug"]
        index = load(data / slug / "index.json")
        coords = {path.stem for path in (data / slug / "manifold" / "pathways").glob("*.json")}

        for pathway in index["pathways"]:
            path = data / slug / "pathways" / f"{pathway['pathway_id']}.json"

            if not path.is_file():
                problems.append(f"{slug}/{pathway['pathway_id']}: listed with no document")
                continue

            document = load(path)
            seen += 1

            if not document["blocks"]:
                problems.append(f"{slug}/{pathway['pathway_id']}: document holds no cards")

            if pathway["pathway_id"] not in coords:
                problems.append(f"{slug}/{pathway['pathway_id']}: no manifold colouring exported")

    return seen


def main():

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="/home/viraj/yrraadi-io.github.io/interp", help="site root holding data/")
    args = parser.parse_args()

    data = Path(args.out) / "data"
    problems = []

    index = check_blocks(data, problems)
    pathways = check_pathways(data, problems)
    inert = index["n_cards"] - index["n_shown"]

    print(f"{index['n_blocks']} features and {pathways} gene set documents checked,"
          f" {inert} of {index['n_cards']} feature cards cannot be opened")

    for problem in problems[:40]:
        print(f"  {problem}")

    print(f"{len(problems)} problems" if problems else "no problems")


if __name__ == "__main__":
    main()
