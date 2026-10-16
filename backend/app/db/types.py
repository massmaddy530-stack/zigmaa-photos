"""Cross-dialect column types."""

from __future__ import annotations

import json

import numpy as np
from pgvector.sqlalchemy import Vector
from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator, TypeEngine

EMBEDDING_DIM = 512


class EmbeddingType(TypeDecorator):
    """pgvector ``vector(N)`` on PostgreSQL; JSON text elsewhere (unit tests on SQLite only)."""

    impl = Text
    cache_ok = True

    def __init__(self, dim: int = EMBEDDING_DIM) -> None:
        super().__init__()
        self.dim = dim

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine:
        if dialect.name == "postgresql":
            return dialect.type_descriptor(Vector(self.dim))
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value, dialect: Dialect):
        if value is None:
            return None
        arr = np.asarray(value, dtype=np.float32).reshape(-1)
        if arr.shape[0] != self.dim:
            raise ValueError(f"Embedding must have {self.dim} dimensions, got {arr.shape[0]}")
        if dialect.name == "postgresql":
            return arr  # pgvector's bind processor handles numpy arrays
        return json.dumps([float(x) for x in arr])

    def process_result_value(self, value, dialect: Dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return np.asarray(value, dtype=np.float32)
        return np.asarray(json.loads(value), dtype=np.float32)
