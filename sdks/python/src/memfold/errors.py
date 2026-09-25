# SPDX-License-Identifier: Apache-2.0
"""Exceptions raised by the memfold client."""

from __future__ import annotations


class MemfoldError(Exception):
    """Base class for every error raised by this package."""


class MemfoldHTTPError(MemfoldError):
    """Raised on any non-2xx response from the memfold daemon.

    Carries the HTTP status, the request method and URL, and the raw response
    body so a caller can inspect what the daemon reported.
    """

    def __init__(self, status: int, method: str, url: str, body: str) -> None:
        self.status = status
        self.method = method
        self.url = url
        self.body = body
        super().__init__(f"memfold: {method} {url} -> {status}: {body[:200]}")
