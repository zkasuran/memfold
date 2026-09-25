// SPDX-License-Identifier: Apache-2.0

package memfold

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func strPtr(s string) *string { return &s }

// asAPIError reports whether err is (or wraps) an *APIError, binding it into target.
func asAPIError(err error, target **APIError) bool { return errors.As(err, target) }

// newTestClient starts an httptest server running handler and returns a Client
// pointed at it. The server is torn down when the test finishes.
func newTestClient(t *testing.T, opts []Option, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return NewClient(srv.URL, opts...)
}

// sampleRecord is a fully populated record the stub daemon echoes back.
func sampleRecord() MemoryRecord {
	return MemoryRecord{
		ID:            "01J0000000000000000000000A",
		Rev:           "01J0000000000000000000000B",
		SchemaVersion: 1,
		Type:          "preference",
		Scope:         "project",
		ScopePath:     strPtr("/repo"),
		Title:         strPtr("Indent style"),
		Body:          "Indent with tabs, not spaces.",
		Tags:          []string{"style"},
		ContentHash:   "sha256:" + "0000000000000000000000000000000000000000000000000000000000000000",
		Provenance:    Provenance{Source: "user", Tool: strPtr("claude-code")},
		Salience:      0.5,
		Confidence:    1,
		CreatedAt:     "2026-09-20T10:00:00Z",
		UpdatedAt:     "2026-09-20T10:00:00Z",
		Status:        "active",
		HLC:           "001758452700000:000001:node",
	}
}

func TestAddPostsRightJSONAndParsesRecord(t *testing.T) {
	var gotBody AddInput
	c := newTestClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/memories" {
			t.Fatalf("got %s %s, want POST /memories", r.Method, r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Fatalf("Content-Type = %q, want application/json", ct)
		}
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &gotBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(sampleRecord())
	})

	sal := 0.9
	in := AddInput{
		Type:       "preference",
		Scope:      "project",
		Body:       "Indent with tabs, not spaces.",
		Provenance: Provenance{Source: "user", Tool: strPtr("claude-code")},
		ScopePath:  strPtr("/repo"),
		Tags:       []string{"style"},
		Salience:   &sal,
	}
	rec, err := c.Add(context.Background(), in)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	if gotBody.Type != "preference" || gotBody.Scope != "project" {
		t.Errorf("posted type/scope = %q/%q", gotBody.Type, gotBody.Scope)
	}
	if gotBody.Body != in.Body {
		t.Errorf("posted body = %q", gotBody.Body)
	}
	if gotBody.Provenance.Source != "user" {
		t.Errorf("posted provenance.source = %q, want user", gotBody.Provenance.Source)
	}
	if gotBody.Salience == nil || *gotBody.Salience != 0.9 {
		t.Errorf("posted salience = %v, want 0.9", gotBody.Salience)
	}
	if rec.ID != "01J0000000000000000000000A" || rec.Type != "preference" {
		t.Errorf("parsed record = %+v", rec)
	}
	if rec.ScopePath == nil || *rec.ScopePath != "/repo" {
		t.Errorf("parsed scope_path = %v, want /repo", rec.ScopePath)
	}
}

func TestAddDefaultsProvenanceSource(t *testing.T) {
	var raw map[string]any
	c := newTestClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &raw)
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(sampleRecord())
	})

	if _, err := c.Add(context.Background(), AddInput{Type: "fact", Scope: "global", Body: "x"}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	prov, _ := raw["provenance"].(map[string]any)
	if prov["source"] != "agent" {
		t.Errorf("default provenance.source = %v, want agent", prov["source"])
	}
}

func TestSearchParsesHits(t *testing.T) {
	var gotBody SearchInput
	c := newTestClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/search" {
			t.Fatalf("got %s %s, want POST /search", r.Method, r.URL.Path)
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &gotBody)
		hits := []SearchHit{
			{Record: sampleRecord(), Score: 0.42, Via: []string{"fts", "vec"}},
		}
		_ = json.NewEncoder(w).Encode(hits)
	})

	limit := 5
	hits, err := c.Search(context.Background(), SearchInput{Query: "indent", Limit: &limit, Types: []string{"preference"}})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if gotBody.Query != "indent" || gotBody.Limit == nil || *gotBody.Limit != 5 {
		t.Errorf("posted search = %+v", gotBody)
	}
	if len(hits) != 1 {
		t.Fatalf("got %d hits, want 1", len(hits))
	}
	if hits[0].Score != 0.42 || hits[0].Record.ID != "01J0000000000000000000000A" {
		t.Errorf("hit = %+v", hits[0])
	}
	if !reflect.DeepEqual(hits[0].Via, []string{"fts", "vec"}) {
		t.Errorf("via = %v", hits[0].Via)
	}
}

