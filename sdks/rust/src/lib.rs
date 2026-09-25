// SPDX-License-Identifier: Apache-2.0

//! Thin blocking Rust client for the memfold daemon REST API.
//!
//! memfold stores each durable fact, preference, decision or note once, as a
//! Memory Record, and projects it into whatever native format each AI coding
//! tool reads. This crate is a small, blocking HTTP client for the local
//! memfold daemon. Create a [`Client`] with a base URL and an optional bearer
//! token, then call [`Client::health`], [`Client::add`], [`Client::search`],
//! [`Client::get`], [`Client::list`] or [`Client::forget`].
//!
//! ```no_run
//! use memfold::{Client, AddInput, Provenance};
//!
//! let client = Client::new("http://127.0.0.1:7777").with_token("secret");
//! let input = AddInput::new("fact", "project", "The datastore is PostgreSQL 16.",
//!     Provenance::new("agent"));
//! let record = client.add(input)?;
//! println!("stored {}", record.id);
//! # Ok::<(), memfold::MemfoldError>(())
//! ```

use serde::{Deserialize, Serialize};
use ureq::RequestBuilder;

/// A blocking client for one memfold daemon.
#[derive(Debug, Clone)]
pub struct Client {
    base_url: String,
    token: Option<String>,
    agent: ureq::Agent,
}

impl Client {
    /// Create a client pointing at a daemon base URL, for example
    /// `http://127.0.0.1:7777`. Any trailing slash is trimmed.
    pub fn new(base_url: impl Into<String>) -> Self {
        Client {
            base_url: normalize_base(base_url.into()),
            token: None,
            agent: ureq::Agent::new_with_defaults(),
        }
    }

    /// Attach a bearer token, sent as `Authorization: Bearer <token>` on every
    /// request.
    pub fn with_token(mut self, token: impl Into<String>) -> Self {
        self.token = Some(token.into());
        self
    }

    /// `GET /health` -> daemon liveness, whether vector search is enabled and
    /// the current record count.
    pub fn health(&self) -> Result<Health, MemfoldError> {
        let url = format!("{}/health", self.base_url);
        let mut resp = self.auth(self.agent.get(&url)).call()?;
        Ok(resp.body_mut().read_json()?)
    }

    /// `POST /memories` -> create a record and return it as stored (HTTP 201).
    pub fn add(&self, input: AddInput) -> Result<MemoryRecord, MemfoldError> {
        let url = format!("{}/memories", self.base_url);
        let mut resp = self.auth(self.agent.post(&url)).send_json(&input)?;
        Ok(resp.body_mut().read_json()?)
    }

    /// `POST /search` -> ranked hits for a query.
    pub fn search(&self, input: SearchInput) -> Result<Vec<SearchHit>, MemfoldError> {
        let url = format!("{}/search", self.base_url);
        let mut resp = self.auth(self.agent.post(&url)).send_json(&input)?;
        Ok(resp.body_mut().read_json()?)
    }

