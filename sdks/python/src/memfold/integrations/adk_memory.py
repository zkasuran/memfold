# SPDX-License-Identifier: Apache-2.0
"""Google ADK ``BaseMemoryService``-shaped adapter backed by a memfold daemon.

Matches the ADK memory-service surface (``add_session_to_memory`` and
``search_memory``) by duck typing. It does not import ``google-adk`` at module
top; if the ADK / genai types are installed, search results are returned as real
``google.genai.types.Content`` objects, otherwise as the local shape below (a
``.parts`` list of objects exposing ``.text``, plus a ``.text`` convenience).

An ADK namespace is ``(app_name, user_id)``; it maps to a record ``scope_path`` of
``"{app_name}/{user_id}"``. Ingested session events become ``episodic`` records.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Sequence

from ..client import MemfoldClient
from ..models import SearchHit

__all__ = ["MemfoldMemoryService", "MemoryEntry", "SearchMemoryResponse"]


@dataclass(slots=True)
class _Part:
    text: str


@dataclass(slots=True)
class _Content:
    parts: list[_Part]

    @property
    def text(self) -> str:
        return "".join(p.text for p in self.parts if getattr(p, "text", None))


@dataclass(slots=True)
class MemoryEntry:
    """One recalled memory. Field-compatible with ``google.adk.memory.MemoryEntry``."""

    content: Any
    author: str | None = None
    timestamp: str | None = None
    custom_metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class SearchMemoryResponse:
    """Response from :meth:`MemfoldMemoryService.search_memory`."""

    memories: list[MemoryEntry] = field(default_factory=list)


def _make_content(text: str) -> Any:
    """Build a genai ``Content`` if the library is present, else the local shape."""
    try:  # pragma: no cover - exercised only when google-genai is installed
        from google.genai import types  # type: ignore

        return types.Content(role="user", parts=[types.Part(text=text)])
    except Exception:
        return _Content(parts=[_Part(text=text)])


def _event_text(event: Any) -> str:
    """Pull display text out of an ADK event (or any object with content.parts)."""
    content = getattr(event, "content", None)
    parts = getattr(content, "parts", None) if content is not None else None
    if parts:
        chunks = [getattr(p, "text", None) for p in parts]
        return "".join(c for c in chunks if c)
    if isinstance(event, str):
        return event
    return str(getattr(event, "text", "") or "")


class MemfoldMemoryService:
    """An ADK ``BaseMemoryService``-shaped memory service over a memfold daemon.

    Args:
        client: A configured :class:`~memfold.client.MemfoldClient`.
        scope: memfold scope for stored memories (default ``project``).
        type: memfold record type for ingested memories (default ``episodic``).
        tool: provenance tool tag (default ``google-adk``).

    Both methods are async to match ADK, which is async-only; the underlying
    client is synchronous, so calls run in a worker thread.
    """

    def __init__(
        self,
        client: MemfoldClient,
        *,
        scope: str = "project",
        type: str = "episodic",
        tool: str = "google-adk",
    ) -> None:
        self._client = client
        self._scope = scope
        self._type = type
        self._tool = tool

    @staticmethod
    def _scope_path(app_name: str | None, user_id: str | None) -> str:
        return f"{app_name or ''}/{user_id or ''}"

    async def add_session_to_memory(self, session: Any) -> None:
        """Ingest a completed ADK ``Session`` into long-term memory.

        Each event that carries text becomes one record. ``session`` is expected
        to expose ``app_name``, ``user_id``, an id (``id`` or ``session_id``) and
        an iterable of ``events``.
        """
        app_name = getattr(session, "app_name", None)
        user_id = getattr(session, "user_id", None)
        session_id = getattr(session, "id", None) or getattr(session, "session_id", None)
        scope_path = self._scope_path(app_name, user_id)
        events: Sequence[Any] = getattr(session, "events", None) or []

        def _write() -> None:
            for event in events:
                text = _event_text(event).strip()
                if not text:
                    continue
                author = getattr(event, "author", None)
                self._client.add(
                    type=self._type,
                    scope=self._scope,
                    scope_path=scope_path,
                    body=text,
                    provenance={
                        "source": "agent",
                        "tool": self._tool,
                        "session_id": session_id,
                        "author": author,
                    },
                    tags=[t for t in (app_name, user_id) if t],
                )

        await asyncio.to_thread(_write)

    async def search_memory(
        self, *, app_name: str, user_id: str, query: str
    ) -> SearchMemoryResponse:
        """Search a user's long-term memory and return an ADK-shaped response."""
        scope_path = self._scope_path(app_name, user_id)
        hits: list[SearchHit] = await asyncio.to_thread(
            self._client.search, query, scope=self._scope, scope_path=scope_path
        )
        memories = [
            MemoryEntry(
                content=_make_content(hit.record.body),
                author=hit.record.provenance.author,
                timestamp=hit.record.created_at or None,
                custom_metadata={"id": hit.record.id, "score": hit.score, "via": hit.via},
            )
            for hit in hits
        ]
        return SearchMemoryResponse(memories=memories)
