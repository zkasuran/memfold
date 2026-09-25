# SPDX-License-Identifier: Apache-2.0
"""Tests for MemfoldClient against a mocked daemon. No live network."""

from __future__ import annotations

import httpx
import pytest
import respx

from memfold import MemfoldClient, MemfoldHTTPError, MemoryRecord, SearchHit

BASE = "http://memfold.test"


def test_add_creates_record(mf):
    client, daemon = mf
    rec = client.add(type="fact", scope="project", scope_path="repo", body="hello")
    assert isinstance(rec, MemoryRecord)
    assert rec.body == "hello"
    assert rec.type == "fact"
    assert rec.scope == "project"
    assert rec.id in daemon.records


def test_add_sends_provenance_default(mf):
    client, daemon = mf
    rec = client.add(type="fact", scope="global", body="x")
    assert daemon.records[rec.id]["provenance"] == {"source": "agent"}


def test_search_returns_scored_hits(mf):
    client, _ = mf
    client.add(type="fact", scope="project", scope_path="repo", body="kubernetes rollout notes")
    hits = client.search("kubernetes")
    assert len(hits) == 1
    assert isinstance(hits[0], SearchHit)
    assert hits[0].score == 1.0
    assert hits[0].via == ["fts"]
    assert hits[0].record.body == "kubernetes rollout notes"


def test_get_found(mf):
    client, _ = mf
    rec = client.add(type="fact", scope="global", body="x")
    got = client.get(rec.id)
    assert got is not None
    assert got.id == rec.id


def test_get_missing_returns_none(mf):
    client, _ = mf
    assert client.get("does-not-exist") is None


def test_forget_tombstones(mf):
    client, daemon = mf
    rec = client.add(type="fact", scope="global", body="x")
    assert client.forget(rec.id) is None
    assert daemon.records[rec.id]["status"] == "tombstone"
    assert client.get(rec.id) is None


def test_list_filters_by_scope_path(mf):
    client, _ = mf
    client.add(type="fact", scope="project", scope_path="a", body="one")
    client.add(type="preference", scope="project", scope_path="b", body="two")
    rows = client.list(scope="project", scope_path="a")
    assert [r.body for r in rows] == ["one"]


def test_health(mf):
    client, _ = mf
    health = client.health()
    assert health.status == "ok"
    assert health.vector_enabled is True
    assert health.count == 0


def test_non_2xx_raises_http_error():
    with respx.mock(base_url=BASE) as router:
        router.post("/memories").mock(return_value=httpx.Response(500, text="boom"))
        with MemfoldClient(BASE) as client:
            with pytest.raises(MemfoldHTTPError) as excinfo:
                client.add(type="fact", scope="global", body="x")
    assert excinfo.value.status == 500
    assert "boom" in excinfo.value.body
