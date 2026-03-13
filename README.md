<div align="center">
  <h1>🚀 Local LLM Compatibility Checker</h1>
  <p><strong>Your all-in-one Local AI Hub to determine exactly what runs on your hardware.</strong></p>
</div>

---

Have you ever wondered if your laptop can run Llama-3, Qwen, or Mistral natively? **Local LLM Compatibility Checker** scans your system's raw CPU, RAM, and GPU VRAM, then intelligently calculates if popular (and custom) HuggingFace models will fit inside your machine. 

It is designed to be a highly visual, fully interactive dashboard for local AI users.

## ✨ Key Features

*   **🎛️ Interactive VRAM Simulator:** Hardware limits aren't static—they depend on compression! Play with sliders for Quantization (2-bit to 8-bit) and Context Window size, and watch the dashboard recalculate VRAM requirements in real-time natively in your browser.
*   **⚡ 1-Click Ollama Integration:** Found a model that fits? Click "Download" to stream it directly into your local Ollama instance without ever touching a terminal. Need space? Delete installed models directly from the UI.
*   **📈 Live Historical Telemetry:** Watch your system resources via a beautiful, rolling 60-second Chart.js line graph capturing CPU, RAM, and GPU VRAM utilization spikes.
*   **🏎️ AI Readiness Benchmark:** Run a synthetic CPU stress test that times raw mathematical horsepower to generate a personalized "AI Readiness Score" (0-100).
*   **🔍 Custom Model Support:** Paste any HuggingFace Model ID (e.g., `meta-llama/Meta-Llama-3-8B-Instruct`) to instantly calculate parameter memory overhead and compatibility.

## 🛠️ Tech Stack

*   **Frontend:** Vite, HTML/JS, CSS Grid Desktop-Mobile Responsive Design, Chart.js
*   **Backend:** Python 3, Flask, psutil, pynvml (Nvidia bindings), requests

## 📦 Installation & Setup

You have two easy ways to run this dashboard: **Local Execution (Windows)** or **Docker**.

### Method 1: Automated Local Run (Windows Recommended)
We provide batch scripts to handle virtual environments and dependencies automatically.

1. Ensure you have [Python 3](https://www.python.org/downloads/) and [Node.js](https://nodejs.org/) installed on your machine.
2. Ensure you have [Ollama](https://ollama.com/) installed and running in your system tray to use the 1-Click integration.
3. Double-click `install.bat`. This will automatically install the Python requirements (`Flask`, `psutil`, `pynvml`, etc.) and the Node dependencies for Vite.
4. Double-click `start.bat`. This starts the backend, the frontend, and automatically opens your browser to `http://localhost:5173`.

### Method 2: Docker Compose
If you prefer containerized execution, you can spin up the full stack using Docker.

1. Ensure Docker Desktop is installed.
2. Open a terminal in the root directory.
3. Run:
   ```bash
   docker-compose up --build
   ```
4. Navigate to `http://localhost:5173` in your browser.

## 📸 Usage Guide

1. **Dashboard Initialization:** Upon load, the app detects your OS, physical cores, RAM, and GPU memory (If Nvidia drivers are present). It immediately tests communication with Ollama.
2. **Review Trending Models:** A curated list of cutting-edge models (like Phi-3, Gemma 2, and DeepSeek Coder) are evaluated against your hardware.
   *   🟩 **Green:** Fits entirely in VRAM. (Lightning fast).
   *   🟨 **Yellow:** Too big for VRAM, spills into System RAM. (Playable but slower).
   *   🟥 **Red:** Exceeds all memory. (Will crash).
3. **Simulate Compression:** Use the top sliders to adjust quantization. A `4-bit` model requires vastly less RAM than an `8-bit` model but is slightly less accurate. A `128K` Context Window reserves massive chunks of RAM compared to a `2K` chat window. The UI instantly responds to slider changes.
4. **Download & Run:** Click the `⬇️ Download` button to fetch the model via Ollama. Once complete, copy the provided `ollama run <model>` command to your terminal to start chatting!

---
*Created with ❤️ for the open-source AI community.*
