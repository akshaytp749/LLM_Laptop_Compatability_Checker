<div align="center">
  <h1>🚀 Local LLM Compatibility Checker</h1>
  <p><strong>Your all-in-one Local AI Hub to determine exactly what runs on your hardware.</strong></p>
</div>

---

Have you ever wondered if your laptop can run Llama-3, Qwen, or Mistral natively? **Local LLM Compatibility Checker** scans your system's raw CPU, RAM, and GPU VRAM, then intelligently calculates if popular (and custom) HuggingFace models will fit inside your machine.

It is designed to be a highly visual, fully interactive dashboard for local AI users.

## ✨ Key Features

*   **🎛️ Interactive VRAM Simulator:** Hardware limits aren't static—they depend on compression! Play with sliders for Quantization (2-bit to 8-bit) and Context Window size, and watch every model card (including search results) recalculate in real time. The KV-cache estimate scales with both context length *and* model size, and your slider settings are remembered between visits.
*   **🚦 Realistic Compatibility Tiers:** Models are graded *Fits in VRAM* (fast), *Partial Offload* (GPU + RAM split — the most common real-world case), *CPU Only*, or *Won't Fit*, with a rough **tokens/sec estimate** for each based on memory bandwidth.
*   **⚡ 1-Click Ollama Integration:** Found a model that fits? Click "Download" to stream it directly into your local Ollama instance without ever touching a terminal. The Ollama panel lists installed models with their sizes and lets you delete them to free space.
*   **📈 Live Historical Telemetry:** Watch your system resources via a rolling 60-second Chart.js line graph capturing CPU, RAM, and GPU VRAM utilization spikes.
*   **🔥 Live Trending Models:** A curated list of proven models is blended with the currently-trending GGUF models from HuggingFace (cached, with offline fallback).
*   **🔍 Custom Model Search with Autocomplete:** Start typing any HuggingFace model name and pick from live suggestions, or paste a full ID (e.g., `meta-llama/Meta-Llama-3-8B-Instruct`) to instantly check compatibility.
*   **🖥️ Multi-GPU & Apple Silicon Aware:** VRAM is summed across NVIDIA GPUs, and Apple Silicon unified memory is detected on macOS.

## 🛠️ Tech Stack

*   **Frontend:** Vite, vanilla HTML/JS, CSS Grid responsive design, Chart.js (npm), Vitest, ESLint
*   **Backend:** Python 3, Flask, psutil, nvidia-ml-py, requests, pytest, Ruff

## 📦 Installation & Setup

You have two easy ways to run this dashboard: **Local Execution (Windows)** or **Docker**.

### Method 1: Automated Local Run (Windows Recommended)
We provide batch scripts to handle virtual environments and dependencies automatically.

1. Ensure you have [Python 3](https://www.python.org/downloads/) and [Node.js](https://nodejs.org/) installed on your machine.
2. Ensure you have [Ollama](https://ollama.com/) installed and running in your system tray to use the 1-Click integration.
3. Double-click `install.bat`. This installs the Python requirements and the Node dependencies for Vite.
4. Double-click `start.bat`. This starts the backend and frontend, waits until the backend responds, then opens your browser at `http://localhost:5173`.

### Method 2: Docker Compose
1. Ensure Docker Desktop is installed.
2. Run from the root directory:
   ```bash
   docker compose up --build
   ```
3. Navigate to `http://localhost:5173`.

> **Docker notes:** the backend reaches your host's Ollama via `host.docker.internal`. GPU detection inside the container requires the NVIDIA Container Toolkit (see the commented block in `docker-compose.yml`); without it, the dashboard falls back to CPU/RAM-only estimates.

## ⚙️ Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Where the backend looks for Ollama |
| `PORT` | `5000` | Backend port |
| `FLASK_DEBUG` | off | Set `1` to enable Flask debug mode (dev only) |
| `VITE_PROXY_TARGET` | `http://127.0.0.1:5000` | Backend address used by the Vite dev proxy |

## 🧪 Development

```bash
# Backend tests & lint (from backend/)
python -m pytest -q
python -m ruff check .

# Frontend tests, lint, build (from frontend/)
npm test
npm run lint
npm run build
```

CI runs all of the above on every pull request via GitHub Actions.

## 📸 Usage Guide

1. **Dashboard Initialization:** Upon load, the app detects your OS, physical cores, RAM (total + free), and GPU memory. It immediately tests communication with Ollama.
2. **Review Models:** Curated and trending models are evaluated against your hardware:
   *   🟩 **Green:** Fits entirely in VRAM (lightning fast).
   *   🟨 **Yellow:** Partial GPU offload or CPU-only (works, but slower — check the tok/s estimate).
   *   🟥 **Red:** Exceeds combined VRAM + RAM (will crash).
3. **Simulate Compression:** Use the sliders to adjust quantization and context window. A `4-bit` model needs vastly less memory than `8-bit`; a `128K` context reserves massive KV-cache compared to a `2K` chat window.
4. **Download & Run:** Click `⬇️ Download` to fetch the model via Ollama, then copy the provided `ollama run <model>` command to start chatting!

---
*Created with ❤️ for the open-source AI community.*
