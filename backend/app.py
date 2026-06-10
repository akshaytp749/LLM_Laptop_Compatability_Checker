import json
import logging
import math
import os
import platform
import re
import subprocess
import threading
import time

import psutil
import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

try:
    import pynvml
    HAS_NVML = True
except ImportError:
    HAS_NVML = False

# ---------------------------------------------------------------------------
# Configuration (overridable via environment variables)
# ---------------------------------------------------------------------------
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
PORT = int(os.environ.get("PORT", "5000"))
DEBUG = os.environ.get("FLASK_DEBUG", "0") == "1"
HF_API = "https://huggingface.co/api"
TRENDING_TTL_SEC = 30 * 60
HF_MODEL_CACHE_TTL_SEC = 10 * 60

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# psutil.cpu_percent(interval=None) keeps its last sample per *thread*, which
# never matches across Flask's request threads, so we track the previous
# system-wide cpu_times sample ourselves and diff against it on each poll.
_cpu_sample_lock = threading.Lock()
_last_cpu_times = psutil.cpu_times()


def system_cpu_percent():
    """Non-blocking system CPU %, measured since the previous call."""
    global _last_cpu_times
    with _cpu_sample_lock:
        now = psutil.cpu_times()
        prev = _last_cpu_times
        _last_cpu_times = now
    total_delta = sum(now) - sum(prev)
    if total_delta <= 0:
        return 0.0
    busy_delta = (sum(now) - now.idle) - (sum(prev) - prev.idle)
    return round(min(100.0, max(0.0, (busy_delta / total_delta) * 100)), 1)

# Curated fallback list: known-good Ollama commands and parameter counts.
CURATED_MODELS = [
    {"id": "meta-llama/Meta-Llama-3-8B-Instruct", "name": "Llama 3 (8B)", "params_b": 8.0, "ollama_cmd": "llama3"},
    {"id": "microsoft/Phi-3-mini-4k-instruct", "name": "Phi-3 Mini (3.8B)", "params_b": 3.8, "ollama_cmd": "phi3"},
    {"id": "mistralai/Mistral-7B-Instruct-v0.3", "name": "Mistral v0.3 (7B)", "params_b": 7.0, "ollama_cmd": "mistral"},
    {"id": "google/gemma-2-9b-it", "name": "Gemma 2 (9B)", "params_b": 9.0, "ollama_cmd": "gemma2"},
    {"id": "Qwen/Qwen2-72B-Instruct", "name": "Qwen2 (72B)", "params_b": 72.0, "ollama_cmd": "qwen2:72b"},
    {"id": "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct", "name": "DeepSeek Coder V2 Lite (16B)", "params_b": 16.0,
     "ollama_cmd": "deepseek-coder-v2"},
]


# ---------------------------------------------------------------------------
# Pure helpers (unit tested in tests/test_helpers.py)
# ---------------------------------------------------------------------------
def parse_params_from_id(model_id):
    """Extract a parameter count in billions from a model ID like 'Qwen2.5-Coder-32B-Instruct'.

    Returns a float or None. Million-scale suffixes (e.g. '350M') are converted.
    """
    if not model_id:
        return None
    # Prefer the last B-suffixed number (IDs like 'Llama-3-8B' put size after version).
    # The lookbehind rejects letter-prefixed numbers so MoE active-params suffixes
    # like the 'A1B' in 'LFM-8B-A1B' don't shadow the total parameter count.
    matches = re.findall(r"(?<![a-zA-Z0-9.])(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z0-9])", model_id)
    if matches:
        return float(matches[-1])
    matches = re.findall(r"(?<![a-zA-Z0-9.])(\d+(?:\.\d+)?)\s*[mM](?![a-zA-Z0-9])", model_id)
    if matches:
        return round(float(matches[-1]) / 1000, 3)
    return None


def is_model_installed(ollama_cmd, installed_names):
    """Check whether an Ollama command matches an installed model tag.

    'llama3' matches 'llama3:latest' but not 'llama3.2:1b'; a command with an
    explicit tag like 'qwen2:72b' only matches that exact tag.
    """
    cmd = (ollama_cmd or "").strip().lower()
    if not cmd:
        return False
    for name in installed_names:
        name = name.lower()
        if ":" in cmd:
            if name == cmd:
                return True
        elif name.split(":")[0] == cmd:
            return True
    return False


