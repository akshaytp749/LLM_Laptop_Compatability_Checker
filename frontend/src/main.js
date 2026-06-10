import './style.css';
import Chart from 'chart.js/auto';
import {
  CONTEXT_PRESETS,
  evaluateModel,
  formatTokensPerSec,
  kvCacheGb,
} from './calc.js';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const SETTINGS_KEY = 'llm-checker-simulator';

const state = {
  quantBits: 4,
  ctxIdx: 1,
  hw: null, // hardware_limits from the backend
  ollama: null,
  models: [], // raw specs from /api/models
  searchResults: [], // raw specs from /api/search_model
};

let statsInterval = null;
let historyChart = null;

// ---------------------------------------------------------------------------
// Safe DOM construction (no innerHTML with dynamic data anywhere)
// ---------------------------------------------------------------------------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function tooltip(text, wide = false) {
  return el('span', { class: wide ? 'tooltip tooltip-wide' : 'tooltip' }, text);
}

function infoLabel(labelText, tipText) {
  return el(
    'span',
    { class: 'stat-label info-wrapper' },
    `${labelText} `,
    el('span', { class: 'info-icon' }, '?'),
    tooltip(tipText)
  );
}

// ---------------------------------------------------------------------------
// Simulator settings persistence
// ---------------------------------------------------------------------------
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isInteger(saved.quantBits) && saved.quantBits >= 2 && saved.quantBits <= 8) {
      state.quantBits = saved.quantBits;
    }
    if (Number.isInteger(saved.ctxIdx) && saved.ctxIdx >= 0 && saved.ctxIdx < CONTEXT_PRESETS.length) {
      state.ctxIdx = saved.ctxIdx;
    }
  } catch {
    /* corrupted settings - use defaults */
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ quantBits: state.quantBits, ctxIdx: state.ctxIdx }));
}

// ---------------------------------------------------------------------------
// Dashboard bootstrap
// ---------------------------------------------------------------------------
async function initDashboard() {
  try {
    const hwRes = await fetch(`${API_BASE}/hardware`);
    const hwData = await hwRes.json();
    state.hw = hwData.hardware_limits;
    state.ollama = hwData.ollama;
    renderHardware(hwData);
    renderOllama(hwData.ollama);
    initChart(hwData.gpu.has_gpu);

    pollSystemStats();
    if (statsInterval) clearInterval(statsInterval);
    statsInterval = setInterval(pollSystemStats, 2000);
  } catch {
    const status = document.getElementById('hardware-status');
    clear(status);
    status.append(
      el('p', { style: 'color:var(--danger)' }, 'Failed to connect to the local Python backend. Ensure it is running on port 5000.')
    );
  }

  try {
    const modelsRes = await fetch(`${API_BASE}/models`);
    const modelsData = await modelsRes.json();
    state.hw = modelsData.hardware_limits;
    state.models = modelsData.models;
    rerenderModelLists();
  } catch {
    const list = document.getElementById('models-list');
    list.className = '';
    clear(list);
    list.append(el('p', { style: 'color:var(--danger)' }, 'Could not load the model list from the backend.'));
  }
}

async function refreshHardwareAndModels() {
  const [hwRes, modelsRes] = await Promise.all([
    fetch(`${API_BASE}/hardware`),
    fetch(`${API_BASE}/models`),
  ]);
  const hwData = await hwRes.json();
  const modelsData = await modelsRes.json();
  state.hw = modelsData.hardware_limits;
  state.ollama = hwData.ollama;
  state.models = modelsData.models;
  renderHardware(hwData);
  renderOllama(hwData.ollama);
  rerenderModelLists();
}

