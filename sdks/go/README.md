# memfold Go SDK

A thin Go client for the memfold daemon REST API. memfold stores each durable fact,
preference, decision or note once as a Memory Record and projects it into whatever
format each AI coding tool reads. This package talks to a running memfold daemon over
HTTP using only the standard library.

## Install

```bash
go get github.com/zkasuran/memfold/sdks/go
```

```go
import memfold "github.com/zkasuran/memfold/sdks/go"
```

## Usage

```go
package main

import (
	"context"
	"fmt"
	"log"

	memfold "github.com/zkasuran/memfold/sdks/go"
)

func main() {
	ctx := context.Background()
	c := memfold.NewClient("http://127.0.0.1:7777", memfold.WithToken("secret"))

	if _, err := c.Health(ctx); err != nil {
		log.Fatal(err)
	}

	rec, err := c.Add(ctx, memfold.AddInput{
		Type:  "preference",
		Scope: "project",
		Body:  "Indent with tabs, not spaces.",
		Tags:  []string{"style"},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("stored", rec.ID)

	hits, err := c.Search(ctx, memfold.SearchInput{Query: "indent"})
	if err != nil {
		log.Fatal(err)
	}
	for _, h := range hits {
		fmt.Printf("%.3f %s\n", h.Score, h.Record.Body)
	}
}
```

## Client

`NewClient(baseURL string, opts ...Option)` builds a client. Trailing slashes on the
base URL are trimmed. Options:

- `WithToken(token)` sends `Authorization: Bearer <token>` on every request.
- `WithHTTPClient(*http.Client)` supplies your own HTTP client for timeouts, transports
  or proxies. A nil client is ignored.

The client holds only immutable configuration and is safe for concurrent use.

## Methods

Every method takes a `context.Context` for cancellation and deadlines.

| Method | REST call | Returns |
|---|---|---|
| `Health(ctx)` | `GET /health` | `*Health` (status, vector flag, record count) |
| `Add(ctx, AddInput)` | `POST /memories` | the stored `*MemoryRecord` |
| `Search(ctx, SearchInput)` | `POST /search` | ranked `[]SearchHit` |
| `Get(ctx, id)` | `GET /memories/{id}` | `*MemoryRecord`, or `(nil, nil)` on 404 |
| `List(ctx, ListInput)` | `GET /memories` | `[]MemoryRecord` |
| `Forget(ctx, id)` | `DELETE /memories/{id}` | tombstones the record |

`Add` fills `Provenance.Source` with `"agent"` when it is left empty, matching the
other memfold SDKs. `Forget` tombstones rather than physically dropping a record, so
the delete stays auditable and propagates on sync.

## Errors

Any non-2xx response other than the 404 that `Get` folds into `(nil, nil)` is returned
as an `*APIError` carrying the HTTP method, URL, `StatusCode`, the daemon `Message` and
the raw `Body`. Detect it with `errors.As`:

```go
var apiErr *memfold.APIError
if errors.As(err, &apiErr) && apiErr.StatusCode == 404 {
	// handle missing record
}
```

## License

Apache-2.0. See the repository `LICENSE`.
