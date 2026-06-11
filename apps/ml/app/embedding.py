"""Sentence embeddings for semantic search (Chunk 6.4).

Uses fastembed (ONNX runtime) with BAAI/bge-small-en-v1.5 — 384-dimensional, matching the pgvector
`vector(384)` column. fastembed is the lightweight, fully open-source / self-hostable equivalent of
sentence-transformers (it avoids the multi-GB torch dependency), which keeps the service image small
and the build reproducible. The model is loaded lazily (and baked into the image at build time).
"""
from __future__ import annotations

import os
from functools import lru_cache

MODEL_NAME = "BAAI/bge-small-en-v1.5"
DIM = 384


@lru_cache(maxsize=1)
def _model():
    from fastembed import TextEmbedding

    # Use the baked model cache (set in the Docker image); falls back to the default location locally.
    return TextEmbedding(model_name=MODEL_NAME, cache_dir=os.getenv("FASTEMBED_CACHE_DIR") or None)


def embed(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts → list of 384-dim float vectors."""
    return [vec.tolist() for vec in _model().embed(texts)]


def embed_one(text: str) -> list[float]:
    return embed([text])[0]


def to_pgvector(vec: list[float]) -> str:
    """Format a vector as a pgvector literal: '[0.1,0.2,...]'."""
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"
