# LLM Laptop Compatibility Checker

Local AI hub: detects CPU/RAM/VRAM, estimates which HuggingFace/Ollama models fit, and manages Ollama models from a dashboard.

## Architecture

- `backend/` — Flask API (`app.py`, single file). Serves hardware probes, Ollama proxying (pull/delete), HuggingFace lookups (trending list, model search, autocomplete). Returns **raw model specs only** — no memory math.
- `frontend/` — Vite vanilla-JS app. `src/calc.js` owns ALL memory/compatibility/speed math (weights + KV-cache estimate, GPU/offload/CPU/none tiers, tokens/sec heuristic) so the simulator sliders apply consistently. `src/main.js` renders via safe DOM construction — never use `innerHTML` with dynamic data (XSS).
- Frontend calls relative `/api/...` URLs; the Vite dev-server proxy (vite.config.js) forwards to Flask on 127.0.0.1:5000 (`VITE_PROXY_TARGET` overrides, used in Docker).

## Commands

```sh
# Backend (from backend/; venv lives at backend/venv)
venv\Scripts\python app.py          # run dev server on :5000
venv\Scripts\python -m pytest -q    # tests
venv\Scripts\python -m ruff check . # lint

# Frontend (from frontend/)
npm run dev    # Vite on :5173
npm test       # vitest
npm run lint   # eslint
npm run build
```

Windows one-shot: `install.bat` then `start.bat`. Docker: `docker compose up --build`.

## Config (env vars)

- `OLLAMA_HOST` (default `http://localhost:11434`)
- `PORT` (backend, default 5000), `FLASK_DEBUG=1` to enable debug mode (never default it on — RCE risk on 0.0.0.0)
- `VITE_PROXY_TARGET` (frontend proxy target)

## Conventions

- Pure, testable helpers (`parse_params_from_id`, `is_model_installed`, everything in `calc.js`) stay free of I/O; add tests when touching them (`backend/tests/`, `frontend/tests/`).
- HuggingFace responses are cached with TTLs in-process; Ollama "installed" matching is exact-tag/base-name, not substring.
