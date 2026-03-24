import './style.css'

const API_BASE = 'http://127.0.0.1:5000/api';

// Global state for simulator
window.simState = {
  quantBits: 4,
  contextSizeIdx: 1, // mapping: 0=2k, 1=8k, 2=32k, 3=64k, 4=128k
  modelsDataRaw: []
};

const CONTEXT_MAPPINGS = [
  { label: '2K (Chat)', gb: 0.5 },
  { label: '8K (Standard)', gb: 1.5 },
  { label: '32K (Docs)', gb: 4.5 },
  { label: '64K (Codebase)', gb: 8.5 },
  { label: '128K (Books)', gb: 18.0 }
];

let statsInterval = null;
let historyChart = null;

async function initDashboard() {
  try {
    // 1. Fetch hardware status
    const hwRes = await fetch(`${API_BASE}/hardware`);
    const hwData = await hwRes.json();
    renderHardware(hwData);
    renderOllama(hwData.ollama);

    // 2. Fetch Models
    const modelsRes = await fetch(`${API_BASE}/models`);
    const modelsData = await modelsRes.json();
    window.hardwareLimits = modelsData.hardware_limits;
    window.simState.modelsDataRaw = modelsData.models; // Cache raw models
    window.modelsDataRawBackup = hwData; // Cache to check ollama running state
    
    // Initialize Simulator and initial render
    initSimulator();
    recalculateModels();
    
    // 3. Setup Search Handler
    setupSearchHandler();
    
    // Initialize Chart
    initChart(hwData.gpu.has_gpu);
    
    // 4. Start Polling for Live Stats
    if (statsInterval) clearInterval(statsInterval);
    pollSystemStats(); // fetch immediately
    statsInterval = setInterval(pollSystemStats, 2000);
    
  } catch (error) {
    console.error("Failed to fetch data:", error);
    document.getElementById('hardware-status').innerHTML = `<p style="color:red">Failed to connect to Local Python Backend. Ensure it is running on port 5000.</p>`;
    document.getElementById('models-list').innerHTML = ``;
  }
}

async function pollSystemStats() {
    try {
        const res = await fetch(`${API_BASE}/system_stats`);
        const stats = await res.json();
        
        const updateBar = (id, percent) => {
            const bar = document.getElementById(`${id}-bar`);
            const val = document.getElementById(`${id}-val`);
            if(bar && val) {
                bar.style.width = `${percent}%`;
                val.innerText = `${percent.toFixed(1)}%`;
                
                // Color scaling
                if(percent > 85) bar.style.backgroundColor = 'var(--danger)';
                else if(percent > 65) bar.style.backgroundColor = 'var(--warning)';
                else bar.style.backgroundColor = 'var(--success)';
            }
        };
        
        updateBar('stat-cpu', stats.cpu_percent);
        updateBar('stat-ram', stats.ram_percent);
        updateBar('stat-vram', stats.gpu_percent);
        
        // Update Chart
        if (historyChart) {
            const now = new Date();
            const timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
            
            historyChart.data.labels.push(timeStr);
            historyChart.data.datasets[0].data.push(stats.cpu_percent);
            historyChart.data.datasets[1].data.push(stats.ram_percent);
            
            if (historyChart.data.datasets[2]) {
                historyChart.data.datasets[2].data.push(stats.gpu_percent);
            }
            
            // Keep last 30 data points (60 seconds at 2s polling)
            if (historyChart.data.labels.length > 30) {
                historyChart.data.labels.shift();
                historyChart.data.datasets.forEach(dataset => dataset.data.shift());
            }
            
            historyChart.update('none'); // Update without animation for smoother polling
        }
        
    } catch(e) {
        // silently ignore polling errors
    }
}

