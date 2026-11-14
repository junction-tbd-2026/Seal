"""Calls the AI reviewer under test. Stub.

Rules the implementation must keep, or the test is invalid:
- every variant is reviewed in a fresh session, as a complete change;
- the reviewer is never shown the original next to a variant;
- the prompt is the same one used for a normal review, with no hint of a test.
"""

from __future__ import annotations

from typing import Optional

from .models import Change, ReviewResult


class Reviewer:
    """Interface every reviewer implements."""

    name = "reviewer"

    def review(
        self,
        change: Change,
        variant_id: str = "original",
        variant_diff: Optional[str] = None,
        requirement_override: Optional[str] = None,
    ) -> ReviewResult:
        """Review one variant against the requirement.

        `variant_diff` replaces the change's own diff when reviewing a planted
        copy. `requirement_override` is used for the altered-requirement check.
        """
        raise NotImplementedError


class OpenAICompatibleReviewer(Reviewer):
    """Any reviewer reachable through an OpenAI-compatible chat endpoint. Not built yet."""

    def __init__(self, name: str, base_url: str, model: str, api_key: str) -> None:
        self.name = name
        self.base_url = base_url
        self.model = model
        self.api_key = api_key

    def review(
        self,
        change: Change,
        variant_id: str = "original",
        variant_diff: Optional[str] = None,
        requirement_override: Optional[str] = None,
    ) -> ReviewResult:
        raise NotImplementedError("OpenAICompatibleReviewer is not built yet")