# ---------------------------------------------------------------------------
# Hardware probes
# ---------------------------------------------------------------------------
def get_gpu_info():
    """Detect GPUs. NVIDIA via NVML (summed across devices); Apple Silicon via
    unified-memory heuristic. AMD/Intel GPUs are not detected (reported as none)."""
    gpu_data = {
        "has_gpu": False,
        "gpu_type": "none",
        "gpu_name": "None Detected",
        "gpus": [],
        "total_vram_gb": 0.0,
        "free_vram_gb": 0.0,
    }

    if HAS_NVML:
        try:
            pynvml.nvmlInit()
            try:
                names = []
                for i in range(pynvml.nvmlDeviceGetCount()):
                    handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                    info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                    name = pynvml.nvmlDeviceGetName(handle)
                    if not isinstance(name, str):
                        name = name.decode("utf-8")
                    names.append(name)
                    gpu_data["gpus"].append({
                        "name": name,
                        "total_vram_gb": round(info.total / (1024 ** 3), 2),
                        "free_vram_gb": round(info.free / (1024 ** 3), 2),
                    })
                    gpu_data["total_vram_gb"] += info.total / (1024 ** 3)
                    gpu_data["free_vram_gb"] += info.free / (1024 ** 3)
                if names:
                    gpu_data["has_gpu"] = True
                    gpu_data["gpu_type"] = "nvidia"
                    gpu_data["gpu_name"] = " + ".join(names)
                    gpu_data["total_vram_gb"] = round(gpu_data["total_vram_gb"], 2)
                    gpu_data["free_vram_gb"] = round(gpu_data["free_vram_gb"], 2)
            finally:
                pynvml.nvmlShutdown()
            if gpu_data["has_gpu"]:
                return gpu_data
        except Exception as e:
            logger.warning(f"NVML probe failed: {e}")

    # Apple Silicon: GPU shares unified memory. Metal lets the GPU address
    # roughly 70-75% of system RAM, so report that as usable "VRAM".
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        ram = psutil.virtual_memory()
        usable = ram.total * 0.72
        gpu_data.update({
            "has_gpu": True,
            "gpu_type": "apple_unified",
            "gpu_name": "Apple Silicon (Unified Memory)",
            "total_vram_gb": round(usable / (1024 ** 3), 2),
            "free_vram_gb": round(min(usable, ram.available) / (1024 ** 3), 2),
        })

    return gpu_data


def get_system_info():
    ram = psutil.virtual_memory()
    return {
        "os": platform.system(),
        "os_release": platform.release(),
        "cpu_cores_physical": psutil.cpu_count(logical=False),
        "cpu_cores_logical": psutil.cpu_count(logical=True),
        "total_ram_gb": round(ram.total / (1024 ** 3), 2),
        "available_ram_gb": round(ram.available / (1024 ** 3), 2),
    }


def check_ollama():
    """Check if Ollama is reachable and list installed models with sizes."""
    ollama_status = {
        "is_installed": False,
        "is_running": False,
        "host": OLLAMA_HOST,
        "installed_models": [],  # [{name, size_gb}]
    }

    try:
        response = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=2)
        if response.status_code == 200:
            ollama_status["is_running"] = True
            ollama_status["is_installed"] = True
            for model in response.json().get("models", []):
                ollama_status["installed_models"].append({
                    "name": model.get("name", ""),
                    "size_gb": round(model.get("size", 0) / (1024 ** 3), 2),
                })
    except requests.exceptions.RequestException:
        # API unreachable - check if the CLI exists (installed but not running).
        try:
            result = subprocess.run(["ollama", "--version"], capture_output=True, text=True, timeout=2)
            if result.returncode == 0:
                ollama_status["is_installed"] = True
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            pass

    return ollama_status


def hardware_limits():
    sys_info = get_system_info()
    gpu_info = get_gpu_info()
    return {
        "has_gpu": gpu_info["has_gpu"],
        "gpu_type": gpu_info["gpu_type"],
        "vram_total_gb": gpu_info["total_vram_gb"],
        "vram_free_gb": gpu_info["free_vram_gb"],
        "ram_total_gb": sys_info["total_ram_gb"],
        "ram_free_gb": sys_info["available_ram_gb"],
    }


# ---------------------------------------------------------------------------
# HuggingFace integration (with simple TTL caches)
# ---------------------------------------------------------------------------
_trending_cache = {"ts": 0.0, "data": None}
_hf_model_cache = {}  # model_id -> (timestamp, data)


