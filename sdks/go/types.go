// SPDX-License-Identifier: Apache-2.0

package memfold

// Provenance records who or what produced a record. Source is required and is one
// of "user", "agent", "tool", "import" or "consolidation". The remaining fields are
// optional lineage and are omitted from a request when empty.
type Provenance struct {
	Source    string  `json:"source"`
	Tool      *string `json:"tool,omitempty"`
	SessionID *string `json:"session_id,omitempty"`
	Author    *string `json:"author,omitempty"`
	Model     *string `json:"model,omitempty"`
	Cite      *string `json:"cite,omitempty"`
}

// Decay controls how a record ages out of retrieval. A nil HalfLifeDays means no
// decay, TTLAt is a hard expiry and Pinned opts the record out of decay and pruning.
type Decay struct {
	HalfLifeDays *float64 `json:"half_life_days,omitempty"`
	TTLAt        *string  `json:"ttl_at,omitempty"`
	Pinned       bool     `json:"pinned"`
}

// Redaction marks a removed span in a record body.
type Redaction struct {
	Span [2]int `json:"span"`
	Kind string `json:"kind"`
}

// MemoryRecord is the canonical, tool-neutral unit of memory returned by the daemon.
// It mirrors spec/memory-record.schema.json. Nullable fields are pointers so a null
// from the daemon is distinguishable from an absent one.
type MemoryRecord struct {
	ID             string      `json:"id"`
	Rev            string      `json:"rev"`
	SchemaVersion  int         `json:"schema_version"`
	Type           string      `json:"type"`
	Scope          string      `json:"scope"`
	ScopePath      *string     `json:"scope_path"`
	Title          *string     `json:"title"`
	Body           string      `json:"body"`
	Summary        *string     `json:"summary"`
	Tags           []string    `json:"tags"`
	DedupKey       *string     `json:"dedup_key"`
	ContentHash    string      `json:"content_hash"`
	EmbeddingModel *string     `json:"embedding_model"`
	EmbeddingDim   *int        `json:"embedding_dim"`
	Provenance     Provenance  `json:"provenance"`
	Salience       float64     `json:"salience"`
	Confidence     float64     `json:"confidence"`
	Decay          Decay       `json:"decay"`
	CreatedAt      string      `json:"created_at"`
	UpdatedAt      string      `json:"updated_at"`
	LastAccessedAt *string     `json:"last_accessed_at"`
	AccessCount    int         `json:"access_count"`
	Supersedes     *string     `json:"supersedes"`
	SupersededBy   *string     `json:"superseded_by"`
	Status         string      `json:"status"`
	Links          []string    `json:"links"`
	HLC            string      `json:"hlc"`
	Sensitivity    string      `json:"sensitivity"`
	Redactions     []Redaction `json:"redactions"`
}

// SearchHit is one result from Search: the record, its blended score and which
// retrieval legs matched it ("fts", "vec").
type SearchHit struct {
	Record MemoryRecord `json:"record"`
	Score  float64      `json:"score"`
	Via    []string     `json:"via"`
}

// AddInput is the body for Add (POST /memories). Type, Scope, Body and Provenance
// are required by the daemon; Add fills Provenance.Source with "agent" when it is
// left empty. Optional scalar fields are pointers so a caller can send an explicit
// zero (for example Salience 0) rather than have it dropped.
type AddInput struct {
	Type       string     `json:"type"`
	Scope      string     `json:"scope"`
	Body       string     `json:"body"`
	Provenance Provenance `json:"provenance"`
	ScopePath  *string    `json:"scope_path,omitempty"`
	Title      *string    `json:"title,omitempty"`
	Summary    *string    `json:"summary,omitempty"`
	Tags       []string   `json:"tags,omitempty"`
	DedupKey   *string    `json:"dedup_key,omitempty"`
	Salience   *float64   `json:"salience,omitempty"`
	Confidence *float64   `json:"confidence,omitempty"`
	Decay      *Decay     `json:"decay,omitempty"`
	Links      []string   `json:"links,omitempty"`
}

// SearchInput is the body for Search (POST /search). Only Query is required.
type SearchInput struct {
	Query string   `json:"query"`
	Limit *int     `json:"limit,omitempty"`
	Scope string   `json:"scope,omitempty"`
	Types []string `json:"types,omitempty"`
}

// ListInput filters List (GET /memories). Empty fields are omitted from the query.
type ListInput struct {
	Scope  string
	Type   string
	Status string
}

// Health is the GET /health response.
type Health struct {
	Status        string `json:"status"`
	VectorEnabled bool   `json:"vectorEnabled"`
	Count         int    `json:"count"`
}
