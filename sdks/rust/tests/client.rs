// SPDX-License-Identifier: Apache-2.0

//! Integration tests for the memfold client, run against a local mockito
//! server that stubs the daemon. No network beyond localhost is used.

use memfold::{AddInput, Client, ListInput, MemfoldError, Provenance, SearchInput};
use mockito::Matcher;
use serde_json::json;

const ID: &str = "01J9ZK8QAB2C3D4E5F6G7H8J9K"; // ULID-shaped id
const REV: &str = "01J9ZL0MN0P1Q2R3S4T5V6W7X8";

/// A full, valid record as the daemon would return it.
fn sample_record() -> serde_json::Value {
    json!({
        "id": ID,
        "rev": REV,
        "schema_version": 1,
        "type": "fact",
        "scope": "project",
        "scope_path": "/repo",
        "title": "Datastore",
        "body": "The datastore is PostgreSQL 16.",
        "summary": "Postgres 16",
        "tags": ["db", "infra"],
        "content_hash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        "provenance": { "source": "agent", "tool": "claude-code" },
        "salience": 0.8,
        "confidence": 0.95,
        "created_at": "2026-09-20T10:00:00Z",
        "updated_at": "2026-09-20T10:00:00Z",
        "status": "active",
        "hlc": "001758452700000:000001:node-a"
    })
}

#[test]
fn add_posts_correct_json_parses_record_and_sends_token() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("POST", "/memories")
        .match_header("authorization", "Bearer sk-test")
        .match_body(Matcher::Json(json!({
            "type": "fact",
            "scope": "project",
            "body": "The datastore is PostgreSQL 16.",
            "provenance": { "source": "agent", "tool": "claude-code" },
            "tags": ["db"],
            "salience": 0.8
        })))
        .with_status(201)
        .with_header("content-type", "application/json")
        .with_body(sample_record().to_string())
        .create();

    let client = Client::new(server.url()).with_token("sk-test");
    let provenance = {
        let mut p = Provenance::new("agent");
        p.tool = Some("claude-code".to_string());
        p
    };
    let input = AddInput::new("fact", "project", "The datastore is PostgreSQL 16.", provenance)
        .tags(["db"])
        .salience(0.8);

    let rec = client.add(input).expect("add should succeed");
    mock.assert();

    assert_eq!(rec.id, ID);
    assert_eq!(rec.rev, REV);
    assert_eq!(rec.r#type, "fact");
    assert_eq!(rec.scope, "project");
    assert_eq!(rec.tags, vec!["db".to_string(), "infra".to_string()]);
    assert_eq!(rec.salience, 0.8);
    assert_eq!(rec.confidence, 0.95);
    assert_eq!(rec.provenance.unwrap().tool.as_deref(), Some("claude-code"));
}

#[test]
fn search_parses_hits() {
    let mut server = mockito::Server::new();
    let body = json!([
        { "record": sample_record(), "score": 0.91, "via": "vector" },
        { "record": sample_record(), "score": 0.42, "via": "fts" }
    ]);
    let mock = server
        .mock("POST", "/search")
        .match_body(Matcher::Json(json!({ "query": "postgres", "limit": 5 })))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(body.to_string())
        .create();

    let client = Client::new(server.url());
    let hits = client
        .search(SearchInput::new("postgres").limit(5))
        .expect("search should succeed");
    mock.assert();

    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].score, 0.91);
    assert_eq!(hits[0].via.as_deref(), Some("vector"));
    assert_eq!(hits[0].record.r#type, "fact");
    assert_eq!(hits[1].via.as_deref(), Some("fts"));
}

#[test]
fn get_maps_404_to_none() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("GET", "/memories/missing-id")
        .with_status(404)
        .with_body(r#"{"error":{"code":"not_found"}}"#)
        .create();

    let client = Client::new(server.url());
    let got = client.get("missing-id").expect("404 should be Ok(None)");
    mock.assert();
    assert!(got.is_none());
}

#[test]
fn get_returns_record() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("GET", "/memories/01ID")
        .with_status(200)
        .with_body(sample_record().to_string())
        .create();

    let client = Client::new(server.url());
    let got = client.get("01ID").expect("get ok").expect("record present");
    mock.assert();
    assert_eq!(got.id, ID);
    assert_eq!(got.status, "active");
}

#[test]
fn health_sends_bearer_when_configured() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("GET", "/health")
        .match_header("authorization", "Bearer top-secret")
        .with_status(200)
        .with_body(json!({ "status": "ok", "vectorEnabled": true, "count": 12 }).to_string())
        .create();

    let client = Client::new(server.url()).with_token("top-secret");
    let health = client.health().expect("health should succeed");
    mock.assert();
    assert_eq!(health.status, "ok");
    assert!(health.vector_enabled);
    assert_eq!(health.count, 12);
}

#[test]
fn no_authorization_header_without_token() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("GET", "/health")
        .match_header("authorization", Matcher::Missing)
        .with_status(200)
        .with_body(json!({ "status": "ok", "vectorEnabled": false, "count": 0 }).to_string())
        .create();

    let client = Client::new(server.url());
    client.health().expect("health should succeed");
    mock.assert();
}

#[test]
fn forget_issues_delete() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("DELETE", "/memories/01ID")
        .match_header("authorization", "Bearer k")
        .with_status(204)
        .create();

    let client = Client::new(server.url()).with_token("k");
    client.forget("01ID").expect("forget should succeed");
    mock.assert();
}

#[test]
fn list_sends_query_filters() {
    let mut server = mockito::Server::new();
    let mock = server
        .mock("GET", "/memories")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("scope".into(), "project".into()),
            Matcher::UrlEncoded("type".into(), "convention".into()),
            Matcher::UrlEncoded("status".into(), "active".into()),
        ]))
        .with_status(200)
        .with_body(json!([sample_record()]).to_string())
        .create();

    let client = Client::new(server.url());
    let input = ListInput::default()
        .scope("project")
        .r#type("convention")
        .status("active");
    let records = client.list(input).expect("list should succeed");
    mock.assert();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].id, ID);
}

#[test]
fn server_error_maps_to_api_error() {
    let mut server = mockito::Server::new();
    let _mock = server
        .mock("GET", "/health")
        .with_status(500)
        .with_body("boom")
        .create();

    let client = Client::new(server.url());
    match client.health() {
        Err(MemfoldError::Api { status }) => assert_eq!(status, 500),
        other => panic!("expected Api error, got {other:?}"),
    }
}