def fetch_trending_models():
    """Fetch trending GGUF text-generation models from HuggingFace.

    Returns a list shaped like CURATED_MODELS entries (params parsed from the
    repo name; entries without a parseable size are skipped). Cached for 30 min.
    Raises on network/API failure - callers fall back to the curated list.
    """
    now = time.time()
    if _trending_cache["data"] is not None and now - _trending_cache["ts"] < TRENDING_TTL_SEC:
        return _trending_cache["data"]

    response = requests.get(
        f"{HF_API}/models",
        params={
            "filter": "gguf",
            "pipeline_tag": "text-generation",
            "sort": "trendingScore",
            "direction": "-1",
            "limit": "20",
        },
        timeout=5,
    )
    response.raise_for_status()

    curated_ids = {m["id"].lower() for m in CURATED_MODELS}
    results = []
    for entry in response.json():
        model_id = entry.get("id") or entry.get("modelId", "")
        if not model_id or model_id.lower() in curated_ids:
            continue
        params_b = parse_params_from_id(model_id)
        if not params_b:
            continue
        results.append({
            "id": model_id,
            "name": model_id.split("/")[-1],
            "params_b": params_b,
            # Ollama can pull GGUF repos straight from HuggingFace.
            "ollama_cmd": f"hf.co/{model_id}",
        })
        if len(results) >= 6:
            break

    _trending_cache["ts"] = now
    _trending_cache["data"] = results
    return results


def fetch_hf_model_info(model_id):
    """Fetch model metadata from HuggingFace with a 10-minute TTL cache."""
    now = time.time()
    cached = _hf_model_cache.get(model_id)
    if cached and now - cached[0] < HF_MODEL_CACHE_TTL_SEC:
        return cached[1]

    response = requests.get(f"{HF_API}/models/{model_id}", timeout=5)
    if response.status_code == 429:
        raise LookupError("HuggingFace API rate limit exceeded. Please try again later.")
    if response.status_code != 200:
        raise LookupError(f"Model not found or HuggingFace API error: Status {response.status_code}")

    data = response.json()
    _hf_model_cache[model_id] = (now, data)
    return data


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/api/hardware", methods=["GET"])
def get_hardware_status():
    return jsonify({
        "system": get_system_info(),
        "gpu": get_gpu_info(),
        "ollama": check_ollama(),
        "hardware_limits": hardware_limits(),
    })


@app.route("/api/system_stats", methods=["GET"])
def get_system_stats():
    """Live utilization stats, non-blocking (CPU % is measured since the
    previous poll, which suits the frontend's 2s polling interval)."""
    gpu_percent = 0.0
    gpu_info = get_gpu_info()
    if gpu_info["has_gpu"] and gpu_info["total_vram_gb"] > 0:
        used_vram = gpu_info["total_vram_gb"] - gpu_info["free_vram_gb"]
        gpu_percent = round((used_vram / gpu_info["total_vram_gb"]) * 100, 1)

    return jsonify({
        "cpu_percent": system_cpu_percent(),
        "ram_percent": psutil.virtual_memory().percent,
        "gpu_percent": gpu_percent,
    })


@app.route("/api/models", methods=["GET"])
def get_recommended_models():
    """Return curated + live-trending model specs and current hardware limits.

    Memory requirements are intentionally NOT computed here - the frontend owns
    that math so the simulator sliders apply consistently everywhere.
    """
    models = list(CURATED_MODELS)
    try:
        models = models + fetch_trending_models()
    except Exception as e:
        logger.warning(f"Trending fetch failed, serving curated list only: {e}")

    ollama_info = check_ollama()
    installed_names = [m["name"] for m in ollama_info["installed_models"]]

    results = []
    for model in models:
        results.append({
            "id": model["id"],
            "name": model["name"],
            "params_b": model["params_b"],
            "ollama_cmd": model["ollama_cmd"],
            "run_command": f"ollama run {model['ollama_cmd']}",
            "is_installed": is_model_installed(model["ollama_cmd"], installed_names),
            "source": "curated" if any(c["id"] == model["id"] for c in CURATED_MODELS) else "trending",
        })

    return jsonify({"models": results, "hardware_limits": hardware_limits()})


