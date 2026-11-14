"""Writes the planted variants of a change. Stub.

A planter must be a different model from the reviewer under test, so the
reviewer is not graded on bugs written in its own style.
"""

from __future__ import annotations

from typing import List, Sequence

from .models import KIND_BUG, Change, Plant


class Planter:
    """Interface every planter implements."""

    name = "planter"

    def plant(self, change: Change, count: int, kinds: Sequence[str] = (KIND_BUG,)) -> List[Plant]:
        """Return `count` variants of `change`, one planted edit each.

        Each variant must touch only lines the change itself touched, match the
        surrounding code style, and carry a patch that applies on `head_ref`.
        """
        raise NotImplementedError


class ModelPlanter(Planter):
    """Asks a model (OpenAI-compatible endpoint) to write the variants. Not built yet."""

    name = "model"

    def __init__(self, base_url: str, model: str, api_key: str) -> None:
        self.base_url = base_url
        self.model = model
        self.api_key = api_key

    def plant(self, change: Change, count: int, kinds: Sequence[str] = (KIND_BUG,)) -> List[Plant]:
        raise NotImplementedError("ModelPlanter is not built yet")


class HistoryPlanter(Planter):
    """Re-introduces real past bugs by reversing bug-fix commits. Not built yet."""

    name = "history"

    def plant(self, change: Change, count: int, kinds: Sequence[str] = (KIND_BUG,)) -> List[Plant]:
        raise NotImplementedError("HistoryPlanter is not built yet")