// ---------------------------------------------------------------------------
// Live stats + history chart
// ---------------------------------------------------------------------------
async function pollSystemStats() {
  try {
    const res = await fetch(`${API_BASE}/system_stats`);
    const stats = await res.json();

    const updateBar = (id, percent) => {
      const bar = document.getElementById(`${id}-bar`);
      const val = document.getElementById(`${id}-val`);
      if (!bar || !val) return;
      bar.style.width = `${percent}%`;
      val.textContent = `${percent.toFixed(1)}%`;
      let color = 'var(--success)';
      if (percent > 85) color = 'var(--danger)';
      else if (percent > 65) color = 'var(--warning)';
      bar.style.backgroundColor = color;
      bar.style.color = color; // drives the currentColor glow
    };

    updateBar('stat-cpu', stats.cpu_percent);
    updateBar('stat-ram', stats.ram_percent);
    updateBar('stat-vram', stats.gpu_percent);

    if (historyChart) {
      const now = new Date();
      const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      historyChart.data.labels.push(timeStr);
      historyChart.data.datasets[0].data.push(stats.cpu_percent);
      historyChart.data.datasets[1].data.push(stats.ram_percent);
      if (historyChart.data.datasets[2]) historyChart.data.datasets[2].data.push(stats.gpu_percent);

      if (historyChart.data.labels.length > 30) {
        historyChart.data.labels.shift();
        historyChart.data.datasets.forEach((dataset) => dataset.data.shift());
      }
      historyChart.update('none');
    }
  } catch {
    /* transient polling error - ignore */
  }
}

function initChart(hasGpu) {
  const ctx = document.getElementById('historyChart');
  if (!ctx) return;

  const makeDataset = (label, color, bg) => ({
    label,
    data: [],
    borderColor: color,
    backgroundColor: bg,
    borderWidth: 2,
    tension: 0.4,
    fill: true,
  });

  const datasets = [
    makeDataset('CPU %', '#6366f1', 'rgba(99, 102, 241, 0.1)'),
    makeDataset('RAM %', '#f59e0b', 'rgba(245, 158, 11, 0.1)'),
  ];
  if (hasGpu) datasets.push(makeDataset('VRAM %', '#10b981', 'rgba(16, 185, 129, 0.1)'));

  Chart.defaults.color = '#a1a1b0';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  historyChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { min: 0, max: 100, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 5 } },
      },
      plugins: { legend: { position: 'top' } },
    },
  });
}

// ---------------------------------------------------------------------------
// Hardware + Ollama panels
// ---------------------------------------------------------------------------
function statRow(label, value, valueStyle) {
  return el(
    'div',
    { class: 'stat-row' },
    typeof label === 'string' ? el('span', { class: 'stat-label' }, label) : label,
    el('span', { class: 'stat-value', style: valueStyle }, value)
  );
}

function renderHardware(data) {
  const container = document.getElementById('hardware-status');
  container.className = '';
  clear(container);

  const gpu = data.gpu;
  const vramText = gpu.has_gpu
    ? `${gpu.total_vram_gb} GB (${gpu.free_vram_gb} GB free)`
    : 'None (Using CPU RAM)';

  container.append(
    statRow('OS', `${data.system.os} ${data.system.os_release}`),
    statRow(
      infoLabel('CPU Cores', 'Physical cores are actual hardware; Logical cores are virtual threads for better multitasking. AI usually prefers physical cores.'),
      `${data.system.cpu_cores_physical} Physical / ${data.system.cpu_cores_logical} Logical`
    ),
    statRow(
      infoLabel('System RAM', "Standard computer memory. If a model doesn't fit in VRAM, it 'spills over' to RAM, making it run much slower (CPU offloading)."),
      `${data.system.total_ram_gb} GB (${data.system.available_ram_gb} GB free)`
    ),
    statRow('GPU', gpu.gpu_name),
    statRow(
      infoLabel('Video RAM (VRAM)', 'Dedicated memory on your Graphics Card (GPU). Highly critical for AI. You want the model entirely in VRAM for lightning-fast speeds.'),
      vramText,
      'color:var(--primary)'
    )
  );

  const liveStats = el('div', { class: 'live-stats-container', id: 'live-stats' });
  const addLiveStat = (name, id, marginTop) => {
    liveStats.append(
      el(
        'div',
        { class: 'live-stat-header', style: marginTop ? 'margin-top:0.75rem;' : '' },
        el('span', {}, name),
        el('span', { id: `${id}-val` }, '--%')
      ),
      el(
        'div',
        { class: 'resource-bar-container' },
        el('div', { id: `${id}-bar`, class: 'resource-bar', style: 'width:0%; background-color: var(--primary)' })
      )
    );
  };
  addLiveStat('CPU Usage', 'stat-cpu', false);
  addLiveStat('RAM Usage', 'stat-ram', true);
  if (gpu.has_gpu) addLiveStat('VRAM Usage', 'stat-vram', true);
  container.append(liveStats);
}

