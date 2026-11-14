"""Honest bounds for small sample counts.

Ten planted bugs cannot give a precise catch rate. These helpers state only
what the numbers support, so the sign-off card never overclaims.
"""

from __future__ import annotations

import math
from typing import Tuple


def wilson_interval(caught: int, total: int, z: float = 1.96) -> Tuple[float, float]:
    """95% Wilson interval for a catch rate of `caught` out of `total`."""
    if total <= 0:
        raise ValueError("total must be positive")
    if not 0 <= caught <= total:
        raise ValueError("caught must be between 0 and total")
    p = caught / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def floor_if_all_caught(total: int, confidence: float = 0.95) -> float:
    """Lowest true catch rate consistent with catching all `total` planted bugs.

    If the true rate were below this, catching every one would happen less than
    (1 - confidence) of the time. 10 -> 0.74, 20 -> 0.86, 30 -> 0.90.
    """
    if total <= 0:
        raise ValueError("total must be positive")
    return (1 - confidence) ** (1 / total)


def plants_needed_for_floor(target_floor: float, confidence: float = 0.95) -> int:
    """How many planted bugs must all be caught to claim at least `target_floor`."""
    if not 0 < target_floor < 1:
        raise ValueError("target_floor must be between 0 and 1")
    return math.ceil(math.log(1 - confidence) / math.log(target_floor))