function renderHardware(data) {
  const container = document.getElementById('hardware-status');
  container.className = '';
  
  const vramText = data.gpu.has_gpu ? `${data.gpu.total_vram_gb} GB` : 'None (Using CPU RAM)';
  
  container.innerHTML = `
    <div class="stat-row">
      <span class="stat-label">OS</span>
      <span class="stat-value">${data.system.os} ${data.system.os_release}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label info-wrapper">
        CPU Cores 
        <span class="info-icon">?</span>
        <span class="tooltip">Physical cores are actual hardware; Logical cores are virtual threads for better multitasking. AI usually prefers physical cores.</span>
      </span>
      <span class="stat-value">${data.system.cpu_cores_physical} Physical / ${data.system.cpu_cores_logical} Logical</span>
    </div>
    <div class="stat-row">
      <span class="stat-label info-wrapper">
        System RAM 
        <span class="info-icon">?</span>
        <span class="tooltip">Standard computer memory. If a model doesn't fit in VRAM, it 'spills over' to RAM, making it run much slower (CPU offloading).</span>
      </span>
      <span class="stat-value">${data.system.total_ram_gb} GB</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">GPU</span>
      <span class="stat-value">${data.gpu.gpu_name}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label info-wrapper">
        Video RAM (VRAM)
        <span class="info-icon">?</span>
        <span class="tooltip">Dedicated memory on your Graphics Card (GPU). Highly critical for AI. You want the model entirely in VRAM for lightning-fast speeds.</span>
      </span>
      <span class="stat-value" style="color:var(--primary)">${vramText}</span>
    </div>
    <div class="live-stats-container" id="live-stats">
      <div class="live-stat-header"><span>CPU Usage</span><span id="stat-cpu-val">--%</span></div>
      <div class="resource-bar-container"><div id="stat-cpu-bar" class="resource-bar" style="width:0%; background-color: var(--primary)"></div></div>
      
      <div class="live-stat-header" style="margin-top:0.75rem;"><span>RAM Usage</span><span id="stat-ram-val">--%</span></div>
      <div class="resource-bar-container"><div id="stat-ram-bar" class="resource-bar" style="width:0%; background-color: var(--primary)"></div></div>
      
      ${data.gpu.has_gpu ? `
      <div class="live-stat-header" style="margin-top:0.75rem;"><span>VRAM Usage</span><span id="stat-vram-val">--%</span></div>
      <div class="resource-bar-container"><div id="stat-vram-bar" class="resource-bar" style="width:0%; background-color: var(--primary)"></div></div>
      ` : ''}
    </div>
  `;
}

function renderOllama(ollamaData) {
  const container = document.getElementById('ollama-status');
  if (ollamaData.is_running) {
    container.innerHTML = `
      <div style="color: var(--success); font-weight: 600; margin-bottom: 1rem;">✅ Ollama SDK is running locally!</div>
      <p style="color: var(--text-muted); font-size: 0.9em;">Installed Models:</p>
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem;">
        ${ollamaData.installed_models.map(m => `<span style="background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px; font-size: 0.8em">${m}</span>`).join('')}
      </div>
    `;
  } else if (ollamaData.is_installed) {
    container.innerHTML = `
      <div style="color: var(--warning); font-weight: 600;">⚠️ Ollama is installed but not running.</div>
      <p style="color: var(--text-muted); font-size: 0.9em; margin-top: 0.5rem;">Please start the Ollama application on your machine.</p>
    `;
  } else {
    container.innerHTML = `
      <div style="color: var(--danger); font-weight: 600;">❌ Ollama not detected.</div>
      <p style="color: var(--text-muted); font-size: 0.9em; margin-top: 0.5rem;">For the easiest local LLM experience, download it from <a href="https://ollama.com" target="_blank" style="color: var(--primary)">ollama.com</a>.</p>
    `;
  }
}

