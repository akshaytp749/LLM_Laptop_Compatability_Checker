from flask import Flask, jsonify, request
from flask_cors import CORS
import psutil
import platform
import subprocess
import requests
import json
import logging
import time
import math
from functools import lru_cache

try:
    import pynvml
    HAS_NVML = True
except ImportError:
    HAS_NVML = False

app = Flask(__name__)
# Enable CORS for all domains on /api routes
CORS(app, resources={r"/api/*": {"origins": "*"}})

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def get_gpu_info():
    """Extract GPU information using pynvml if available."""
    gpu_data = {
        "has_gpu": False,
        "gpu_name": "None Detected",
        "total_vram_gb": 0.0,
        "free_vram_gb": 0.0
    }

    if HAS_NVML:
        try:
            pynvml.nvmlInit()
            device_count = pynvml.nvmlDeviceGetCount()
            if device_count > 0:
                handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                name = pynvml.nvmlDeviceGetName(handle)
                
                gpu_data["has_gpu"] = True
                gpu_data["gpu_name"] = name if isinstance(name, str) else name.decode('utf-8')
                gpu_data["total_vram_gb"] = round(info.total / (1024**3), 2)
                gpu_data["free_vram_gb"] = round(info.free / (1024**3), 2)
            pynvml.nvmlShutdown()
        except Exception as e:
            logger.error(f"Error reading GPU via NVML: {e}")
            
    return gpu_data

def get_system_info():
    """Extract general system information like CPU and RAM."""
    ram = psutil.virtual_memory()
    
    return {
        "os": platform.system(),
        "os_release": platform.release(),
        "cpu_cores_physical": psutil.cpu_count(logical=False),
        "cpu_cores_logical": psutil.cpu_count(logical=True),
        "total_ram_gb": round(ram.total / (1024**3), 2),
        "available_ram_gb": round(ram.available / (1024**3), 2)
    }

def check_ollama():
    """Check if Ollama is running locally and what models are installed."""
    ollama_status = {
        "is_installed": False,
        "is_running": False,
        "installed_models": []
    }
    
    try:
        # First check API to see if it's running
        response = requests.get("http://localhost:11434/api/tags", timeout=2)
        if response.status_code == 200:
            ollama_status["is_running"] = True
            ollama_status["is_installed"] = True
            data = response.json()
            ollama_status["installed_models"] = [model['name'] for model in data.get('models', [])]
    except requests.exceptions.RequestException:
        # If API fails, see if CLI exists at all (maybe just not running)
        try:
            result = subprocess.run(["ollama", "--version"], capture_output=True, text=True, timeout=2)
            if result.returncode == 0:
                ollama_status["is_installed"] = True
        except FileNotFoundError:
            pass
            
    return ollama_status

@app.route('/api/hardware', methods=['GET'])
def get_hardware_status():
    """Endpoint to get complete hardware and backend status."""
    return jsonify({
        "system": get_system_info(),
        "gpu": get_gpu_info(),
        "ollama": check_ollama()
    })

@app.route('/api/system_stats', methods=['GET'])
def get_system_stats():
    """Endpoint to get live utilization stats for CPU, RAM, and GPU."""
    cpu_percent = psutil.cpu_percent(interval=0.1)
    ram_info = psutil.virtual_memory()
    ram_percent = ram_info.percent
    
    gpu_percent = 0.0
    gpu_info = get_gpu_info()
    if gpu_info["has_gpu"] and gpu_info["total_vram_gb"] > 0:
        used_vram = gpu_info["total_vram_gb"] - gpu_info["free_vram_gb"]
        gpu_percent = round((used_vram / gpu_info["total_vram_gb"]) * 100, 1)

    return jsonify({
        "cpu_percent": cpu_percent,
        "ram_percent": ram_percent,
        "gpu_percent": gpu_percent
    })
    
@app.route('/api/ollama/pull', methods=['POST'])
def pull_ollama_model():
    """Proxy endpoint to stream pulling a model via Ollama API."""
    data = request.json
    model_name = data.get("model")
    if not model_name:
        return jsonify({"error": "No model name provided"}), 400
        
    def generate():
        try:
            # Stream the response from the local Ollama API
            with requests.post("http://localhost:11434/api/pull", json={"name": model_name}, stream=True, timeout=300) as r:
                for line in r.iter_lines():
                    if line:
                        yield line + b'\n'
        except Exception as e:
            yield json.dumps({"error": str(e)}).encode() + b'\n'

    return app.response_class(generate(), mimetype='application/x-ndjson')

