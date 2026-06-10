import { describe, it, expect } from 'vitest';
import {
  weightsGb,
  kvCacheGb,
  totalMemoryGb,
  evaluateCompatibility,
  estimateTokensPerSec,
  formatTokensPerSec,
  evaluateModel,
  CONTEXT_PRESETS,
} from '../src/calc.js';

const GPU_16GB = { has_gpu: true, vram_total_gb: 16, vram_free_gb: 12, ram_total_gb: 32, ram_free_gb: 20 };
const CPU_ONLY_16GB = { has_gpu: false, vram_total_gb: 0, vram_free_gb: 0, ram_total_gb: 16, ram_free_gb: 10 };

describe('weightsGb', () => {
  it('computes 4-bit weights with 10% overhead', () => {
    // 8B params * 4 bits / 8 = 4 GB raw, * 1.1 = 4.4 GB
    expect(weightsGb(8, 4)).toBeCloseTo(4.4, 5);
  });

  it('scales linearly with quantization', () => {
    expect(weightsGb(8, 8)).toBeCloseTo(2 * weightsGb(8, 4), 5);
  });
});

describe('kvCacheGb', () => {
  it('matches the Llama-3-8B reference (~128 KiB/token)', () => {
    // 8192 tokens * 128 KiB = 1 GiB
    expect(kvCacheGb(8, 8192)).toBeCloseTo(1.0, 2);
  });

  it('scales sublinearly with model size', () => {
    const small = kvCacheGb(8, 8192);
    const big = kvCacheGb(72, 8192);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThan(small * 9); // sqrt scaling, not linear
  });

  it('scales linearly with context length', () => {
    expect(kvCacheGb(8, 131072)).toBeCloseTo(16 * kvCacheGb(8, 8192), 5);
  });
});

describe('evaluateCompatibility', () => {
  it('reports green when the model fits in VRAM', () => {
    const r = evaluateCompatibility(10, GPU_16GB);
    expect(r.tier).toBe('gpu');
    expect(r.color).toBe('green');
    expect(r.fits).toBe(true);
  });

  it('reports partial offload when it fits in VRAM+RAM', () => {
    const r = evaluateCompatibility(30, GPU_16GB);
    expect(r.tier).toBe('offload');
    expect(r.fits).toBe(true);
  });

  it('reports cpu tier on machines without a GPU', () => {
    const r = evaluateCompatibility(10, CPU_ONLY_16GB);
    expect(r.tier).toBe('cpu');
    expect(r.color).toBe('yellow');
  });

  it('reports red when nothing fits', () => {
    expect(evaluateCompatibility(100, GPU_16GB).fits).toBe(false);
    expect(evaluateCompatibility(100, CPU_ONLY_16GB).fits).toBe(false);
  });
});

describe('estimateTokensPerSec', () => {
  it('is faster on GPU than CPU for the same model', () => {
    const gpu = estimateTokensPerSec(8, 4, 'gpu', GPU_16GB);
    const cpu = estimateTokensPerSec(8, 4, 'cpu', CPU_ONLY_16GB);
    expect(gpu).toBeGreaterThan(cpu);
  });

  it('offload speed sits between pure GPU and pure CPU', () => {
    const gpu = estimateTokensPerSec(70, 4, 'gpu', GPU_16GB);
    const offload = estimateTokensPerSec(70, 4, 'offload', GPU_16GB);
    const cpu = estimateTokensPerSec(70, 4, 'cpu', GPU_16GB);
    expect(offload).toBeLessThan(gpu);
    expect(offload).toBeGreaterThan(cpu);
  });

  it('returns 0 for the none tier', () => {
    expect(estimateTokensPerSec(70, 4, 'none', GPU_16GB)).toBe(0);
  });
});

describe('formatTokensPerSec', () => {
  it('rounds large values and keeps a decimal for small ones', () => {
    expect(formatTokensPerSec(62.4)).toBe('~62 tok/s');
    expect(formatTokensPerSec(3.21)).toBe('~3.2 tok/s');
    expect(formatTokensPerSec(0)).toBeNull();
  });
});

describe('evaluateModel', () => {
  it('produces a full evaluation and preserves raw fields', () => {
    const model = { id: 'meta-llama/Meta-Llama-3-8B-Instruct', name: 'Llama 3 (8B)', params_b: 8, ollama_cmd: 'llama3', is_installed: false };
    const result = evaluateModel(model, GPU_16GB, 4, CONTEXT_PRESETS[1].tokens);
    expect(result.memory_required_gb).toBeCloseTo(totalMemoryGb(8, 4, 8192), 5);
    expect(result.tier).toBe('gpu');
    expect(result.fits).toBe(true);
    expect(result.tokens_per_sec).toBeGreaterThan(0);
    expect(result.ollama_cmd).toBe('llama3');
  });
});