@app.route("/api/search_model", methods=["GET"])
def search_custom_model():
    """Look up a specific HuggingFace model ID and return its raw specs."""
    model_id = request.args.get("model_id", "")
    model_id = re.sub(r"\s+", "", model_id)
    if not model_id:
        return jsonify({"error": "No model_id provided"}), 400

    try:
        data = fetch_hf_model_info(model_id)
    except LookupError as e:
        return jsonify({"error": str(e)}), 404
    except requests.exceptions.RequestException as e:
        logger.error(f"HuggingFace request failed: {e}")
        return jsonify({"error": "Could not reach HuggingFace. Check your connection."}), 502

    # Exact parameter count from safetensors metadata, else parse from the ID.
    params_b = None
    safetensors = data.get("safetensors")
    if safetensors and "total" in safetensors:
        params_b = round(safetensors["total"] / 1_000_000_000, 2)
    if not params_b:
        params_b = parse_params_from_id(model_id)
    if not params_b:
        return jsonify({"error": "Could not determine parameter count for this model from metadata or name."}), 422

    ollama_cmd = f"hf.co/{model_id}"
    ollama_info = check_ollama()
    installed_names = [m["name"] for m in ollama_info["installed_models"]]

    return jsonify({
        "id": model_id,
        "name": data.get("id", model_id),
        "params_b": params_b,
        "ollama_cmd": ollama_cmd,
        "run_command": f"ollama run {ollama_cmd}",
        "is_installed": is_model_installed(ollama_cmd, installed_names),
        "source": "search",
    })


@app.route("/api/search_suggest", methods=["GET"])
def search_suggest():
    """Autocomplete: top HuggingFace text-generation models matching a prefix."""
    query = request.args.get("q", "").strip()
    if len(query) < 2:
        return jsonify({"suggestions": []})

    try:
        response = requests.get(
            f"{HF_API}/models",
            params={"search": query, "pipeline_tag": "text-generation", "sort": "downloads", "direction": "-1", "limit": "8"},
            timeout=4,
        )
        response.raise_for_status()
        suggestions = [entry.get("id") or entry.get("modelId", "") for entry in response.json()]
        return jsonify({"suggestions": [s for s in suggestions if s]})
    except requests.exceptions.RequestException:
        return jsonify({"suggestions": []})


@app.route("/api/ollama/pull", methods=["POST"])
def pull_ollama_model():
    """Proxy endpoint to stream pulling a model via the Ollama API."""
    data = request.get_json(silent=True) or {}
    model_name = data.get("model")
    if not model_name:
        return jsonify({"error": "No model name provided"}), 400

    def generate():
        try:
            with requests.post(
                f"{OLLAMA_HOST}/api/pull",
                json={"name": model_name},
                stream=True,
                timeout=(5, 300),
            ) as r:
                for line in r.iter_lines():
                    if line:
                        yield line + b"\n"
        except Exception as e:
            yield json.dumps({"error": str(e)}).encode() + b"\n"

    return app.response_class(generate(), mimetype="application/x-ndjson")


@app.route("/api/ollama/delete", methods=["POST"])
def delete_ollama_model():
    data = request.get_json(silent=True) or {}
    model_name = data.get("model")
    if not model_name:
        return jsonify({"error": "No model name provided"}), 400

    try:
        response = requests.delete(f"{OLLAMA_HOST}/api/delete", json={"name": model_name}, timeout=10)
        if response.status_code == 200:
            return jsonify({"success": True})
        return jsonify({"error": f"Ollama returned {response.status_code}"}), response.status_code
    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/benchmark", methods=["POST"])
def run_benchmark():
    """Synthetic single-core stress test producing a rough 0-100 readiness score.

    Note: this measures Python math throughput, which only loosely correlates
    with inference speed. The per-model tokens/sec estimate in the UI (based on
    memory bandwidth) is the more meaningful number.
    """
    start_time = time.time()
    v = 0.0
    for i in range(1, 4_000_000):
        v += math.sqrt(i) * math.sin(i % 100)
    duration = time.time() - start_time

    # Inverse-proportional scoring tuned so ~0.4s -> 90+, ~1.2s -> ~30.
    baseline_fast_sec = 0.4
    score = min(100, max(1, int((baseline_fast_sec / duration) * 100)))

    if score >= 85:
        speed_label = "Blazing Fast"
    elif score >= 60:
        speed_label = "Good"
    elif score >= 35:
        speed_label = "Passable"
    else:
        speed_label = "Very Slow"

    gpu_info = get_gpu_info()
    has_gpu = gpu_info.get("has_gpu", False)
    if has_gpu and score < 100:
        # Inference offloads to the GPU, so CPU speed matters far less.
        score = min(100, score + 40)
        speed_label = "Accelerated by GPU"

    return jsonify({
        "score": score,
        "label": speed_label,
        "duration_sec": round(duration, 3),
        "has_gpu": has_gpu,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=DEBUG, threaded=True)