function renderOllama(ollamaData) {
  const container = document.getElementById('ollama-status');
  clear(container);

  if (ollamaData.is_running) {
    container.append(
      el('div', { class: 'status-line ok' }, '✅ Ollama is running locally!'),
      el('p', { class: 'text-muted text-sm', style: 'margin: 0;' },
        ollamaData.installed_models.length ? 'Installed models:' : 'No models installed yet.')
    );
    const list = el('div', { class: 'ollama-models' });
    for (const model of ollamaData.installed_models) {
      list.append(
        el(
          'div',
          { class: 'ollama-model-row' },
          el('span', {}, model.name),
          el(
            'span',
            { class: 'row-meta' },
            el('span', { class: 'model-size' }, `${model.size_gb} GB`),
            el(
              'button',
              {
                class: 'btn-icon-danger',
                title: `Delete ${model.name}`,
                onclick: () => handleDeleteModel(model.name),
              },
              '🗑️'
            )
          )
        )
      );
    }
    container.append(list);
  } else if (ollamaData.is_installed) {
    container.append(
      el('div', { class: 'status-line warn' }, '⚠️ Ollama is installed but not running.'),
      el('p', { class: 'text-muted text-sm', style: 'margin-top: 0.5rem;' }, 'Please start the Ollama application on your machine.')
    );
  } else {
    container.append(
      el('div', { class: 'status-line err' }, '❌ Ollama not detected.'),
      el(
        'p',
        { class: 'text-muted text-sm', style: 'margin-top: 0.5rem;' },
        'For the easiest local LLM experience, download it from ',
        el('a', { href: 'https://ollama.com', target: '_blank', class: 'link-primary' }, 'ollama.com'),
        '.'
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Model cards
// ---------------------------------------------------------------------------
const TIER_TOOLTIPS = {
  gpu: 'Fits entirely in GPU VRAM! This will run incredibly fast.',
  offload: 'Too big for VRAM alone. Ollama will split it between GPU and system RAM - it works, but generation is slower.',
  cpu: 'No dedicated GPU detected; runs fully on CPU and system RAM. Works, but expect slow generation.',
  none: 'Exceeds your combined VRAM + RAM. The application will crash if you try to run this.',
};

function rerenderModelLists() {
  if (!state.hw) return;
  renderModels(state.models, document.getElementById('models-list'), true);
  if (state.searchResults.length) {
    renderModels(state.searchResults, document.getElementById('search-results-container'), false);
  }
}

function renderModels(rawModels, container, doSort) {
  if (!container) return;
  container.className = '';
  clear(container);

  const ctxTokens = CONTEXT_PRESETS[state.ctxIdx].tokens;
  let models = rawModels.map((m) => evaluateModel(m, state.hw, state.quantBits, ctxTokens));

  if (doSort) {
    const order = { gpu: 0, offload: 1, cpu: 1, none: 2 };
    models = models.sort((a, b) => order[a.tier] - order[b.tier]);
  }

  for (const model of models) container.append(buildModelCard(model, rawModels));
}

function buildModelCard(model, rawModels) {
  const limit = model.tier === 'gpu' ? state.hw.vram_total_gb : state.hw.vram_total_gb + state.hw.ram_total_gb;
  const percent = Math.min(100, (model.memory_required_gb / Math.max(limit, 1)) * 100);
  const barColor = model.status_color === 'green' ? 'var(--success)' : model.status_color === 'yellow' ? 'var(--warning)' : 'var(--danger)';

  const ctxTokens = CONTEXT_PRESETS[state.ctxIdx].tokens;
  const kvGb = kvCacheGb(model.params_b, ctxTokens);
  const tpsText = formatTokensPerSec(model.tokens_per_sec);

  const badge = el(
    'div',
    { class: `badge ${model.status_color} info-wrapper` },
    model.compatibility,
    tooltip(TIER_TOOLTIPS[model.tier])
  );

  const header = el(
    'div',
    { class: 'model-header' },
    el(
      'a',
      {
        class: 'model-name model-link',
        href: `https://huggingface.co/${encodeURI(model.id)}`,
        target: '_blank',
        title: 'View on HuggingFace',
      },
      model.name,
      model.source === 'trending' ? ' 🔥' : ''
    ),
    badge
  );

  const paramsRow = el(
    'div',
    { class: 'stat-row', style: 'border:none; padding-bottom:0;' },
    infoLabel('Parameters', 'The size of the AI\'s "brain" network in billions (B). More parameters generally mean smarter AI, but require more memory.'),
    el(
      'span',
      { class: 'stat-value info-wrapper' },
      `${model.params_b}B INT${state.quantBits} `,
      el('span', { class: 'info-icon' }, 'i'),
      tooltip(`Calculation assumes ${state.quantBits}-bit quantization, as configured in the simulator.`)
    )
  );

  const memoryRow = el(
    'div',
    { class: 'stat-row', style: 'border:none; padding-top:0; padding-bottom:0;' },
    infoLabel('Memory Required', `Weights plus ~${kvGb.toFixed(1)} GB KV cache for the ${CONTEXT_PRESETS[state.ctxIdx].label} context window, as configured above.`),
    el('span', { class: 'stat-value' }, `${model.memory_required_gb.toFixed(1)} GB`)
  );

  const speedRow = el(
    'div',
    { class: 'stat-row', style: 'border:none; padding-top:0;' },
    infoLabel('Est. Speed', 'Rough generation speed based on typical memory bandwidth. Reading speed is ~5-10 tok/s; below that feels sluggish.'),
    el('span', { class: 'stat-value' }, tpsText || '—')
  );

  const bar = el(
    'div',
    { class: 'vram-bar-container' },
    el('div', { class: 'vram-bar', style: `width: ${percent}%; background-color: ${barColor}; color: ${barColor}` })
  );

  return el('div', { class: 'model-card' }, header, paramsRow, memoryRow, speedRow, bar, buildCommandBox(model, rawModels));
}

function buildCommandBox(model, rawModels) {
  if (!model.fits) {
    return el('div', { class: 'cmd-box blocked' }, 'Requires a hardware upgrade to run natively.');
  }

  if (model.is_installed) {
    return el(
      'div',
      { class: 'cmd-box ready' },
      el(
        'div',
        { class: 'cmd-row' },
        el('span', {}, `✅ Ready! Run: ${model.run_command}`),
        el(
          'button',
          {
            class: 'btn-danger-outline',
            onclick: () => handleDeleteModel(model.ollama_cmd, model, rawModels),
          },
          '🗑️ Delete'
        )
      )
    );
  }

  const progress = el('div', { class: 'dl-progress' });
  const buttons = el(
    'div',
    { class: 'cmd-actions' },
    el(
      'button',
      {
        class: 'btn-ghost',
        onclick: () => navigator.clipboard.writeText(model.run_command),
      },
      'Copy'
    )
  );

  const ollamaRunning = state.ollama ? state.ollama.is_running : false;
  if (ollamaRunning) {
    const dlBtn = el('button', { class: 'btn-download' }, '⬇️ Download');
    dlBtn.addEventListener('click', () => handleDownloadModel(model, rawModels, dlBtn, progress));
    buttons.append(dlBtn);
  }

  return el(
    'div',
    { class: 'cmd-box stacked' },
    el('div', { class: 'cmd-row' }, el('span', {}, `> ${model.run_command}`), buttons),
    progress
  );
}

// ---------------------------------------------------------------------------
// Ollama actions
// ---------------------------------------------------------------------------
async function handleDownloadModel(model, rawModels, dlBtn, progress) {
  dlBtn.disabled = true;
  dlBtn.textContent = 'Starting...';
  progress.style.display = 'block';
  progress.textContent = 'Connecting to Ollama...';

  const fail = (message) => {
    progress.textContent = message;
    progress.style.color = 'var(--danger)';
    dlBtn.disabled = false;
    dlBtn.textContent = '⬇️ Retry Download';
  };

  try {
    const response = await fetch(`${API_BASE}/ollama/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.ollama_cmd }),
    });
    if (!response.ok) throw new Error('Network response was not ok');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffered = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop(); // keep any partial trailing line for the next chunk

      for (const line of lines) {
        if (!line) continue;
        let data;
        try {
          data = JSON.parse(line);
        } catch {
          continue;
        }
        if (data.error) {
          fail(`Error: ${data.error}`);
          return;
        }
        if (data.status) {
          let text = data.status;
          if (data.total && data.completed) {
            text += ` - ${Math.round((data.completed / data.total) * 100)}%`;
          }
          progress.textContent = text;
          if (data.status === 'success') {
            dlBtn.textContent = '✅ Done';
            const ref = rawModels.find((m) => m.id === model.id);
            if (ref) ref.is_installed = true;
            setTimeout(async () => {
              rerenderModelLists();
              try {
                const hwRes = await fetch(`${API_BASE}/hardware`);
                const hwData = await hwRes.json();
                state.ollama = hwData.ollama;
                renderOllama(hwData.ollama);
              } catch {
                /* panel refresh is best-effort */
              }
            }, 1000);
          }
        }
      }
    }
  } catch {
    fail('Failed to connect. Is the backend running?');
  }
}

async function handleDeleteModel(ollamaName, model = null, rawModels = null) {
  if (!confirm(`Are you sure you want to delete ${ollamaName}?`)) return;

  try {
    const res = await fetch(`${API_BASE}/ollama/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ollamaName }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(`Error deleting: ${data.error}`);
      return;
    }

    if (model && rawModels) {
      const ref = rawModels.find((m) => m.id === model.id);
      if (ref) ref.is_installed = false;
    }
    const hwRes = await fetch(`${API_BASE}/hardware`);
    const hwData = await hwRes.json();
    state.ollama = hwData.ollama;
    renderOllama(hwData.ollama);

    // Re-sync installed flags from the backend for both lists.
    for (const list of [state.models, state.searchResults]) {
      for (const m of list) {
        if (m.ollama_cmd === ollamaName) m.is_installed = false;
      }
    }
    rerenderModelLists();
  } catch {
    alert('Failed to delete model.');
  }
}

// ---------------------------------------------------------------------------
// Search + autocomplete
// ---------------------------------------------------------------------------
function setupSearchHandler() {
  const searchBtn = document.getElementById('model-search-btn');
  const searchInput = document.getElementById('model-search-input');
  const resultsContainer = document.getElementById('search-results-container');
  const suggestions = document.getElementById('model-suggestions');

  searchBtn.addEventListener('click', async () => {
    const modelId = searchInput.value.trim().replace(/\s+/g, '');
    if (!modelId) return;

    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';
    resultsContainer.style.display = 'block';
    clear(resultsContainer);
    resultsContainer.append(el('div', { class: 'loading' }, 'Querying HuggingFace... this may take a second'));

    try {
      const res = await fetch(`${API_BASE}/search_model?model_id=${encodeURIComponent(modelId)}`);
      const data = await res.json();
      if (data.error) {
        clear(resultsContainer);
        resultsContainer.append(el('div', { class: 'error-box' }, `Error: ${data.error}`));
        state.searchResults = [];
      } else {
        state.searchResults = [data];
        renderModels(state.searchResults, resultsContainer, false);
      }
    } catch {
      clear(resultsContainer);
      resultsContainer.append(el('div', { style: 'color:var(--danger);' }, 'Failed to connect to backend for search.'));
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Check Compatibility';
    }
  });

  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchBtn.click();
  });

  // Autocomplete (debounced) backed by the HuggingFace search API.
  let debounceTimer = null;
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    clearTimeout(debounceTimer);
    if (query.length < 2) return;
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/search_suggest?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        clear(suggestions);
        for (const id of data.suggestions || []) {
          const option = document.createElement('option');
          option.value = id;
          suggestions.append(option);
        }
      } catch {
        /* suggestions are best-effort */
      }
    }, 300);
  });
}

