# SPDX-License-Identifier: Apache-2.0
"""Drop-in memory adapters for Python agent frameworks.

Each adapter imports its framework lazily (or not at all, matching the interface
by duck typing), so importing this subpackage never requires the framework to be
installed. Import the adapter you need directly, e.g.::

    from memfold.integrations.langgraph_store import MemfoldStore
"""

from __future__ import annotations
