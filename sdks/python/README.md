# memfold (Python SDK)

Python client for the memfold daemon plus drop-in memory adapters for Python agent
frameworks. The client talks to the daemon REST API over HTTP. It does not embed the
store. Run a memfold daemon and point the client at it.

## Install

```bash
pip install memfold                 # client only (depends on httpx)
pip install "memfold[langgraph]"    # + LangGraph store adapter deps
pip install "memfold[crewai]"       # + CrewAI deps
pip install "memfold[adk]"          # + Google ADK deps
pip install "memfold[llama-index]"  # + LlamaIndex deps
```

The adapters import their framework lazily, so the client works without any of the
framework extras installed.

## Client

```python
from memfold import MemfoldClient

with MemfoldClient("http://127.0.0.1:7777", token="optional-bearer") as mf:
    rec = mf.add(
        type="preference",
        scope="project",
        scope_path="/repo",
        body="Indent with tabs, not spaces.",
        dedup_key="pref:indent-style",
    )

    hits = mf.search("indentation", scope="project", scope_path="/repo", limit=5)
    for hit in hits:
        print(hit.score, hit.record.body)

    got = mf.get(rec.id)          # MemoryRecord, or None on 404
    rows = mf.list(scope="project", status="active")
    mf.forget(rec.id)             # tombstones the record
    print(mf.health())            # Health(status, vector_enabled, count)
```

Every non-2xx response raises `MemfoldHTTPError` (carrying `status`, `method`, `url`
and `body`). `get` is the one exception and returns `None` on a 404.

## Framework adapters

### LangGraph `BaseStore`

`MemfoldStore` matches the LangGraph `BaseStore` surface (`put` / `get` / `search` /
`delete` / `list_namespaces` and async mirrors). A namespace tuple maps to a record
`scope_path`, namespace plus key map to a stable `dedup_key`, and the value dict is
stored as JSON in the record body.

```python
from memfold import MemfoldClient
from memfold.integrations.langgraph_store import MemfoldStore

store = MemfoldStore(MemfoldClient("http://127.0.0.1:7777"))
store.put(("users", "alice"), "profile", {"name": "Alice"})
item = store.get(("users", "alice"), "profile")   # item.value == {"name": "Alice"}
hits = store.search(("users", "alice"), query="name")
```

### CrewAI external memory

`MemfoldCrewStorage` matches the CrewAI `Storage` shape (`save` / `search` / `reset`).
The daemon owns embedding, so `search` takes a text query.

```python
from memfold.integrations.crewai_storage import MemfoldCrewStorage

storage = MemfoldCrewStorage(client, scope_path="my-crew")
storage.save("The client ships on Fridays.", metadata={"agent": "planner"})
results = storage.search("release schedule", limit=3)
```

### Google ADK `BaseMemoryService`

`MemfoldMemoryService` matches the ADK memory-service shape
(`add_session_to_memory` and `search_memory`, both async). An ADK
`(app_name, user_id)` namespace maps to a record `scope_path`.

```python
from memfold.integrations.adk_memory import MemfoldMemoryService

memory = MemfoldMemoryService(client)
await memory.add_session_to_memory(session)
resp = await memory.search_memory(app_name="app", user_id="u1", query="deploy steps")
```

## Development

```bash
uv venv
uv pip install -e '.[dev]'
uv run pytest -q
```

Tests mock the daemon HTTP with respx, so they need no running daemon and no network.

## License

Apache-2.0.