function renderModels(models, containerId, doSort = false) {
  const container = document.getElementById(containerId);
  container.className = '';
  container.innerHTML = '';
  
  let modelsToRender = [...models];
  
  // Sort models by fits if requested
  if (doSort) {
      modelsToRender = [...models].sort((a,b) => {
          if (a.status_color === 'green' && b.status_color !== 'green') return -1;
          if (b.status_color === 'green' && a.status_color !== 'green') return 1;
          if (a.status_color === 'yellow' && b.status_color === 'red') return -1;
          return 0;
      });
  }

  modelsToRender.forEach(model => {
    // Calculate progress bar logic based on system hardware
    let targetHardwareLimit = model.status_color === 'green' ? window.hardwareLimits.vram : window.hardwareLimits.ram;
    if (!targetHardwareLimit || targetHardwareLimit === 0) targetHardwareLimit = 1; // fallback
    
    let percent = (model.memory_required_gb / targetHardwareLimit) * 100;
    if (percent > 100) percent = 100;
    
    // Command box logic
    let cmdHtml = '';
    
    // We only enable the download button if ollama is running AND the model fits
    const isOllamaRunning = window.modelsDataRawBackup && window.modelsDataRawBackup.ollama ? window.modelsDataRawBackup.ollama.is_running : true; // default true if unsure
    
    if (model.fits) {
        if(model.is_installed) {
            cmdHtml = `
            <div class="cmd-box" style="background: rgba(16, 185, 129, 0.1); color: #34d399; flex-direction: column; gap: 0.5rem;">
               <div style="display:flex; justify-content: space-between; align-items:center;">
                 <span>✅ Ready! Run: ${model.run_command}</span>
                 <button onclick="handleDeleteModel('${model.ollama_cmd}', '${model.id}')" style="background:transparent;border:1px solid #ef4444;color:#ef4444;border-radius:4px;cursor:pointer;padding: 2px 8px;">🗑️ Delete</button>
               </div>
            </div>`;
        } else {
            cmdHtml = `
            <div class="cmd-box" style="flex-direction: column; gap: 0.5rem;">
              <div style="display: flex; justify-content: space-between; align-items:center;">
                <span>> ${model.run_command}</span>
                <div style="display: flex; gap: 0.5rem;">
                    <button onclick="navigator.clipboard.writeText('${model.run_command}')" style="background:transparent;border:1px solid #a78bfa;color:#a78bfa;border-radius:4px;cursor:pointer;padding: 2px 8px;">Copy</button>
                    ${isOllamaRunning ? `<button id="btn-dl-${model.id.replace(/\//g,'-')}" onclick="handleDownloadModel('${model.ollama_cmd || model.id}', '${model.id}')" style="background:var(--primary);border:none;color:white;border-radius:4px;cursor:pointer;padding: 2px 8px; font-weight:bold;">⬇️ Download</button>` : ''}
                </div>
              </div>
              <div id="progress-${model.id.replace(/\//g,'-')}" style="display:none; width:100%; font-size: 0.8em; color: var(--text-muted);"></div>
            </div>`;
        }
    } else {
         cmdHtml = `<div class="cmd-box" style="color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3)">Requires hardware upgrade to run natively.</div>`;
    }

    const card = document.createElement('div');
    card.className = 'model-card';
    card.innerHTML = `
      <div class="model-header">
        <a class="model-name model-link" href="https://huggingface.co/${model.id.replace('hf:', '')}" target="_blank" title="View on HuggingFace">${model.name}</a>
        <div class="badge ${model.status_color} info-wrapper">
            ${model.compatibility}
            ${model.status_color === 'green' ? '<span class="tooltip">Fits entirely in GPU VRAM! This will run incredibly fast.</span>' : ''}
            ${model.status_color === 'yellow' ? '<span class="tooltip">Too big for GPU. Will partially offload to System RAM. It works, but expects slower text generation.</span>' : ''}
            ${model.status_color === 'red' ? '<span class="tooltip">Exceeds total computer memory. The application will crash if you try to run this.</span>' : ''}
        </div>
      </div>
      
      <div class="stat-row" style="border:none; padding-bottom:0;">
        <span class="stat-label info-wrapper">
            Parameters
            <span class="info-icon">?</span>
            <span class="tooltip">The size of the AI's "brain" network in billions (B). More parameters generally mean smarter AI, but requires more RAM.</span>
        </span>
        <span class="stat-value info-wrapper">
            ${model.parameters_b}B INT${window.simState.quantBits}
            <span class="info-icon">i</span>
            <span class="tooltip">Calculation assumes ${window.simState.quantBits}-bit quantization, as configured in the simulator.</span>
        </span>
      </div>
      
      <div class="stat-row" style="border:none; padding-top:0;">
        <span class="stat-label info-wrapper">
            RAM Required
            <span class="info-icon">?</span>
            <span class="tooltip">Total memory needed. Includes ${CONTEXT_MAPPINGS[window.simState.contextSizeIdx].gb}GB reserved overhead for the Context Window, as configured above.</span>
        </span>
        <span class="stat-value">${model.memory_required_gb.toFixed(1)} GB</span>
      </div>
      
      <div class="vram-bar-container">
        <div class="vram-bar" style="width: ${percent}%; background-color: var(--${model.status_color === 'green' ? 'success' : model.status_color === 'yellow' ? 'warning' : 'danger'})"></div>
      </div>
      
      ${cmdHtml}
    `;
    container.appendChild(card);
  });
}

function setupSearchHandler() {
    const searchBtn = document.getElementById('model-search-btn');
    const searchInput = document.getElementById('model-search-input');
    const resultsContainer = document.getElementById('search-results-container');
    
    searchBtn.addEventListener('click', async () => {
        const modelId = searchInput.value.trim().replace(/\s+/g, '');
        if(!modelId) return;
        
        searchBtn.disabled = true;
        searchBtn.innerText = 'Searching...';
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = '<div class="loading">Querying HuggingFace... this may take a second</div>';
        
        try {
            const res = await fetch(`${API_BASE}/search_model?model_id=${encodeURIComponent(modelId)}`);
            const data = await res.json();
            
            if (data.error) {
                 resultsContainer.innerHTML = `<div style="color:var(--danger); padding: 1rem; border: 1px solid var(--danger); border-radius: 8px;">Error: ${data.error}</div>`;
            } else {
                 renderModels([data], 'search-results-container', false);
            }
        } catch (err) {
            resultsContainer.innerHTML = `<div style="color:var(--danger);">Failed to connect to backend for search.</div>`;
        } finally {
            searchBtn.disabled = false;
            searchBtn.innerText = 'Check Compatibility';
        }
    });

    // Allow pressing enter
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
    });
}

