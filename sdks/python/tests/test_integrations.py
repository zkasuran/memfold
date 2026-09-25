# SPDX-License-Identifier: Apache-2.0
"""Tests for the framework adapters against a mocked daemon. No live network."""

from __future__ import annotations

import asyncio

from memfold.integrations.adk_memory import MemfoldMemoryService
from memfold.integrations.crewai_storage import MemfoldCrewStorage
from memfold.integrations.langgraph_store import Item, MemfoldStore, SearchItem


def test_langgraph_put_get_roundtrip(mf):
    client, _ = mf
    store = MemfoldStore(client)
    ns = ("users", "alice")
    store.put(ns, "profile", {"name": "Alice", "lang": "en"})
    item = store.get(ns, "profile")
    assert isinstance(item, Item)
    assert item.value == {"name": "Alice", "lang": "en"}
    assert item.namespace == ns
    assert item.key == "profile"


def test_langgraph_put_upserts(mf):
    client, daemon = mf
    store = MemfoldStore(client)
    ns = ("users", "bob")
    store.put(ns, "p", {"n": 1})
    store.put(ns, "p", {"n": 2})
    assert store.get(ns, "p").value == {"n": 2}
    active = [
        r
        for r in daemon.records.values()
        if r["status"] == "active" and r["scope_path"] == "users/bob"
    ]
    assert len(active) == 1


def test_langgraph_get_missing(mf):
    client, _ = mf
    store = MemfoldStore(client)
    assert store.get(("nope",), "nada") is None


def test_langgraph_delete(mf):
    client, _ = mf
    store = MemfoldStore(client)
    ns = ("things",)
    store.put(ns, "k", {"a": 1})
    store.delete(ns, "k")
    assert store.get(ns, "k") is None


def test_langgraph_search(mf):
    client, _ = mf
    store = MemfoldStore(client)
    ns = ("notes",)
    store.put(ns, "k1", {"text": "redis caching layer"})
    hits = store.search(ns, query="redis")
    assert len(hits) == 1
    assert isinstance(hits[0], SearchItem)
    assert hits[0].value == {"text": "redis caching layer"}
    assert hits[0].score == 1.0
    assert hits[0].key == "k1"


def test_crewai_save_and_search(mf):
    client, _ = mf
    store = MemfoldCrewStorage(client, scope_path="crew1")
    store.save("user prefers dark mode", metadata={"agent": "researcher", "tags": ["ui"]})
    results = store.search("dark mode", limit=5)
    assert len(results) == 1
    assert results[0]["context"] == "user prefers dark mode"
    assert results[0]["score"] >= 0.35
    assert "ui" in results[0]["metadata"]["tags"]


class _Part:
    def __init__(self, text: str) -> None:
        self.text = text


class _Content:
    def __init__(self, text: str) -> None:
        self.parts = [_Part(text)]


class _Event:
    def __init__(self, text: str, author: str = "user") -> None:
        self.author = author
        self.content = _Content(text)


class _Session:
    app_name = "app"
    user_id = "u1"
    id = "s1"

    def __init__(self) -> None:
        self.events = [_Event("remember the api key rotates monthly")]


def test_adk_add_session_and_search(mf):
    client, _ = mf
    svc = MemfoldMemoryService(client)
    asyncio.run(svc.add_session_to_memory(_Session()))
    resp = asyncio.run(svc.search_memory(app_name="app", user_id="u1", query="api key"))
    assert len(resp.memories) == 1
    entry = resp.memories[0]
    # google.genai Content has no `.text`; text lives on each part. Iterate parts and
    # read `.text`, skipping parts that carry none. Works for the real Content type and
    # the adapter's local fallback shape alike.
    text = "".join(p.text for p in entry.content.parts if getattr(p, "text", None))
    assert "api key" in text
    assert entry.author == "user"
