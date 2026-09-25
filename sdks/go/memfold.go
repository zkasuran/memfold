// SPDX-License-Identifier: Apache-2.0

package memfold

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Client is a thin client for the memfold daemon REST API. It is safe for
// concurrent use: it holds only immutable configuration and an *http.Client.
type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

// Option configures a Client in NewClient.
type Option func(*Client)

// WithToken sends token on every request as an "Authorization: Bearer <token>" header.
func WithToken(token string) Option {
	return func(c *Client) { c.token = token }
}

// WithHTTPClient sets the underlying HTTP client, letting a caller control timeouts,
// transports and proxies. A nil client is ignored and the default is kept.
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) {
		if h != nil {
			c.httpClient = h
		}
	}
}

// NewClient returns a Client for the daemon at baseURL (for example
// "http://127.0.0.1:7777"). Trailing slashes on baseURL are trimmed.
func NewClient(baseURL string, opts ...Option) *Client {
	c := &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: http.DefaultClient,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// APIError is returned for any non-2xx daemon response. Message is the daemon's
// "error" field when the body is the daemon's JSON error shape; Body is the raw body.
type APIError struct {
	Method     string
	URL        string
	StatusCode int
	Message    string
	Body       string
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("memfold: %s %s -> %d: %s", e.Method, e.URL, e.StatusCode, e.Message)
	}
	return fmt.Sprintf("memfold: %s %s -> %d", e.Method, e.URL, e.StatusCode)
}

func newAPIError(method, reqURL string, status int, body []byte) *APIError {
	e := &APIError{Method: method, URL: reqURL, StatusCode: status, Body: string(body)}
	var payload struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &payload) == nil {
		e.Message = payload.Error
	}
	return e
}

// do performs an HTTP request against the daemon. body is JSON-encoded when non-nil;
// a 2xx response body is JSON-decoded into out when out is non-nil.
func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("memfold: encode request: %w", err)
		}
		reader = bytes.NewReader(buf)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("memfold: build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("memfold: %s %s: %w", method, req.URL.String(), err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("memfold: read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return newAPIError(method, req.URL.String(), resp.StatusCode, data)
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("memfold: decode response: %w", err)
		}
	}
	return nil
}

// Health reports the daemon status, whether vector search is enabled and the record count.
func (c *Client) Health(ctx context.Context) (*Health, error) {
	var h Health
	if err := c.do(ctx, http.MethodGet, "/health", nil, &h); err != nil {
		return nil, err
	}
	return &h, nil
}

// Add creates a memory record (POST /memories) and returns the stored record. When
// in.Provenance.Source is empty it defaults to "agent".
func (c *Client) Add(ctx context.Context, in AddInput) (*MemoryRecord, error) {
	if in.Provenance.Source == "" {
		in.Provenance.Source = "agent"
	}
	var rec MemoryRecord
	if err := c.do(ctx, http.MethodPost, "/memories", in, &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

// Search runs a hybrid full-text and vector query (POST /search) and returns ranked hits.
func (c *Client) Search(ctx context.Context, in SearchInput) ([]SearchHit, error) {
	var hits []SearchHit
	if err := c.do(ctx, http.MethodPost, "/search", in, &hits); err != nil {
		return nil, err
	}
	return hits, nil
}

// Get fetches a record by id (GET /memories/{id}). It returns (nil, nil) when the
// record does not exist or is tombstoned (404).
func (c *Client) Get(ctx context.Context, id string) (*MemoryRecord, error) {
	var rec MemoryRecord
	err := c.do(ctx, http.MethodGet, "/memories/"+url.PathEscape(id), nil, &rec)
	if err != nil {
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

// List returns records matching in (GET /memories). Empty filter fields are omitted.
func (c *Client) List(ctx context.Context, in ListInput) ([]MemoryRecord, error) {
	q := url.Values{}
	if in.Scope != "" {
		q.Set("scope", in.Scope)
	}
	if in.Type != "" {
		q.Set("type", in.Type)
	}
	if in.Status != "" {
		q.Set("status", in.Status)
	}
	path := "/memories"
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}
	var recs []MemoryRecord
	if err := c.do(ctx, http.MethodGet, path, nil, &recs); err != nil {
		return nil, err
	}
	return recs, nil
}

// Forget deletes a record by id (DELETE /memories/{id}). The daemon tombstones the
// record rather than physically dropping it. A missing record returns an *APIError
// with StatusCode 404.
func (c *Client) Forget(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/memories/"+url.PathEscape(id), nil, nil)
}
