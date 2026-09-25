# SPDX-License-Identifier: Apache-2.0
"""Typed, dependency-free representations of the memfold wire types.

These dataclasses mirror the Memory Record schema (spec/memory-record.schema.json)
and the daemon REST responses. They are lenient on read: unknown keys are kept in
``extra`` so a record written by a newer daemon survives a round trip.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields
from typing import Any


def _known(cls: type, data: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Split ``data`` into (known-field kwargs, leftover keys) for a dataclass."""
    names = {f.name for f in fields(cls)}
    known = {k: v for k, v in data.items() if k in names and k != "extra"}
    extra = {k: v for k, v in data.items() if k not in names}
    return known, extra


@dataclass(slots=True)
class Provenance:
    """Where a record came from. ``source`` is the only required field."""

    source: str = "agent"
    tool: str | None = None
    session_id: str | None = None
    author: str | None = None
    model: str | None = None
    cite: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Provenance:
        if not data:
            return cls()
        known, _ = _known(cls, data)
        return cls(**known)

    def to_dict(self) -> dict[str, Any]:
        return {
            f.name: getattr(self, f.name)
            for f in fields(self)
            if getattr(self, f.name) is not None
        }


@dataclass(slots=True)
class Decay:
    """Recency and expiry controls for a record."""

    half_life_days: float | None = None
    ttl_at: str | None = None
    pinned: bool = False

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Decay:
        if not data:
            return cls()
        known, _ = _known(cls, data)
        return cls(**known)

    def to_dict(self) -> dict[str, Any]:
        return {f.name: getattr(self, f.name) for f in fields(self)}


@dataclass(slots=True)
class MemoryRecord:
    """One durable unit of memory as returned by the daemon.

    Every field carries a default so a partial payload (the daemon applies its own
    defaults) still parses. Unknown keys are preserved in ``extra``.
    """

    id: str = ""
    rev: str = ""
    schema_version: int = 1
    type: str = "fact"
    scope: str = "global"
    scope_path: str | None = None
    title: str | None = None
    body: str = ""
    summary: str | None = None
    tags: list[str] = field(default_factory=list)
    dedup_key: str | None = None
    content_hash: str = ""
    embedding_model: str | None = None
    embedding_dim: int | None = None
    provenance: Provenance = field(default_factory=Provenance)
    salience: float = 0.5
    confidence: float = 1.0
    decay: Decay = field(default_factory=Decay)
    created_at: str = ""
    updated_at: str = ""
    last_accessed_at: str | None = None
    access_count: int = 0
    supersedes: str | None = None
    superseded_by: str | None = None
    status: str = "active"
    links: list[str] = field(default_factory=list)
    hlc: str = ""
    sensitivity: str = "public"
    redactions: list[dict[str, Any]] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> MemoryRecord:
        known, extra = _known(cls, data)
        known["provenance"] = Provenance.from_dict(data.get("provenance"))
        known["decay"] = Decay.from_dict(data.get("decay"))
        rec = cls(**known)
        rec.extra = extra
        return rec

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for f in fields(self):
            if f.name == "extra":
                continue
            v = getattr(self, f.name)
            if isinstance(v, (Provenance, Decay)):
                out[f.name] = v.to_dict()
            else:
                out[f.name] = v
        out.update(self.extra)
        return out


@dataclass(slots=True)
class SearchHit:
    """One scored search result: the record, its fused score and which legs hit."""

    record: MemoryRecord
    score: float
    via: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SearchHit:
        return cls(
            record=MemoryRecord.from_dict(data.get("record", {})),
            score=float(data.get("score", 0.0)),
            via=list(data.get("via", [])),
        )


@dataclass(slots=True)
class Health:
    """The daemon's GET /health report."""

    status: str
    vector_enabled: bool
    count: int

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Health:
        return cls(
            status=str(data.get("status", "")),
            vector_enabled=bool(data.get("vectorEnabled", False)),
            count=int(data.get("count", 0)),
        )

