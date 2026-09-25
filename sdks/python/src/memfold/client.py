# SPDX-License-Identifier: Apache-2.0
"""Synchronous HTTP client for the memfold daemon REST API."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

import httpx

from .errors import MemfoldHTTPError
from .models import Health, MemoryRecord, Provenance, SearchHit

__all__ = ["MemfoldClient"]

_DEFAULT_PROVENANCE = {"source": "agent"}


def _drop_none(d: Mapping[str, Any]) -> dict[str, Any]:
    """Strip keys whose value is None so the daemon applies its own defaults."""
    return {k: v for k, v in d.items() if v is not None}


class MemfoldClient:
    """Client for a memfold daemon over its REST API.

    Args:
        base_url: Daemon base URL, e.g. ``http://127.0.0.1:7777``.
        token: Optional bearer token, sent as ``Authorization: Bearer <token>``.
        timeout: Request timeout in seconds.

    The client owns an :class:`httpx.Client`. Use it as a context manager or call
    :meth:`close` when done. Every non-2xx response raises
    :class:`~memfold.errors.MemfoldHTTPError`; :meth:`get` returns ``None`` on 404.
    """

    def __init__(
        self,
        base_url: str,
        token: str | None = None,
        timeout: float = 10,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        headers = {"accept": "application/json"}
        if token:
            headers["authorization"] = f"Bearer {token}"
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=timeout,
            transport=transport,
        )

    # -- lifecycle ---------------------------------------------------------
    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> MemfoldClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- low level ---------------------------------------------------------
    def _request(self, method: str, path: str, *, json: Any = None, params: Any = None) -> httpx.Response:
        resp = self._client.request(method, path, json=json, params=params)
        if not resp.is_success:
            raise MemfoldHTTPError(resp.status_code, method, str(resp.request.url), resp.text)
        return resp

    # -- public API --------------------------------------------------------
    def health(self) -> Health:
        """GET /health. Returns the daemon status, vector flag and record count."""
        return Health.from_dict(self._request("GET", "/health").json())

    def add(
        self,
        *,
        type: str,
        scope: str,
        body: str,
        provenance: Provenance | Mapping[str, Any] | None = None,
        scope_path: str | None = None,
        title: str | None = None,
        summary: str | None = None,
        tags: Sequence[str] | None = None,
        dedup_key: str | None = None,
        salience: float | None = None,
        confidence: float | None = None,
        decay: Mapping[str, Any] | None = None,
        links: Sequence[str] | None = None,
    ) -> MemoryRecord:
        """POST /memories. Create a memory record and return the stored version."""
        if isinstance(provenance, Provenance):
            prov: dict[str, Any] = provenance.to_dict()
        elif provenance:
            prov = dict(provenance)
        else:
            prov = dict(_DEFAULT_PROVENANCE)
        payload = _drop_none(
            {
                "type": type,
                "scope": scope,
                "body": body,
                "provenance": prov,
                "scope_path": scope_path,
                "title": title,
                "summary": summary,
                "tags": list(tags) if tags is not None else None,
                "dedup_key": dedup_key,
                "salience": salience,
                "confidence": confidence,
                "decay": dict(decay) if decay is not None else None,
                "links": list(links) if links is not None else None,
            }
        )
        return MemoryRecord.from_dict(self._request("POST", "/memories", json=payload).json())

    def get(self, id: str) -> MemoryRecord | None:
        """GET /memories/{id}. Returns None if the record does not exist (404)."""
        resp = self._client.request("GET", f"/memories/{id}")
        if resp.status_code == 404:
            return None
        if not resp.is_success:
            raise MemfoldHTTPError(resp.status_code, "GET", str(resp.request.url), resp.text)
        return MemoryRecord.from_dict(resp.json())

    def list(
        self,
        *,
        scope: str | None = None,
        scope_path: str | None = None,
        type: str | None = None,
        status: str | None = None,
    ) -> list[MemoryRecord]:
        """GET /memories. Filter by scope, scope path, type and status."""
        # The daemon reads the scope-path filter as the camelCase query key `scopePath`.
        params = _drop_none(
            {"scope": scope, "scopePath": scope_path, "type": type, "status": status}
        )
        rows = self._request("GET", "/memories", params=params).json()
        return [MemoryRecord.from_dict(r) for r in rows]

    def search(
        self,
        query: str,
        *,
        limit: int | None = None,
        scope: str | None = None,
        scope_path: str | None = None,
        types: Sequence[str] | None = None,
    ) -> list[SearchHit]:
        """POST /search. Hybrid search, returns scored hits ordered best first."""
        # The daemon reads the scope-path filter as the camelCase body key `scopePath`.
        payload = _drop_none(
            {
                "query": query,
                "limit": limit,
                "scope": scope,
                "scopePath": scope_path,
                "types": list(types) if types is not None else None,
            }
        )
        hits = self._request("POST", "/search", json=payload).json()
        return [SearchHit.from_dict(h) for h in hits]

    def update(self, id: str, **patch: Any) -> MemoryRecord:
        """PATCH /memories/{id}. Partial update of an existing record."""
        return MemoryRecord.from_dict(
            self._request("PATCH", f"/memories/{id}", json=_drop_none(patch)).json()
        )

    def forget(self, id: str) -> None:
        """DELETE /memories/{id}. Tombstones the record on the daemon."""
        self._request("DELETE", f"/memories/{id}")
