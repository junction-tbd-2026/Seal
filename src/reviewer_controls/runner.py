"""Compiles and tests one variant of the sample repository. Stub.

The sample repository is C#. A laptop without the .NET SDK cannot build it,
so the cloud runner is expected to be the normal path and the local runner a
convenience for machines that have the SDK.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import Change, Plant


@dataclass
class BuildResult:
    plant_id: str
    compiled: bool
    tests_passed: bool
    log_tail: str = ""
    seconds: float = 0.0


class Runner:
    """Interface every runner implements."""

    name = "runner"

    def check(self, change: Change, plant: Plant) -> BuildResult:
        """Apply the plant's patch on the change, build, and run the tests."""
        raise NotImplementedError


class LocalRunner(Runner):
    """Builds with a locally installed .NET SDK. Not built yet."""

    name = "local"

    def check(self, change: Change, plant: Plant) -> BuildResult:
        raise NotImplementedError("LocalRunner is not built yet")


class CloudRunner(Runner):
    """Builds many variants in parallel in cloud sandboxes. Not built yet."""

    name = "cloud"

    def check(self, change: Change, plant: Plant) -> BuildResult:
        raise NotImplementedError("CloudRunner is not built yet")