function initRefreshButton() {
    const btn = document.getElementById('refresh-hw-btn');
    if (btn) {
        btn.addEventListener('click', async () => {
            const icon = btn.querySelector('.icon');
            icon.classList.add('spin');
            btn.disabled = true;
            
            // Show loading states
            document.getElementById('hardware-status').innerHTML = '<div class="loading">Refreshing hardware stats...</div>';
            document.getElementById('ollama-status').innerHTML = '<div class="loading">Checking Ollama...</div>';
            
            // Re-fetch hardware 
            const hwRes = await fetch(`${API_BASE}/hardware`);
            const hwData = await hwRes.json();
            renderHardware(hwData);
            renderOllama(hwData.ollama);
            
            // Update models list because hardware limits might have changed
            window.hardwareLimits = hwData.hardware_limits;
            recalculateModels();
            
            icon.classList.remove('spin');
            btn.disabled = false;
        });
    }
}

function initBenchmarkButton() {
    const btn = document.getElementById('run-bench-btn');
    const resultsContainer = document.getElementById('bench-results');
    
    if (btn) {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.innerHTML = `<span class="icon spin">↻</span> Running Stress Test...`;
            resultsContainer.style.display = "none";
            
            try {
                const res = await fetch(`${API_BASE}/benchmark`, { method: 'POST' });
                const data = await res.json();
                
                if (data.error) {
                    resultsContainer.innerHTML = `<div style="color:var(--danger)">Benchmark failed: ${data.error}</div>`;
                } else {
                    let color = 'var(--success)';
                    if (data.score < 50) color = 'var(--danger)';
                    else if (data.score < 80) color = 'var(--warning)';
                    
                    resultsContainer.innerHTML = `
                        <div style="font-size: 2.5rem; font-weight: 800; color: ${color}; line-height: 1;">${data.score}</div>
                        <div style="font-size: 0.9rem; color: var(--text-muted); margin-top: 0.25rem;">/ 100 Score</div>
                        <div style="margin-top: 0.5rem; font-weight: 600; color: var(--primary);">${data.label}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem;">Completed in ${data.duration_sec}s</div>
                    `;
                }
            } catch (err) {
                 resultsContainer.innerHTML = `<div style="color:var(--danger)">Could not connect to backend.</div>`;
            } finally {
                resultsContainer.style.display = "block";
                btn.disabled = false;
                btn.innerHTML = `<span class="icon">🚀</span> Run Benchmark Again`;
            }
        });
    }
}

function initSimulator() {
    const quantSlider = document.getElementById('sim-quant');
    const ctxSlider = document.getElementById('sim-ctx');
    const quantLabel = document.getElementById('quant-val-display');
    const ctxLabel = document.getElementById('ctx-val-display');

    const updateQuantLabel = (val) => {
        if(val <= 3) quantLabel.innerText = `${val}-bit (Tiny/Dumb)`;
        else if (val <= 5) quantLabel.innerText = `${val}-bit (Balanced)`;
        else quantLabel.innerText = `${val}-bit (Heavy/Smart)`;
    };

    const updateCtxLabel = (idx) => {
        const item = CONTEXT_MAPPINGS[idx];
        ctxLabel.innerText = `${item.label} - ~${item.gb} GB`;
    };

    quantSlider.addEventListener('input', (e) => {
        window.simState.quantBits = parseInt(e.target.value);
        updateQuantLabel(window.simState.quantBits);
        recalculateModels();
    });

    ctxSlider.addEventListener('input', (e) => {
        window.simState.contextSizeIdx = parseInt(e.target.value);
        updateCtxLabel(window.simState.contextSizeIdx);
        recalculateModels();
    });
}

