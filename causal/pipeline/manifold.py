"""Export the per-gene causal colouring that paints the cross-feature map."""

from pipeline.config import MIN_EFFECT, write_json_gz


def build(rows, order, symbols, destination):

    """Write one causal colouring per gene over the cross-feature map.

    Args:
        rows (pandas.DataFrame): Gene-feature rows from ``load_rankings``.
        order (list): Block global indices in cross-feature map row order.
        symbols (set): Gene symbols to export.
        destination (Path): Directory receiving the colourings.

    Returns:
        int: Number of colourings written.
    """

    destination.mkdir(parents=True, exist_ok=True)
    position = {index: row for row, index in enumerate(order)}
    mapped = rows[rows["block_global_index"].isin(position) & rows["gene"].isin(symbols)]
    written = 0

    for symbol, group in mapped.groupby("gene", sort=False):
        values = [0] * len(order)
        supported = []

        for row in group.itertuples(index=False):
            at = position[int(row.block_global_index)]
            values[at] = round(float(row.causal_decrease_score), 5)

            if row.causal_decrease_score > MIN_EFFECT and row.target_delta_q75 < 0:
                supported.append(int(row.block_global_index))

        write_json_gz(destination / f"{symbol}.json",
                   {"symbol": symbol, "values": values, "supported_blocks": sorted(supported)})
        written += 1

    return written
