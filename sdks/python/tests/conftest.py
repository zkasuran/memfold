# SPDX-License-Identifier: Apache-2.0
"""Shared test fixtures: an in-memory fake of the memfold daemon, wired via respx."""

from __future__ import annotations

import itertools
import json

import httpx
import pytest
import respx

from memfold import MemfoldClient

BASE = "http://memfold.test"


class FakeDaemon:
    """A minimal in-memory stand-in for the memfold daemon REST contract."""

    def __init__(self) -> None:
        self.records: dict[str, dict] = {}
        self._seq = itertools.count(1)

    def _new_id(self) -> str:
        return f"REC{next(self._seq):023d}"

    def _materialize(self, rid: str, data: dict) -> dict:
        return {
            "id": rid,
            "rev": rid,
            "schema_version": 1,
            "type": data.get("type", "fact"),
            "scope": data.get("scope", "global"),
            "scope_path": data.get("scope_path"),
            "title": data.get("title"),
            "body": data.get("body", ""),
            "summary": data.get("summary"),
            "tags": data.get("tags", []),
            "dedup_key": data.get("dedup_key"),
            "content_hash": "sha256:" + "0" * 64,
            "provenance": data.get("provenance", {"source": "agent"}),
            "salience": data.get("salience", 0.5),
            "confidence": data.get("confidence", 1),
            "decay": data.get("decay", {"pinned": False}),
            "created_at": "2026-09-25T00:00:00Z",
            "updated_at": "2026-09-25T00:00:00Z",
            "status": "active",
            "links": data.get("links", []),
            "hlc": "000000000000000:000000:test",
            "sensitivity": "public",
        }

    def _id_from(self, request: httpx.Request) -> str:
        return request.url.path.rsplit("/", 1)[-1]

    def create(self, request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)
        rid = self._new_id()
        rec = self._materialize(rid, data)
        self.records[rid] = rec
        return httpx.Response(201, json=rec)

    def get(self, request: httpx.Request) -> httpx.Response:
        rec = self.records.get(self._id_from(request))
        if not rec or rec["status"] == "tombstone":
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(200, json=rec)

    def patch(self, request: httpx.Request) -> httpx.Response:
        rec = self.records.get(self._id_from(request))
        if not rec or rec["status"] == "tombstone":
            return httpx.Response(404, json={"error": "not found"})
        rec.update(json.loads(request.content))
        rec["updated_at"] = "2026-09-25T01:00:00Z"
        return httpx.Response(200, json=rec)

    def delete(self, request: httpx.Request) -> httpx.Response:
        rec = self.records.get(self._id_from(request))
        if not rec or rec["status"] == "tombstone":
            return httpx.Response(404, json={"error": "not found"})
        rec["status"] = "tombstone"
        return httpx.Response(204)

    def list(self, request: httpx.Request) -> httpx.Response:
        p = request.url.params
        rows = []
        for rec in self.records.values():
            if (s := p.get("scope")) and rec["scope"] != s:
                continue
            if (sp := p.get("scopePath")) and rec["scope_path"] != sp:
                continue
            if (t := p.get("type")) and rec["type"] != t:
                continue
            if (st := p.get("status")) and rec["status"] != st:
                continue
            rows.append(rec)
        return httpx.Response(200, json=rows)

    def search(self, request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)
        q = (data.get("query") or "").lower()
        limit = data.get("limit") or 10
        scope, sp = data.get("scope"), data.get("scopePath")
        hits = []
        for rec in self.records.values():
            if rec["status"] != "active":
                continue
            if scope and rec["scope"] != scope:
                continue
            if sp and rec["scope_path"] != sp:
                continue
            if q and q not in rec["body"].lower():
                continue
            hits.append({"record": rec, "score": 1.0, "via": ["fts"]})
        return httpx.Response(200, json=hits[:limit])

    def health(self, request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"status": "ok", "vectorEnabled": True, "count": len(self.records)}
        )


@pytest.fixture
def daemon() -> FakeDaemon:
    return FakeDaemon()


@pytest.fixture
def mf(daemon: FakeDaemon):
    with respx.mock(base_url=BASE, assert_all_called=False) as router:
        router.get(path__regex=r"^/memories/[^/?]+$").mock(side_effect=daemon.get)
        router.patch(path__regex=r"^/memories/[^/?]+$").mock(side_effect=daemon.patch)
        router.delete(path__regex=r"^/memories/[^/?]+$").mock(side_effect=daemon.delete)
        router.post("/memories").mock(side_effect=daemon.create)
        router.get("/memories").mock(side_effect=daemon.list)
        router.post("/search").mock(side_effect=daemon.search)
        router.get("/health").mock(side_effect=daemon.health)
        with MemfoldClient(BASE) as client:
            yield client, daemon
