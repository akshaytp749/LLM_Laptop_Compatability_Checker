# LLM Laptop Compatibility Checker

Scans your CPU, RAM, and GPU VRAM to figure out which local LLMs will actually run on your machine. Pulls live trending models from HuggingFace, lets you adjust quantization and context window with sliders, and shows a rough tokens/sec estimate for each model.

Supports 1-click Ollama downloads and shows a live resource monitor so you can see how your hardware holds up.

![compatibility tiers: fits in VRAM / partial offload / CPU only / won't fit]

## Features

- Hardware detection (CPU cores, RAM, NVIDIA VRAM, Apple Silicon unified memory)
- Compatibility tiers — VRAM only, partial GPU offload, CPU only, or won't fit — with a tok/s estimate
- Quantization + context window sliders that recalculate every card in real time
- Live trending models from HuggingFace (GGUF), with search and autocomplete for any HF model ID
- 1-click Ollama pull/delete from the dashboard
- Rolling 60-second resource graph (CPU, RAM, VRAM)

## Setup

**Windows (quickest):**

1. Install [Python 3](https://www.python.org/downloads/), [Node.js](https://nodejs.org/), and [Ollama](https://ollama.com/)
2. Run `install.bat`, then `start.bat` — opens at `http://localhost:5173`

**Docker:**

```bash
docker compose up --build
```

Navigate to `http://localhost:5173`. The backend finds your host Ollama via `host.docker.internal`. GPU passthrough requires the NVIDIA Container Toolkit (see commented block in `docker-compose.yml`).

## Config

| Variable | Default | Notes |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | |
| `PORT` | `5000` | Backend |
| `FLASK_DEBUG` | off | Set `1` for dev only |
| `VITE_PROXY_TARGET` | `http://127.0.0.1:5000` | Used by Vite proxy |

## Dev

```bash
# Backend (from backend/)
venv\Scripts\python app.py
venv\Scripts\python -m pytest -q
venv\Scripts\python -m ruff check .

# Frontend (from frontend/)
npm run dev
npm test
npm run lint
```
