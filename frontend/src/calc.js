// Memory and speed estimation for local LLM inference.
// All numbers are estimates for GGUF-style quantized inference (llama.cpp/Ollama).

export const CONTEXT_PRESETS = [
  { label: '2K (Chat)', tokens: 2048 },
  { label: '8K (Standard)', tokens: 8192 },
  { label: '32K (Docs)', tokens: 32768 },
  { label: '64K (Codebase)', tokens: 65536 },
  { label: '128K (Books)', tokens: 131072 },
];

// Effective memory bandwidth assumptions (GB/s) for the tokens/sec estimate.
// Generation speed is memory-bound: each token streams the full weights once.
const GPU_BANDWIDTH_GBPS = 250; // mid-range consumer dGPU / Apple Silicon
const CPU_BANDWIDTH_GBPS = 40; // dual-channel DDR4/DDR5

// Weights size: params * bits/8, plus ~10% for runtime buffers and activations.
export function weightsGb(paramsB, quantBits) {
  return ((paramsB * quantBits) / 8) * 1.1;
}

// KV cache (fp16 K+V). Reference point: Llama-3-8B with GQA uses
// 2 * 32 layers * 8 KV heads * 128 head-dim * 2 bytes = 128 KiB per token.
// Layer count and width grow roughly with the square root of parameter count,
// so we scale the per-token cost by sqrt(params / 8).
export function kvCacheGb(paramsB, ctxTokens) {
  const bytesPerToken = 131072 * Math.sqrt(paramsB / 8);
  return (ctxTokens * bytesPerToken) / 1024 ** 3;
}

export function totalMemoryGb(paramsB, quantBits, ctxTokens) {
  return weightsGb(paramsB, quantBits) + kvCacheGb(paramsB, ctxTokens);
}

// Compatibility tiers:
//   gpu     - fits entirely in VRAM (fast)
//   offload - GPU machine, spills into system RAM (works, slower)
//   cpu     - no GPU, fits in system RAM (slow)
//   none    - exceeds all available memory
// hw: { has_gpu, vram_total_gb, vram_free_gb, ram_total_gb, ram_free_gb }
export function evaluateCompatibility(requiredGb, hw) {
  if (hw.has_gpu && hw.vram_total_gb > 0) {
    if (requiredGb <= hw.vram_total_gb) {
      return { tier: 'gpu', label: 'Excellent (Fits in VRAM)', color: 'green', fits: true };
    }
    if (requiredGb <= hw.vram_total_gb + hw.ram_total_gb) {
      return { tier: 'offload', label: 'Partial Offload (GPU + RAM)', color: 'yellow', fits: true };
    }
  } else if (requiredGb <= hw.ram_total_gb) {
    return { tier: 'cpu', label: 'Runnable (CPU Only)', color: 'yellow', fits: true };
  }
  return { tier: 'none', label: "Won't Fit", color: 'red', fits: false };
}

// Rough generation speed (tokens/sec). Time per token = bytes read / bandwidth,
// with offloaded layers read at CPU RAM speed.
export function estimateTokensPerSec(paramsB, quantBits, tier, hw) {
  const wGb = (paramsB * quantBits) / 8; // weights actually streamed per token
  if (wGb <= 0) return 0;

  if (tier === 'gpu') return GPU_BANDWIDTH_GBPS / wGb;
  if (tier === 'cpu') return CPU_BANDWIDTH_GBPS / wGb;
  if (tier === 'offload') {
    const gpuFrac = Math.min(1, Math.max(0, hw.vram_total_gb / wGb));
    const secPerToken =
      (gpuFrac * wGb) / GPU_BANDWIDTH_GBPS + ((1 - gpuFrac) * wGb) / CPU_BANDWIDTH_GBPS;
    return 1 / secPerToken;
  }
  return 0;
}

export function formatTokensPerSec(tps) {
  if (!tps || tps <= 0) return null;
  if (tps >= 10) return `~${Math.round(tps)} tok/s`;
  return `~${tps.toFixed(1)} tok/s`;
}

// Full per-model evaluation used by every list in the UI.
export function evaluateModel(model, hw, quantBits, ctxTokens) {
  const requiredGb = totalMemoryGb(model.params_b, quantBits, ctxTokens);
  const compat = evaluateCompatibility(requiredGb, hw);
  const tps = compat.fits ? estimateTokensPerSec(model.params_b, quantBits, compat.tier, hw) : 0;
  return {
    ...model,
    memory_required_gb: requiredGb,
    compatibility: compat.label,
    status_color: compat.color,
    tier: compat.tier,
    fits: compat.fits,
    tokens_per_sec: tps,
  };
}
