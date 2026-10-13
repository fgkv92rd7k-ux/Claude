"""Minimal JSON-mode chat client that works with any of: OpenAI-compatible (GPT-6 Astra, any
/v1/chat/completions server), Google Gemini (Gemini 4 Argon), Anthropic (Claude). stdlib only.

    complete_json("openai", "gpt-6-astra", system, user)
    complete_json("gemini", "gemini-4-argon", system, user)
    complete_json("anthropic", "claude-fable-5-1", system, user)

Keys from env: OPENAI_API_KEY / GEMINI_API_KEY (or GOOGLE_API_KEY) / ANTHROPIC_API_KEY.
Base URL overrides: OPENAI_BASE_URL (for any OpenAI-compatible endpoint), GEMINI_BASE_URL, ANTHROPIC_BASE_URL.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

DEFAULT_MODELS = {"openai": "gpt-6-astra", "gemini": "gemini-4-argon", "anthropic": "claude-fable-5-1"}


def _post(url: str, headers: dict, body: dict, timeout: int = 120) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _extract_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start:end + 1]
    return json.loads(text)


def complete_json(provider: str, model: str | None, system: str, user: str, temperature: float = 0.0,
                  api_key: str | None = None, base_url: str | None = None) -> dict:
    provider = (provider or "openai").lower()
    model = model or DEFAULT_MODELS.get(provider)
    if provider in ("openai", "openai-compatible"):
        key = api_key or os.environ.get("OPENAI_API_KEY", "")
        base = (base_url or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com").rstrip("/")
        body = {"model": model, "temperature": temperature, "response_format": {"type": "json_object"},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        out = _post(f"{base}/v1/chat/completions", {"Authorization": f"Bearer {key}"}, body)
        return _extract_json(out["choices"][0]["message"]["content"])
    if provider == "gemini":
        key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
        base = (base_url or os.environ.get("GEMINI_BASE_URL") or "https://generativelanguage.googleapis.com").rstrip("/")
        body = {"systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {"temperature": temperature, "responseMimeType": "application/json"}}
        out = _post(f"{base}/v1beta/models/{model}:generateContent", {"x-goog-api-key": key}, body)
        return _extract_json(out["candidates"][0]["content"]["parts"][0]["text"])
    if provider == "anthropic":
        key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        base = (base_url or os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com").rstrip("/")
        body = {"model": model, "max_tokens": 4096, "temperature": temperature, "system": system,
                "messages": [{"role": "user", "content": user + "\n\nRespond with a single JSON object and nothing else."}]}
        out = _post(f"{base}/v1/messages", {"x-api-key": key, "anthropic-version": "2023-06-01"}, body)
        text = "".join(block.get("text", "") for block in out.get("content", []) if block.get("type") == "text")
        return _extract_json(text)
    raise ValueError(f"unknown provider {provider}")
