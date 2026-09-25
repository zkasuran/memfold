# SPDX-License-Identifier: Apache-2.0
"""memfold: Python client and framework adapters for the memfold memory daemon.

Framework adapters live under ``memfold.integrations`` and import their target
framework lazily, so importing this package pulls in nothing but ``httpx``.
"""

from __future__ import annotations

from .client import MemfoldClient
from .errors import MemfoldError, MemfoldHTTPError
from .models import Decay, Health, MemoryRecord, Provenance, SearchHit

__version__ = "0.1.0"

__all__ = [
    "MemfoldClient",
    "MemoryRecord",
    "SearchHit",
    "Provenance",
    "Decay",
    "Health",
    "MemfoldError",
    "MemfoldHTTPError",
    "__version__",
]