    /// `GET /memories/{id}` -> the record, or `Ok(None)` when the daemon
    /// answers 404.
    pub fn get(&self, id: &str) -> Result<Option<MemoryRecord>, MemfoldError> {
        let url = format!("{}/memories/{}", self.base_url, encode_segment(id));
        match self.auth(self.agent.get(&url)).call() {
            Ok(mut resp) => Ok(Some(resp.body_mut().read_json()?)),
            Err(ureq::Error::StatusCode(404)) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// `GET /memories` -> records filtered by the optional `scope`, `type` and
    /// `status` query parameters.
    pub fn list(&self, input: ListInput) -> Result<Vec<MemoryRecord>, MemfoldError> {
        let url = format!("{}/memories", self.base_url);
        let mut req = self.auth(self.agent.get(&url));
        if let Some(scope) = &input.scope {
            req = req.query("scope", scope);
        }
        if let Some(kind) = &input.r#type {
            req = req.query("type", kind);
        }
        if let Some(status) = &input.status {
            req = req.query("status", status);
        }
        let mut resp = req.call()?;
        Ok(resp.body_mut().read_json()?)
    }

    /// `DELETE /memories/{id}` -> tombstone the record (HTTP 204).
    pub fn forget(&self, id: &str) -> Result<(), MemfoldError> {
        let url = format!("{}/memories/{}", self.base_url, encode_segment(id));
        self.auth(self.agent.delete(&url)).call()?;
        Ok(())
    }

    /// Apply the bearer token, when configured, to any request builder.
    fn auth<A>(&self, req: RequestBuilder<A>) -> RequestBuilder<A> {
        match &self.token {
            Some(token) => req.header("Authorization", format!("Bearer {token}")),
            None => req,
        }
    }
}

/// Response of `GET /health`.
#[derive(Debug, Clone, Deserialize)]
pub struct Health {
    /// Liveness marker, for example `"ok"`.
    pub status: String,
    /// Whether the daemon has vector search enabled.
    #[serde(rename = "vectorEnabled", default)]
    pub vector_enabled: bool,
    /// Number of records the daemon is serving.
    #[serde(default)]
    pub count: u64,
}

/// A memfold Memory Record as returned by the daemon.
///
/// Fields the daemon may omit are defaulted on parse, and unknown fields are
/// ignored so a newer daemon does not break an older client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRecord {
    /// Stable identity across every version of this record (ULID).
    pub id: String,
    /// This version's id (ULID).
    pub rev: String,
    /// Record format version (always 1 for this schema).
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    /// Memory kind: fact, preference, decision, convention, episodic, task or entity.
    pub r#type: String,
    /// Scope: global, project, dir or session.
    pub scope: String,
    /// Repo or directory path the scope binds to; null for global.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_path: Option<String>,
    /// Short human label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Markdown content; the unit of `content_hash`.
    pub body: String,
    /// One-line form emitted into compiled rules files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Freeform labels (CRDT OR-set).
    #[serde(default)]
    pub tags: Vec<String>,
    /// sha256 of `body`, in the form `sha256:<64 hex>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    /// Where the record came from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
    /// Importance weight for ranking, 0..1.
    #[serde(default = "default_salience")]
    pub salience: f64,
    /// Trust in the fact, 0..1.
    #[serde(default = "default_confidence")]
    pub confidence: f64,
    /// First creation time of the `id` (RFC 3339).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Time of this version (RFC 3339).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Lifecycle state: active, archived or tombstone.
    #[serde(default = "default_status")]
    pub status: String,
    /// Hybrid logical clock `wallMs:counter:nodeId` driving merge order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hlc: Option<String>
}

/// Where a record came from. `source` is required; the rest are optional.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provenance {
    /// One of: user, agent, tool, import, consolidation.
    pub source: String,
    /// Originating tool, for example `claude-code` or `cursor`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    /// Session the record was produced in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Human author, where known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Model that wrote it, where the source is an agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Source URL or citation key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cite: Option<String>,
}

impl Provenance {
    /// A provenance with just the required `source`.
    pub fn new(source: impl Into<String>) -> Self {
        Provenance {
            source: source.into(),
            tool: None,
            session_id: None,
            author: None,
            model: None,
            cite: None,
        }
    }
}

/// One ranked hit from `POST /search`.
#[derive(Debug, Clone, Deserialize)]
pub struct SearchHit {
    /// The matched record.
    pub record: MemoryRecord,
    /// Relevance score assigned by the daemon.
    pub score: f64,
    /// How the hit was found, for example `fts`, `vector` or `hybrid`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub via: Option<String>,
}

/// Body of `POST /memories`. Optional fields are omitted from the JSON when
/// unset.
#[derive(Debug, Clone, Serialize)]
pub struct AddInput {
    /// Memory kind: fact, preference, decision, convention, episodic, task or entity.
    pub r#type: String,
    /// Scope: global, project, dir or session.
    pub scope: String,
    /// Markdown content.
    pub body: String,
    /// Where the record comes from (`source` required).
    pub provenance: Provenance,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salience: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

impl AddInput {
    /// A new record input with only the required fields set.
    pub fn new(
        r#type: impl Into<String>,
        scope: impl Into<String>,
        body: impl Into<String>,
        provenance: Provenance,
    ) -> Self {
        AddInput {
            r#type: r#type.into(),
            scope: scope.into(),
            body: body.into(),
            provenance,
            scope_path: None,
            title: None,
            summary: None,
            tags: Vec::new(),
            salience: None,
            confidence: None,
        }
    }