function recalculateModels() {
    if(!window.simState.modelsDataRaw) return;
    
    const contextGb = CONTEXT_MAPPINGS[window.simState.contextSizeIdx].gb;
    const qBits = window.simState.quantBits;
    
    // Perform JS-side recalculation of VRAM
    const updatedModels = window.simState.modelsDataRaw.map(model => {
        // Base VRAM formula: ((Params * bits) / 8 bytes) * 1.2 overhead
        const baseVram = (model.parameters_b * qBits) / 8;
        const totalVram = (baseVram * 1.2) + contextGb;
        
        let newModel = {...model, memory_required_gb: totalVram};
        
        // Redetermine Compatibility
        newModel.fits = false;
        newModel.compatibility = "Crash";
        newModel.status_color = "red";
        
        const hw = window.hardwareLimits;
        if (hw.vram > 0 && totalVram <= hw.vram) {
            newModel.fits = true;
            newModel.compatibility = "Excellent (GPU)";
            newModel.status_color = "green";
        } else if (hw.ram > 0 && totalVram <= hw.ram) {
            newModel.fits = true;
            newModel.compatibility = "Runnable (CPU)";
            newModel.status_color = "yellow";
        }
        return newModel;
    });
    
    renderModels(updatedModels, 'models-list', true);
}

// Make global so onclick can find them
window.handleDownloadModel = async (ollamaCmd, modelId) => {
    const safeId = modelId.replace(/\//g,'-');
    const dlBtn = document.getElementById(`btn-dl-${safeId}`);
    const progContainer = document.getElementById(`progress-${safeId}`);
    
    if(!dlBtn || !progContainer) return;
    
    dlBtn.disabled = true;
    dlBtn.innerText = "Starting...";
    progContainer.style.display = "block";
    progContainer.innerText = "Connecting to Ollama...";
    
    try {
        const response = await fetch(`${API_BASE}/ollama/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: ollamaCmd })
        });
        
        if(!response.ok) throw new Error("Network response was not ok");
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        
        while(true) {
            const {done, value} = await reader.read();
            if(done) break;
            
            const chunk = decoder.decode(value, {stream:true});
            const lines = chunk.split('\n');
            
            for(let line of lines) {
                if(!line) continue;
                try {
                    const data = JSON.parse(line);
                    if(data.error) {
                         progContainer.innerHTML = `<span style="color:var(--danger)">Error: ${data.error}</span>`;
                         dlBtn.disabled = false;
                         dlBtn.innerText = "⬇️ Retry Download";
                         return;
                    }
                    if(data.status) {
                        let text = data.status;
                        if(data.total && data.completed) {
                            const pct = Math.round((data.completed / data.total) * 100);
                            text += ` - ${pct}%`;
                        }
                        progContainer.innerText = text;
                        if(data.status === "success") {
                            dlBtn.innerText = "✅ Done";
                            // Mark as installed in state and re-render
                            const modelRef = window.simState.modelsDataRaw.find(m => m.id === modelId);
                            if(modelRef) modelRef.is_installed = true;
                            setTimeout(recalculateModels, 1000); // Wait 1s then refresh card
                        }
                    }
                } catch(e) {}
            }
        }
    } catch(err) {
        progContainer.innerHTML = `<span style="color:var(--danger)">Failed to connect. Is backend running?</span>`;
        dlBtn.disabled = false;
        dlBtn.innerText = "⬇️ Retry Download";
    }
};

window.handleDeleteModel = async (ollamaCmd, modelId) => {
    if(!confirm(`Are you sure you want to delete ${ollamaCmd}?`)) return;
    
    try {
        const res = await fetch(`${API_BASE}/ollama/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: ollamaCmd })
        });
        const data = await res.json();
        if(data.success) {
            // Update state and re-render
            const modelRef = window.simState.modelsDataRaw.find(m => m.id === modelId);
            if(modelRef) modelRef.is_installed = false;
            recalculateModels();
            
            // Trigger a background refresh of Ollama status
            const hwRes = await fetch(`${API_BASE}/hardware`);
            const hwData = await hwRes.json();
            renderOllama(hwData.ollama);
        } else {
            alert(`Error deleting: ${data.error}`);
        }
    } catch(err) {
        alert("Failed to delete model.");
    }
};

function initChart(hasGpu) {
    const ctx = document.getElementById('historyChart');
    if (!ctx) return;
    
    // Define datasets
    const datasets = [
        {
            label: 'CPU %',
            data: [],
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            fill: true
        },
        {
            label: 'RAM %',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            fill: true
        }
    ];
    
    if (hasGpu) {
        datasets.push({
            label: 'VRAM %',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            fill: true
        });
    }

    // Fix default font color for Chart.js in dark mode
    Chart.defaults.color = '#94a3b8';
    
    historyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        maxTicksLimit: 5
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                }
            }
        }
    });
}

// Initial load
initDashboard();
initRefreshButton();
initBenchmarkButton();