func TestGet(t *testing.T) {
	tests := []struct {
		name       string
		status     int
		wantNil    bool
		wantErr    bool
		wantStatus int
	}{
		{name: "found", status: http.StatusOK, wantNil: false},
		{name: "not found maps to nil,nil", status: http.StatusNotFound, wantNil: true},
		{name: "server error is an APIError", status: http.StatusInternalServerError, wantErr: true, wantStatus: 500},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newTestClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/memories/abc" {
					t.Fatalf("path = %s, want /memories/abc", r.URL.Path)
				}
				if tt.status == http.StatusOK {
					_ = json.NewEncoder(w).Encode(sampleRecord())
					return
				}
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(`{"error":"not found"}`))
			})

			rec, err := c.Get(context.Background(), "abc")
			if tt.wantErr {
				var apiErr *APIError
				if err == nil || !asAPIError(err, &apiErr) || apiErr.StatusCode != tt.wantStatus {
					t.Fatalf("got err %v, want *APIError status %d", err, tt.wantStatus)
				}
				return
			}
			if err != nil {
				t.Fatalf("Get: %v", err)
			}
			if tt.wantNil && rec != nil {
				t.Errorf("got %+v, want nil", rec)
			}
			if !tt.wantNil && rec == nil {
				t.Error("got nil, want record")
			}
		})
	}
}

func TestTokenSentAsBearer(t *testing.T) {
	var gotAuth string
	c := newTestClient(t, []Option{WithToken("secret")}, func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(Health{Status: "ok", VectorEnabled: true, Count: 3})
	})

	if _, err := c.Health(context.Background()); err != nil {
		t.Fatalf("Health: %v", err)
	}
	if gotAuth != "Bearer secret" {
		t.Errorf("Authorization = %q, want %q", gotAuth, "Bearer secret")
	}
}

func TestNoTokenOmitsAuthHeader(t *testing.T) {
	c := newTestClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("Authorization = %q, want empty", got)
		}
		_ = json.NewEncoder(w).Encode(Health{Status: "ok"})
	})
	if _, err := c.Health(context.Background()); err != nil {
		t.Fatalf("Health: %v", err)
	}
}

func TestHealthParses(t *testing.T) {
	c := newTestClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/health" {
			t.Fatalf("got %s %s, want GET /health", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(Health{Status: "ok", VectorEnabled: true, Count: 7})
	})
	h, err := c.Health(context.Background())
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if h.Status != "ok" || !h.VectorEnabled || h.Count != 7 {
		t.Errorf("health = %+v", h)
	}
}

func TestListSendsQueryParams(t *testing.T) {
	var gotQuery string
	c := newTestClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/memories" {
			t.Fatalf("got %s %s, want GET /memories", r.Method, r.URL.Path)
		}
		gotQuery = r.URL.Query().Encode()
		_ = json.NewEncoder(w).Encode([]MemoryRecord{sampleRecord()})
	})

	recs, err := c.List(context.Background(), ListInput{Scope: "project", Type: "preference", Status: "active"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	want := "scope=project&status=active&type=preference"
	if gotQuery != want {
		t.Errorf("query = %q, want %q", gotQuery, want)
	}
	if len(recs) != 1 {
		t.Fatalf("got %d records, want 1", len(recs))
	}
}

func TestForgetSendsDelete(t *testing.T) {
	var gotMethod, gotPath string
	c := newTestClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath = r.Method, r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	})

	if err := c.Forget(context.Background(), "abc"); err != nil {
		t.Fatalf("Forget: %v", err)
	}
	if gotMethod != http.MethodDelete || gotPath != "/memories/abc" {
		t.Errorf("got %s %s, want DELETE /memories/abc", gotMethod, gotPath)
	}
}

func TestAPIErrorCarriesStatusAndMessage(t *testing.T) {
	c := newTestClient(t, nil, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid body"}`))
	})

	_, err := c.Add(context.Background(), AddInput{Type: "fact", Scope: "global", Body: "x"})
	var apiErr *APIError
	if err == nil || !asAPIError(err, &apiErr) {
		t.Fatalf("got %v, want *APIError", err)
	}
	if apiErr.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", apiErr.StatusCode)
	}
	if apiErr.Message != "invalid body" {
		t.Errorf("message = %q, want %q", apiErr.Message, "invalid body")
	}
}

func TestBaseURLTrailingSlashTrimmed(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewEncoder(w).Encode(Health{Status: "ok"})
	}))
	t.Cleanup(srv.Close)

	c := NewClient(srv.URL+"/", WithHTTPClient(nil))
	if _, err := c.Health(context.Background()); err != nil {
		t.Fatalf("Health: %v", err)
	}
	if gotPath != "/health" {
		t.Errorf("path = %q, want /health (no double slash)", gotPath)
	}
}