// ---------------------------------------------------------------------------
// Controls: refresh, benchmark, simulator
// ---------------------------------------------------------------------------
function initRefreshButton() {
  const btn = document.getElementById('refresh-hw-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const icon = btn.querySelector('.icon');
    icon.classList.add('spin');
    btn.disabled = true;

    const hwStatus = document.getElementById('hardware-status');
    clear(hwStatus);
    hwStatus.append(el('div', { class: 'loading' }, 'Refreshing hardware stats...'));
    const ollamaStatus = document.getElementById('ollama-status');
    clear(ollamaStatus);
    ollamaStatus.append(el('div', { class: 'loading' }, 'Checking Ollama...'));

    try {
      await refreshHardwareAndModels();
    } catch {
      clear(hwStatus);
      hwStatus.append(el('p', { style: 'color:var(--danger)' }, 'Refresh failed. Is the backend running?'));
    } finally {
      icon.classList.remove('spin');
      btn.disabled = false;
    }
  });
}

function initBenchmarkButton() {
  const btn = document.getElementById('run-bench-btn');
  const results = document.getElementById('bench-results');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    clear(btn);
    btn.append(el('span', { class: 'icon spin' }, '↻'), ' Running Stress Test...');
    results.style.display = 'none';
    clear(results);

    try {
      const res = await fetch(`${API_BASE}/benchmark`, { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        results.append(el('div', { style: 'color:var(--danger)' }, `Benchmark failed: ${data.error}`));
      } else {
        let color = 'var(--success)';
        if (data.score < 50) color = 'var(--danger)';
        else if (data.score < 80) color = 'var(--warning)';
        results.append(
          el('div', { class: 'bench-score', style: `color: ${color};` }, String(data.score)),
          el('div', { class: 'bench-score-sub' }, '/ 100 Score'),
          el('div', { class: 'bench-label' }, data.label),
          el('div', { class: 'bench-duration' }, `Completed in ${data.duration_sec}s`)
        );
      }
    } catch {
      results.append(el('div', { style: 'color:var(--danger)' }, 'Could not connect to backend.'));
    } finally {
      results.style.display = 'block';
      btn.disabled = false;
      clear(btn);
      btn.append(el('span', { class: 'icon' }, '🚀'), ' Run Benchmark Again');
    }
  });
}

