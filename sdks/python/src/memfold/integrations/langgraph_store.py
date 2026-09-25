# SPDX-License-Identifier: Apache-2.0
"""LangGraph ``BaseStore``-shaped adapter backed by a memfold daemon.

Matches the LangGraph ``BaseStore`` surface (``put`` / ``get`` / ``search`` /
``delete`` / ``list_namespaces`` plus async mirrors) without importing langgraph:
the returned ``Item`` / ``SearchItem`` are local dataclasses that carry the same
fields LangGraph exposes (``namespace``, ``key``, ``value``, ``created_at``,
``updated_at``, and ``score`` on search results).

Mapping onto memfold records:
  * a namespace tuple maps to a record ``scope_path`` (segments joined by ``/``);
  * namespace + key map to a stable ``dedup_key`` so the same key upserts;
  * the value dict is stored as JSON in the record ``body``.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from ..client import MemfoldClient

__all__ = ["MemfoldStore", "Item", "SearchItem"]

_NS_SEP = "/"
_KEY_PREFIX = "lg::"
_KEY_SEP = "::"


@dataclass(slots=True)
class Item:
    """A stored key-value item. Field-compatible with ``langgraph.store.base.Item``."""

    namespace: tuple[str, ...]
    key: str
    value: dict[str, Any]
    created_at: str | None = None
    updated_at: str | None = None


@dataclass(slots=True)
class SearchItem(Item):
    """A search result: an :class:`Item` plus a relevance ``score``."""

    score: float | None = None


def _scope_path(namespace: Sequence[str]) -> str:
    return _NS_SEP.join(namespace)


def _dedup_key(namespace: Sequence[str], key: str) -> str:
    return f"{_KEY_PREFIX}{_scope_path(namespace)}{_KEY_SEP}{key}"


def _key_from_dedup(dedup_key: str | None) -> str:
    if not dedup_key or not dedup_key.startswith(_KEY_PREFIX):
        return dedup_key or ""
    return dedup_key[len(_KEY_PREFIX) :].rsplit(_KEY_SEP, 1)[-1]


class MemfoldStore:
    """A LangGraph ``BaseStore``-shaped store over a memfold daemon.

    Args:
        client: A configured :class:`~memfold.client.MemfoldClient`.
        scope: memfold scope every record is written under (default ``project``).
        type: memfold record type for stored values (default ``fact``).
        tool: provenance tool tag stamped on writes (default ``langgraph``).

    Inject it wherever LangGraph accepts a store. Only the value-store surface is
    implemented; there is no TTL or embedding-index configuration here because the
    daemon owns retrieval.
    """

    supports_ttl: bool = False

    def __init__(
        self,
        client: MemfoldClient,
        *,
        scope: str = "project",
        type: str = "fact",
        tool: str = "langgraph",
    ) -> None:
        self._client = client
        self._scope = scope
        self._type = type
        self._tool = tool

    # -- helpers -----------------------------------------------------------
    def _find(self, namespace: Sequence[str], key: str):
        dedup = _dedup_key(namespace, key)
        rows = self._client.list(
            scope=self._scope, scope_path=_scope_path(namespace), status="active"
        )
        for rec in rows:
            if rec.dedup_key == dedup:
                return rec
        return None

    # -- sync surface ------------------------------------------------------
    def put(
        self,
        namespace: tuple[str, ...],
        key: str,
        value: Mapping[str, Any],
        index: Any = None,
        *,
        ttl: float | None = None,
    ) -> None:
        """Upsert ``value`` at ``namespace`` / ``key``. ``index`` and ``ttl`` are
        accepted for signature compatibility and ignored (the daemon indexes)."""
        body = json.dumps(dict(value))
        existing = self._find(namespace, key)
        if existing is not None:
            self._client.update(existing.id, body=body)
            return
        self._client.add(
            type=self._type,
            scope=self._scope,
            scope_path=_scope_path(namespace),
            body=body,
            dedup_key=_dedup_key(namespace, key),
            provenance={"source": "tool", "tool": self._tool},
        )

    def get(self, namespace: tuple[str, ...], key: str, *, refresh_ttl: bool | None = None) -> Item | None:
        rec = self._find(namespace, key)
        if rec is None:
            return None
        return Item(
            namespace=tuple(namespace),
            key=key,
            value=_load(rec.body),
            created_at=rec.created_at or None,
            updated_at=rec.updated_at or None,
        )

    def delete(self, namespace: tuple[str, ...], key: str) -> None:
        rec = self._find(namespace, key)
        if rec is not None:
            self._client.forget(rec.id)

    def search(
        self,
        namespace_prefix: tuple[str, ...],
        /,
        *,
        query: str | None = None,
        filter: Mapping[str, Any] | None = None,
        limit: int = 10,
        offset: int = 0,
        refresh_ttl: bool | None = None,
    ) -> list[SearchItem]:
        path = _scope_path(namespace_prefix)
        if query:
            hits = self._client.search(
                query, scope=self._scope, scope_path=path, limit=limit + offset
            )
            items = [
                SearchItem(
                    namespace=tuple(namespace_prefix),
                    key=_key_from_dedup(h.record.dedup_key),
                    value=_load(h.record.body),
                    created_at=h.record.created_at or None,
                    updated_at=h.record.updated_at or None,
                    score=h.score,
                )
                for h in hits
            ]
        else:
            rows = self._client.list(scope=self._scope, scope_path=path, status="active")
            items = [
                SearchItem(
                    namespace=tuple(namespace_prefix),
                    key=_key_from_dedup(rec.dedup_key),
                    value=_load(rec.body),
                    created_at=rec.created_at or None,
                    updated_at=rec.updated_at or None,
                    score=None,
                )
                for rec in rows
            ]
        if filter:
            items = [it for it in items if _matches(it.value, filter)]
        return items[offset : offset + limit]

    def list_namespaces(
        self,
        *,
        prefix: tuple[str, ...] | None = None,
        suffix: tuple[str, ...] | None = None,
        max_depth: int | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[tuple[str, ...]]:
        rows = self._client.list(scope=self._scope, status="active")
        seen: list[tuple[str, ...]] = []
        for rec in rows:
            if not rec.scope_path:
                continue
            ns = tuple(rec.scope_path.split(_NS_SEP))
            if max_depth is not None:
                ns = ns[:max_depth]
            if prefix and ns[: len(prefix)] != tuple(prefix):
                continue
            if suffix and ns[-len(suffix) :] != tuple(suffix):
                continue
            if ns not in seen:
                seen.append(ns)
        return seen[offset : offset + limit]

    # -- async mirrors -----------------------------------------------------
    async def aput(self, *args: Any, **kwargs: Any) -> None:
        return await asyncio.to_thread(self.put, *args, **kwargs)

    async def aget(self, *args: Any, **kwargs: Any) -> Item | None:
        return await asyncio.to_thread(self.get, *args, **kwargs)

    async def adelete(self, *args: Any, **kwargs: Any) -> None:
        return await asyncio.to_thread(self.delete, *args, **kwargs)

    async def asearch(self, *args: Any, **kwargs: Any) -> list[SearchItem]:
        return await asyncio.to_thread(self.search, *args, **kwargs)

    async def alist_namespaces(self, *args: Any, **kwargs: Any) -> list[tuple[str, ...]]:
        return await asyncio.to_thread(self.list_namespaces, *args, **kwargs)


def _load(body: str) -> dict[str, Any]:
    try:
        loaded = json.loads(body)
    except (ValueError, TypeError):
        return {"value": body}
    return loaded if isinstance(loaded, dict) else {"value": loaded}


def _matches(value: Mapping[str, Any], filter: Mapping[str, Any]) -> bool:
    return all(value.get(k) == v for k, v in filter.items())