@app.route('/api/ollama/delete', methods=['POST'])
def delete_ollama_model():
    """Proxy endpoint to delete a model via Ollama API."""
    data = request.json
    model_name = data.get("model")
    if not model_name:
        return jsonify({"error": "No model name provided"}), 400
        
    try:
        response = requests.delete("http://localhost:11434/api/delete", json={"name": model_name}, timeout=10)
        if response.status_code == 200:
            return jsonify({"success": True})
        else:
            return jsonify({"error": f"Ollama returned {response.status_code}"}), response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/benchmark', methods=['POST'])
def run_benchmark():
    """Run a quick synthetic CPU/RAM benchmark to guess AI token generation readiness."""
    start_time = time.time()
    
    # Synthetic workload: Heavy math computations to stress CPU single-core performance 
    # (which strongly correlates with prompt processing and non-batched inference on CPU)
    v = 0.0
    for i in range(1, 4000000):
        v += math.sqrt(i) * math.sin(i % 100)
        
    end_time = time.time()
    duration = end_time - start_time
    
    # Convert duration to a normalized 0-100 score. 
    # (Tuned such that ~0.4s yields score 90+, ~1.2s yields ~30)
    baseline_fast_sec = 0.4
    
    # Inverse proportional scoring
    raw_score = (baseline_fast_sec / duration) * 100
    score = min(100, max(1, int(raw_score)))
    
    # Heuristic speed label
    if score >= 85:
        speed_label = "Blazing Fast"
    elif score >= 60:
        speed_label = "Good"
    elif score >= 35:
        speed_label = "Passable"
    else:
        speed_label = "Very Slow"
        
    # Check GPU bonus
    gpu_info = get_gpu_info()
    has_gpu = gpu_info.get("has_gpu", False)
    
    if has_gpu and score < 100:
        # GPU carries the score up significantly since AI will offload to it.
        score = min(100, score + 40)
        speed_label = "Accelerated by GPU"

    return jsonify({
        "score": score,
        "label": speed_label,
        "duration_sec": round(duration, 3),
        "has_gpu": has_gpu
    })

def calculate_vram(params_billion, quant_bits=4):
    """
    Calculate VRAM needed for model weights including overhead.
    Formula: ((Params * bits) / 8 bytes) * 1.2 overhead
    """
    base_vram = (params_billion * quant_bits) / 8
    total_vram = base_vram * 1.2 # 20% overhead for context/activations
    return round(total_vram, 2)

@app.route('/api/models', methods=['GET'])
def get_recommended_models():
    """Fetch trending GGUF models from HuggingFace and evaluate compatibility."""
    # We will query the HuggingFace API for popular GGUF models
    # To keep it fast, we'll hardcode a few highly popular bases that are commonly downloaded,
    # but theoretically this could broadly search HF.
    
    # Pre-defined trending architectures with their rough parameter counts (in billions)
    trending_models = [
        {"id": "meta-llama/Meta-Llama-3-8B-Instruct", "name": "Llama 3 (8B)", "params": 8.0, "ollama_cmd": "llama3"},
        {"id": "microsoft/Phi-3-mini-4k-instruct", "name": "Phi-3 Mini (3.8B)", "params": 3.8, "ollama_cmd": "phi3"},
        {"id": "mistralai/Mistral-7B-Instruct-v0.3", "name": "Mistral v0.3 (7B)", "params": 7.0, "ollama_cmd": "mistral"},
        {"id": "google/gemma-2-9b-it", "name": "Gemma 2 (9B)", "params": 9.0, "ollama_cmd": "gemma2"},
        {"id": "Qwen/Qwen2-72B-Instruct", "name": "Qwen2 (72B)", "params": 72.0, "ollama_cmd": "qwen2:72b"},
        {"id": "deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct", "name": "DeepSeek Coder V2 Lite (16B)", "params": 16.0, "ollama_cmd": "deepseek-coder-v2"}
    ]
    
    sys_info = get_system_info()
    gpu_info = get_gpu_info()
    ollama_info = check_ollama()
    
    # Context window cache base (1.5GB)
    CONTEXT_CACHE_GB = 1.5
    
    results = []
    
    for model in trending_models:
        vram_needed = calculate_vram(model["params"], quant_bits=4)
        total_memory_needed = vram_needed + CONTEXT_CACHE_GB
        
        # Determine Compatibility
        fits_in_vram = False
        fits_in_ram = False
        status = "Crash"
        status_color = "red"
        
        if gpu_info["has_gpu"] and total_memory_needed <= gpu_info["total_vram_gb"]:
            fits_in_vram = True
            status = "Excellent (GPU)"
            status_color = "green"
        elif total_memory_needed <= sys_info["total_ram_gb"]:
            fits_in_ram = True
            status = "Runnable (CPU Slow)"
            status_color = "yellow"
            
        # Is it already downloaded in Ollama?
        installed_in_ollama = False
        if ollama_info["is_running"]:
             # Basic fuzzy matching for simplicity
             if any(model["ollama_cmd"] in m for m in ollama_info["installed_models"]):
                 installed_in_ollama = True
                 
        result = {
            "id": model["id"],
            "name": model["name"],
            "parameters_b": model["params"],
            "memory_required_gb": round(total_memory_needed, 2),
            "compatibility": status,
            "status_color": status_color,
            "fits": fits_in_vram or fits_in_ram,
            "is_installed": installed_in_ollama,
            "run_command": f"ollama run {model['ollama_cmd']}"
        }
        results.append(result)
        
    return jsonify({
        "models": results,
        "hardware_limits": {
            "vram": gpu_info["total_vram_gb"],
            "ram": sys_info["total_ram_gb"]
        }
    })

