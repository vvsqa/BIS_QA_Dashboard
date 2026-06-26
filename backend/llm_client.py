"""Fail-soft Claude wrapper for the QA dashboard.

Turns (system, user, json-schema) into a validated dict — or returns None if anything goes wrong, so
callers always have a deterministic fallback. Nothing here ever raises.

Two backends, tried in order:
  1. Anthropic API   — if ANTHROPIC_API_KEY is set + the `anthropic` SDK is installed (tool-use JSON).
  2. Claude Code CLI — if the `claude` CLI is on PATH (uses the machine's Claude *subscription*, no API
                       key needed — the same path that powers auto test-case creation). Headless
                       `claude -p ... --output-format json`, run from a neutral cwd so it doesn't load
                       the project's CLAUDE.md.

Config (backend/.env or environment):
  ANTHROPIC_API_KEY      enables the API backend (preferred when present)
  COMPLEXITY_LLM_MODEL   API model id            (default claude-sonnet-4-5)
  COMPLEXITY_CLI_MODEL   CLI model alias/id      (default sonnet)
  COMPLEXITY_LLM_BACKEND api | cli | auto        (default auto — API if key, else CLI)
"""
import os
import json
import time
import shutil
import tempfile
import subprocess

_DEFAULT_API_MODEL = os.environ.get("COMPLEXITY_LLM_MODEL", "claude-sonnet-4-5")
_DEFAULT_CLI_MODEL = os.environ.get("COMPLEXITY_CLI_MODEL", "sonnet")
_BACKEND_PREF = os.environ.get("COMPLEXITY_LLM_BACKEND", "auto").lower()
_CLI_PATH = None


def _have_sdk():
    try:
        import anthropic  # noqa: F401
        return True
    except Exception:
        return False


def _api_ready():
    return bool(os.environ.get("ANTHROPIC_API_KEY")) and _have_sdk()


def _cli_path():
    """Locate the Claude Code CLI. The elevated backend may not have `claude` on PATH, so fall back to
    an explicit override (COMPLEXITY_CLAUDE_BIN) and the known npm install location."""
    global _CLI_PATH
    if _CLI_PATH is None:
        cand = os.environ.get("COMPLEXITY_CLAUDE_BIN") or shutil.which("claude") or ""
        if not cand:
            for p in (os.path.expandvars(r"%APPDATA%\npm\claude.CMD"),
                      r"C:\Users\BIS-DB\AppData\Roaming\npm\claude.CMD"):
                if p and os.path.exists(p):
                    cand = p
                    break
        _CLI_PATH = cand
    return _CLI_PATH


def _cli_ready():
    return bool(_cli_path())


def _backend():
    """Which backend to use: 'api', 'cli', or None."""
    if _BACKEND_PREF == "api":
        return "api" if _api_ready() else None
    if _BACKEND_PREF == "cli":
        return "cli" if _cli_ready() else None
    # auto: prefer the API key, fall back to the subscription CLI.
    if _api_ready():
        return "api"
    if _cli_ready():
        return "cli"
    return None


def available():
    """True if either the API key path or the Claude Code CLI path is usable."""
    return _backend() is not None


def cli_available():
    """True if the Claude Code CLI (subscription) path is usable, regardless of the
    global backend preference. Used by on-demand features (e.g. the bug-reporter
    AI polish) that may run even when the broad complexity/perf kill switch is on."""
    return _cli_ready()


def model_name():
    b = _backend()
    if b == "api":
        return _DEFAULT_API_MODEL
    if b == "cli":
        return f"claude-code:{_DEFAULT_CLI_MODEL}"
    return None


def _sys_text(system):
    if isinstance(system, str):
        return system
    if isinstance(system, list):
        return "\n".join(b.get("text", "") for b in system if isinstance(b, dict))
    return str(system or "")


def _extract_json(text):
    """Pull the first JSON object out of a model's text reply (tolerates code fences / stray prose)."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.strip("`")
        if "\n" in t:
            t = t.split("\n", 1)[1]
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        return None
    try:
        return json.loads(t[i:j + 1])
    except Exception:
        return None


# --------------------------------------------------------------------------- API backend
def _complete_api(system, user, schema, tool_name, max_tokens, retries):
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    except Exception:
        return None
    tool = {"name": tool_name, "description": "Emit the structured result.", "input_schema": schema}
    attempt = 0
    while True:
        try:
            resp = client.messages.create(
                model=_DEFAULT_API_MODEL, max_tokens=max_tokens, system=system,
                tools=[tool], tool_choice={"type": "tool", "name": tool_name},
                messages=[{"role": "user", "content": user}])
            for block in (resp.content or []):
                if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == tool_name:
                    inp = getattr(block, "input", None)
                    if isinstance(inp, dict):
                        return inp
            return None
        except Exception as e:
            status = getattr(e, "status_code", None)
            transient = status in (429, 500, 502, 503, 529) or "overload" in str(e).lower() or "rate" in str(e).lower()
            if not transient or attempt >= retries:
                return None
            time.sleep(min(4.0, 1.0 * (2 ** attempt)))
            attempt += 1


# --------------------------------------------------------------------------- CLI backend (subscription)
def _complete_cli(system, user, schema, max_tokens, timeout):
    cli = _cli_path()
    if not cli:
        return None
    prompt = (
        _sys_text(system) + "\n\n" + user +
        "\n\nOutput ONLY minified JSON conforming to this schema, nothing else (no markdown, no code "
        "fence, no commentary):\n" + json.dumps(schema)
    )
    try:
        # Prompt goes on STDIN (not as an arg): the Windows claude.CMD wrapper mangles long multi-line
        # argument values, which silently drops the flags. Neutral cwd so the CLI doesn't load the
        # project's CLAUDE.md; --model keeps cost predictable.
        out = subprocess.run(
            [cli, "-p", "--output-format", "json", "--model", _DEFAULT_CLI_MODEL],
            input=prompt, capture_output=True, text=True, timeout=timeout, cwd=tempfile.gettempdir())
        if out.returncode != 0 or not out.stdout:
            return None
        env = json.loads(out.stdout)
        if env.get("is_error"):
            return None
        return _extract_json(env.get("result") or "")
    except Exception:
        return None


# --------------------------------------------------------------------------- public
def complete_json(system, user, schema, tool_name="emit", max_tokens=1500, retries=2, timeout=150,
                  force_backend=None):
    """Return a dict matching `schema` from Claude (API key path, else Claude Code CLI/subscription),
    or None on ANY failure (never raises).

    force_backend ('api'|'cli') overrides the global COMPLEXITY_LLM_BACKEND preference for this one
    call — lets on-demand features run AI even when the broad kill switch disables the default backend
    (e.g. backend=api with no API key). Falls back to the requested backend's readiness check."""
    b = force_backend or _backend()
    if b == "api" and _api_ready():
        return _complete_api(system, user, schema, tool_name, max_tokens, retries)
    if b == "cli" and _cli_ready():
        return _complete_cli(system, user, schema, max_tokens, timeout)
    return None
