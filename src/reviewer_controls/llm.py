"""Minimal client for OpenAI-compatible chat endpoints. Standard library only.

The key is sent in the Authorization header and nowhere else: it is never
logged, never put in an error message, and never written to a result file.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional


class ModelError(RuntimeError):
    pass


@dataclass
class ChatResponse:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    seconds: float = 0.0


class ChatClient:
    """One model behind an OpenAI-compatible /chat/completions endpoint."""

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str,
        timeout: float = 180.0,
        max_retries: int = 4,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries

    def __repr__(self) -> str:  # keep the key out of any debug output
        return "ChatClient(base_url={!r}, model={!r})".format(self.base_url, self.model)

    def complete(self, system: str, user: str, temperature: float = 0.0, max_tokens: int = 4000) -> ChatResponse:
        payload = json.dumps(
            {
                "model": self.model,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + "/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + self._api_key},
            method="POST",
        )

        last_error = "no attempt made"
        for attempt in range(self.max_retries + 1):
            started = time.time()
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    body = json.loads(response.read().decode("utf-8"))
                usage = body.get("usage") or {}
                return ChatResponse(
                    text=body["choices"][0]["message"]["content"] or "",
                    prompt_tokens=int(usage.get("prompt_tokens") or 0),
                    completion_tokens=int(usage.get("completion_tokens") or 0),
                    seconds=time.time() - started,
                )
            except urllib.error.HTTPError as error:
                last_error = "HTTP {} from {}".format(error.code, self.base_url)
                if error.code not in (408, 409, 429, 500, 502, 503, 504):
                    raise ModelError(last_error)
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                last_error = "cannot reach {}: {}".format(self.base_url, getattr(error, "reason", error))
            except (KeyError, IndexError, ValueError):
                raise ModelError("unexpected response shape from {}".format(self.base_url))
            if attempt < self.max_retries:
                time.sleep(min(30.0, 2.0 * (2 ** attempt)))
        raise ModelError("{} (after {} attempts)".format(last_error, self.max_retries + 1))


def extract_json(text: str) -> Any:
    """Parse the first JSON object or array in a model reply, ignoring prose and code fences."""
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character in "{[":
            try:
                value, _ = decoder.raw_decode(text[index:])
                return value
            except ValueError:
                continue
    raise ModelError("the model reply contained no JSON")


def as_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
