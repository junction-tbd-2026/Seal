"""How many requests at once does a model service accept? Sends a few tiny ones in parallel.

    PYTHONPATH=src python3 scripts/probe_concurrency.py REVIEWER2 4

Prints, per batch size, how many requests succeeded, how many were refused, and how long the
batch took. Never prints a key. Each request asks for a one-word answer, so the cost is tiny.
Use the largest batch size with no refusals as <ROLE>_WORKERS in the keys file.
"""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor

from reviewer_controls.config import load_settings
from reviewer_controls.llm import ChatClient, ModelError


def main(role: str, largest: int) -> None:
    settings = load_settings()
    client = ChatClient(
        settings[role + "_BASE_URL"], settings[role + "_MODEL"], settings[role + "_API_KEY"], timeout=120, max_retries=0
    )
    print("{}: {}".format(role, settings[role + "_MODEL"]))

    def ask(_):
        started = time.time()
        try:
            client.complete("Answer with one word.", "Say ok.", temperature=0.0, max_tokens=8)
            return "ok", time.time() - started
        except ModelError as error:
            # A thinking model may spend these few tokens thinking: the service still served the request.
            if "empty answer" in str(error):
                return "ok", time.time() - started
            return str(error)[:120], time.time() - started

    for size in range(1, largest + 1):
        started = time.time()
        with ThreadPoolExecutor(max_workers=size) as pool:
            answers = list(pool.map(ask, range(size)))
        ok = sum(1 for status, _ in answers if status == "ok")
        slowest = max(seconds for _, seconds in answers)
        print("  {} at once: {} ok, {} refused, slowest {:.1f}s, batch {:.1f}s".format(
            size, ok, size - ok, slowest, time.time() - started))
        for status, _ in answers:
            if status != "ok":
                print("    refused: {}".format(status))
        time.sleep(2)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "REVIEWER2", int(sys.argv[2]) if len(sys.argv) > 2 else 4)
