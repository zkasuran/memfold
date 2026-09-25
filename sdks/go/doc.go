// SPDX-License-Identifier: Apache-2.0

// Package memfold is a thin Go client for the memfold daemon REST API.
//
// memfold is a tool-neutral memory system: one durable fact, preference, decision or
// note is stored once as a MemoryRecord and projected into whatever format each AI
// coding tool reads. This package talks to a running memfold daemon over HTTP.
//
// Create a client with a base URL and, if the daemon requires it, a bearer token:
//
//	c := memfold.NewClient("http://127.0.0.1:7777", memfold.WithToken("secret"))
//
//	rec, err := c.Add(ctx, memfold.AddInput{
//		Type:  "preference",
//		Scope: "project",
//		Body:  "Indent with tabs, not spaces.",
//	})
//
//	hits, err := c.Search(ctx, memfold.SearchInput{Query: "indent"})
//
// Get returns (nil, nil) when a record is absent or tombstoned. Every other non-2xx
// response is returned as an *APIError carrying the status code and the daemon message.
// The client uses only the standard library and is safe for concurrent use.
package memfold
