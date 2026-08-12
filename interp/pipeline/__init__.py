"""Expose the canonical command-line interface for all site build stages."""

import argparse

from pipeline import blocks, bundle, normalize


def parser():

    """Build the canonical pipeline argument parser.

    Returns:
        argparse.ArgumentParser: Configured parser with build subcommands.
    """

    root = argparse.ArgumentParser(prog="python -m pipeline", description="Build and audit Pathway Explorer data")
    subparsers = root.add_subparsers(dest="command", required=True)

    bundle_parser = subparsers.add_parser("bundle", help="build one collection bundle")
    bundle.add_arguments(bundle_parser)
    bundle_parser.set_defaults(command_run=bundle.run)

    blocks_parser = subparsers.add_parser("blocks", help="build the block-first index")
    blocks.add_arguments(blocks_parser)
    blocks_parser.set_defaults(command_run=blocks.run)

    brite_parser = subparsers.add_parser("brite", help="export KEGG BRITE labels")
    bundle.add_brite_arguments(brite_parser)
    brite_parser.set_defaults(command_run=bundle.run_brite)

    normalize_parser = subparsers.add_parser("normalize", help="deduplicate pathway payloads")
    normalize.add_arguments(normalize_parser)
    normalize_parser.set_defaults(command_run=normalize.run)

    audit_parser = subparsers.add_parser("audit", help="audit generated site documents")
    blocks.add_audit_arguments(audit_parser)
    audit_parser.set_defaults(command_run=blocks.run_audit)

    return root


def main(argv=None):

    """Run one canonical pipeline subcommand.

    Args:
        argv (list or None): Optional argument vector.

    Returns:
        None
    """

    args = parser().parse_args(argv)
    args.command_run(args)

__all__ = ["main"]