function initSimulator() {
  const quantSlider = document.getElementById('sim-quant');
  const ctxSlider = document.getElementById('sim-ctx');
  const quantLabel = document.getElementById('quant-val-display');
  const ctxLabel = document.getElementById('ctx-val-display');

  const updateQuantLabel = (val) => {
    if (val <= 3) quantLabel.textContent = `${val}-bit (Tiny/Dumb)`;
    else if (val <= 5) quantLabel.textContent = `${val}-bit (Balanced)`;
    else quantLabel.textContent = `${val}-bit (Heavy/Smart)`;
  };
  const updateCtxLabel = (idx) => {
    ctxLabel.textContent = CONTEXT_PRESETS[idx].label;
  };

  // Restore persisted settings.
  quantSlider.value = String(state.quantBits);
  ctxSlider.value = String(state.ctxIdx);
  updateQuantLabel(state.quantBits);
  updateCtxLabel(state.ctxIdx);

  quantSlider.addEventListener('input', (e) => {
    state.quantBits = parseInt(e.target.value, 10);
    updateQuantLabel(state.quantBits);
    saveSettings();
    rerenderModelLists();
  });
  ctxSlider.addEventListener('input', (e) => {
    state.ctxIdx = parseInt(e.target.value, 10);
    updateCtxLabel(state.ctxIdx);
    saveSettings();
    rerenderModelLists();
  });
}

// ---------------------------------------------------------------------------
loadSettings();
initSimulator();
setupSearchHandler();
initRefreshButton();
initBenchmarkButton();
initDashboard();