@lru_cache(maxsize=128)
def fetch_hf_model_info(model_id):
    """Fetch and cache model metadata from HuggingFace."""
    hf_url = f"https://huggingface.co/api/models/{model_id}"
    response = requests.get(hf_url, timeout=5)
    
    if response.status_code == 429:
        raise Exception("HuggingFace API rate limit exceeded. Please try again later.")
    elif response.status_code != 200:
        raise Exception(f"Model not found or HuggingFace API error: Status {response.status_code}")
        
    return response.json()

@app.route('/api/search_model', methods=['GET'])
def search_custom_model():
    """Query HuggingFace for a specific model ID and return compatibility."""
    model_id = request.args.get('model_id')
    if not model_id:
        return jsonify({"error": "No model_id provided"}), 400
        
    try:
        data = fetch_hf_model_info(model_id)
        
        # 1. Try to extract exact parameters from Safetensors metadata
        params_billion = None
        safetensors = data.get('safetensors')
        if safetensors and 'total' in safetensors:
            # HuggingFace stores params in raw count (e.g., 8030261248)
            params_billion = round(safetensors['total'] / 1_000_000_000, 2)
            
        # 2. Fallback: Heuristic extraction from the Model ID string (e.g., "7b", "8B", "70b")
        if not params_billion:
            import re
            match = re.search(r'(\d+(?:\.\d+)?)[bB]', model_id)
            if match:
                params_billion = float(match.group(1))
                
        if not params_billion:
             return jsonify({"error": "Could not determine parameter count for this model from metadata or name."}), 400
             
        # Calculate Hardware Constraints
        sys_info = get_system_info()
        gpu_info = get_gpu_info()
        ollama_info = check_ollama()
        
        vram_needed = calculate_vram(params_billion, quant_bits=4)
        CONTEXT_CACHE_GB = 1.5
        total_memory_needed = vram_needed + CONTEXT_CACHE_GB
        
        fits_in_vram = False
        fits_in_ram = False
        status = "Crash"
        status_color = "red"
        
        if gpu_info["has_gpu"] and total_memory_needed <= gpu_info["total_vram_gb"]:
            fits_in_vram = True
            status = "Excellent (GPU)"
            status_color = "green"
        elif total_memory_needed <= sys_info["total_ram_gb"]:
            fits_in_ram = True
            status = "Runnable (CPU Slow)"
            status_color = "yellow"
            
        # Try to guess logical ollama run command based on ID ending
        ollama_guess = f"hf.co/{model_id}"
            
        result = {
            "id": model_id,
            "name": data.get("id", model_id),
            "parameters_b": params_billion,
            "memory_required_gb": round(total_memory_needed, 2),
            "compatibility": status,
            "status_color": status_color,
            "fits": fits_in_vram or fits_in_ram,
            "is_installed": False, # Dynamic search implies likely not natively installed via standard tag
            "ollama_cmd": ollama_guess,
            "run_command": f"ollama run {ollama_guess}"
        }
        
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error fetching model: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5000)