    /// Set the scope path (repo or directory the scope binds to).
    pub fn scope_path(mut self, path: impl Into<String>) -> Self {
        self.scope_path = Some(path.into());
        self
    }
    /// Set a short human title.
    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }
    /// Set a one-line summary.
    pub fn summary(mut self, summary: impl Into<String>) -> Self {
        self.summary = Some(summary.into());
        self
    }
    /// Replace the tag set.
    pub fn tags<I, S>(mut self, tags: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.tags = tags.into_iter().map(Into::into).collect();
        self
    }
    /// Set the salience (importance weight, 0..1).
    pub fn salience(mut self, salience: f64) -> Self {
        self.salience = Some(salience);
        self
    }
    /// Set the confidence (trust in the fact, 0..1).
    pub fn confidence(mut self, confidence: f64) -> Self {
        self.confidence = Some(confidence);
        self
    }
}

/// Body of `POST /search`. Optional fields are omitted from the JSON when
/// unset.
#[derive(Debug, Clone, Serialize)]
pub struct SearchInput {
    /// The query text.
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub types: Option<Vec<String>>,
}

impl SearchInput {
    /// A search with just the query text.
    pub fn new(query: impl Into<String>) -> Self {
        SearchInput {
            query: query.into(),
            limit: None,
            scope: None,
            types: None,
        }
    }
    /// Cap the number of hits returned.
    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }
    /// Restrict to a single scope.
    pub fn scope(mut self, scope: impl Into<String>) -> Self {
        self.scope = Some(scope.into());
        self
    }
    /// Restrict to a set of record types.
    pub fn types<I, S>(mut self, types: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.types = Some(types.into_iter().map(Into::into).collect());
        self
    }
}

/// Query parameters for `GET /memories`. All optional; unset filters are not
/// sent.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ListInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

impl ListInput {
    /// Filter by scope.
    pub fn scope(mut self, scope: impl Into<String>) -> Self {
        self.scope = Some(scope.into());
        self
    }
    /// Filter by record type.
    pub fn r#type(mut self, kind: impl Into<String>) -> Self {
        self.r#type = Some(kind.into());
        self
    }
    /// Filter by lifecycle status.
    pub fn status(mut self, status: impl Into<String>) -> Self {
        self.status = Some(status.into());
        self
    }
}

/// Everything that can go wrong talking to the daemon.
#[derive(Debug)]
pub enum MemfoldError {
    /// Transport failure: DNS, connection, TLS or timeout.
    Http(String),
    /// The daemon returned a non-success HTTP status.
    Api {
        /// The HTTP status code.
        status: u16,
    },
    /// A response body could not be parsed as the expected JSON.
    Parse(String),
}

impl std::fmt::Display for MemfoldError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemfoldError::Http(msg) => write!(f, "http transport error: {msg}"),
            MemfoldError::Api { status } => {
                write!(f, "daemon returned error status {status}")
            }
            MemfoldError::Parse(msg) => write!(f, "failed to parse daemon response: {msg}"),
        }
    }
}

impl std::error::Error for MemfoldError {}

impl From<ureq::Error> for MemfoldError {
    fn from(err: ureq::Error) -> Self {
        match err {
            ureq::Error::StatusCode(status) => MemfoldError::Api { status },
            ureq::Error::Json(json) => MemfoldError::Parse(json.to_string()),
            other => MemfoldError::Http(other.to_string()),
        }
    }
}

fn normalize_base(mut base: String) -> String {
    while base.ends_with('/') {
        base.pop();
    }
    base
}

/// Percent-encode a single URL path segment, leaving RFC 3986 unreserved
/// characters untouched. Record ids are ULIDs, so this is belt-and-braces.
fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for &byte in segment.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn default_schema_version() -> u32 {
    1
}
fn default_salience() -> f64 {
    0.5
}
fn default_confidence() -> f64 {
    1.0
}
fn default_status() -> String {
    "active".to_string()
}
