"""Minimal client for OpenAI-compatible chat endpoints. Standard library only.

The key is sent in the Authorization header and nowhere else: it is never
logged, never put in an error message, and never written to a result file.
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

_RECORD_LOCK = threading.Lock()


class ModelError(RuntimeError):
    pass


@dataclass
class ChatResponse:
    text: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    seconds: float = 0.0


class _Refused(Exception):
    """The provider answered, but with an error instead of a reply (for example a concurrency limit)."""


class ChatClient:
    """One model behind an OpenAI-compatible /chat/completions endpoint."""

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str,
        timeout: float = 300.0,
        max_retries: int = 4,
        debug_dir: Optional[str] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries
        self.debug_dir = debug_dir
        self._exchange = 0

    def __repr__(self) -> str:  # keep the key out of any debug output
        return "ChatClient(base_url={!r}, model={!r})".format(self.base_url, self.model)

    def _record(self, system: str, user: str, text: str, thinking: str, finish: Any, usage: Any) -> None:
        """Save one exchange for debugging when a debug folder is set. The key is never written."""
        if not self.debug_dir:
            return
        with _RECORD_LOCK:
            self._exchange += 1
            number = self._exchange
        folder = Path(self.debug_dir)
        folder.mkdir(parents=True, exist_ok=True)
        name = "{}-{:03d}.json".format(re.sub(r"[^A-Za-z0-9]+", "-", self.model).strip("-"), number)
        (folder / name).write_text(
            json.dumps(
                {"model": self.model, "finish_reason": finish, "usage": usage, "system": system,
                 "user": user, "answer": text, "thinking": thinking},
                indent=2,
            )
        )

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
                if isinstance(body, dict) and not body.get("choices"):
                    # Some providers answer "too many requests at once" with an error body instead
                    # of an HTTP error. That is worth waiting for, not a broken reply.
                    detail = body.get("error") or body.get("message") or body.get("detail") or "no choices in the reply"
                    if isinstance(detail, dict):
                        detail = detail.get("message") or json.dumps(detail)[:200]
                    raise _Refused(str(detail).replace(self._api_key, "<key>")[:200])
                usage = body.get("usage") or {}
                choice = body["choices"][0]
                message = choice["message"]
                text = message.get("content") or ""
                thinking = message.get("reasoning") or message.get("reasoning_content") or ""
                finish = choice.get("finish_reason")
                self._record(system, user, text, thinking, finish, usage)
                if not text.strip():
                    raise ModelError(
                        "{} gave an empty answer (finish_reason={}, {} characters of thinking). "
                        "It probably spent the whole reply budget of {} tokens thinking; raise the budget.".format(
                            self.model, finish, len(thinking), max_tokens
                        )
                    )
                return ChatResponse(
                    text=text,
                    prompt_tokens=int(usage.get("prompt_tokens") or 0),
                    completion_tokens=int(usage.get("completion_tokens") or 0),
                    seconds=time.time() - started,
                )
            except _Refused as error:
                last_error = "{} refused the request: {}".format(self.base_url, error)
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


def extract_json(text: str, accept: Optional[Callable[[Any], bool]] = None) -> Any:
    """Parse the JSON answer out of a model reply, ignoring prose and code fences.

    A reply often contains smaller JSON-looking fragments before the answer, such as
    the `[0]` in `items[0]`. `accept` says what the answer looks like; the first value
    that passes is returned. Without it, the first JSON object or array is returned.
    """
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character in "{[":
            try:
                value, _ = decoder.raw_decode(text[index:])
            except ValueError:
                continue
            if accept is None or accept(value):
                return value
    raise ModelError("the model reply contained no usable JSON answer")


def as_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
