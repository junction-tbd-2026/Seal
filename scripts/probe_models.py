"""Checks that each configured model answers, and shows the shape of its reply.

Prints addresses, model names and reply structure. Never prints a key.

    PYTHONPATH=src python3 scripts/probe_models.py
"""

import json
import sys
import time
import urllib.error
import urllib.request

from reviewer_controls.config import load_settings, reviewer_prefixes

QUESTION = 'Reply with JSON only: {"ok": true, "sum": <the sum of 2 and 3>}'


def probe(prefix, settings):
    base, model, key = (settings.get(prefix + s) for s in ("_BASE_URL", "_MODEL", "_API_KEY"))
    print("== {}: {} at {}".format(prefix, model, base))
    if not (base and model and key):
        print("   not configured")
        return
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": QUESTION}],
        "temperature": 0.0,
        "max_tokens": 2000,
    }).encode("utf-8")
    request = urllib.request.Request(
        base.rstrip("/") + "/chat/completions", data=payload, method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
    )
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:400].replace(key, "<key>")
        print("   HTTP {} after {:.1f}s: {}".format(error.code, time.time() - started, detail))
        return
    except Exception as error:  # noqa: BLE001 - report anything, this is a diagnostic
        print("   failed after {:.1f}s: {}".format(time.time() - started, str(error).replace(key, "<key>")))
        return

    choice = (body.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    print("   answered in {:.1f}s, finish_reason={}".format(time.time() - started, choice.get("finish_reason")))
    print("   message fields: {}".format(sorted(message.keys())))
    for field in ("content", "reasoning_content", "reasoning"):
        value = message.get(field)
        if value is not None:
            text = value if isinstance(value, str) else json.dumps(value)
            print("   {} ({} chars): {!r}".format(field, len(text), text[:200]))
    print("   usage: {}".format(body.get("usage")))


def main():
    settings = load_settings()
    for prefix in ["PLANTER"] + reviewer_prefixes(settings):
        probe(prefix, settings)
    return 0


if __name__ == "__main__":
    sys.exit(main())
