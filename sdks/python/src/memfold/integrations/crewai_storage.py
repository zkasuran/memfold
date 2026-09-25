# SPDX-License-Identifier: Apache-2.0
"""CrewAI ``Storage``-shaped adapter backed by a memfold daemon.

Matches the CrewAI external-memory ``Storage`` surface (``save`` / ``search`` /
``reset``) by duck typing, so nothing from ``crewai`` is imported. CrewAI calls
``save(value, metadata)`` to record a memory and ``search(query, limit,
score_threshold)`` to recall; results are returned as the list-of-dict shape
CrewAI's ``RAGStorage`` produces (``id`` / ``context`` / ``metadata`` / ``score``).

The daemon owns embedding and retrieval, so ``search`` takes a text query rather
than a precomputed vector.
"""

from __future__ import annotations

from typing import Any, Mapping

from ..client import MemfoldClient

__all__ = ["MemfoldCrewStorage"]


class MemfoldCrewStorage:
    """A CrewAI ``Storage``-shaped adapter over a memfold daemon.

    Args:
        client: A configured :class:`~memfold.client.MemfoldClient`.
        scope: memfold scope for stored memories (default ``project``).
        scope_path: scope path binding these memories to a project or crew.
        type: memfold record type (default ``episodic``).
        tool: provenance tool tag (default ``crewai``).
    """

    def __init__(
        self,
        client: MemfoldClient,
        *,
        scope: str = "project",
        scope_path: str | None = None,
        type: str = "episodic",
        tool: str = "crewai",
    ) -> None:
        self._client = client
        self._scope = scope
        self._scope_path = scope_path
        self._type = type
        self._tool = tool

    def save(self, value: Any, metadata: Mapping[str, Any] | None = None) -> None:
        """Store one memory. ``value`` is the content, ``metadata`` is filterable
        side data (an ``agent`` key, tags, and so on)."""
        meta = dict(metadata or {})
        tags = meta.get("tags")
        if isinstance(tags, str):
            tags = [tags]
        agent = meta.get("agent")
        if agent and not tags:
            tags = [str(agent)]
        self._client.add(
            type=self._type,
            scope=self._scope,
            scope_path=self._scope_path,
            body=value if isinstance(value, str) else str(value),
            provenance={"source": "agent", "tool": self._tool, "author": agent},
            tags=[str(t) for t in tags] if tags else None,
        )

    def search(
        self, query: str, limit: int = 3, score_threshold: float = 0.35
    ) -> list[dict[str, Any]]:
        """Recall memories matching ``query``, filtered by ``score_threshold``."""
        hits = self._client.search(
            query, limit=limit, scope=self._scope, scope_path=self._scope_path
        )
        results: list[dict[str, Any]] = []
        for hit in hits:
            if hit.score < score_threshold:
                continue
            results.append(
                {
                    "id": hit.record.id,
                    "context": hit.record.body,
                    "metadata": {
                        "tags": hit.record.tags,
                        "type": hit.record.type,
                        "via": hit.via,
                    },
                    "score": hit.score,
                }
            )
        return results

    def reset(self) -> None:
        """Forget every active memory in this adapter's scope. Destructive."""
        rows = self._client.list(
            scope=self._scope, scope_path=self._scope_path, status="active"
        )
        for rec in rows:
            self._client.forget(rec.id)
