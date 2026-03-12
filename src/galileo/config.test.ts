import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

describe('config defaults (no env vars set)', () => {
  let config: typeof import('./config.js');

  beforeEach(async () => {
    // Clear any GALILEO_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('GALILEO_')) {
        delete process.env[key];
      }
    }
    vi.resetModules();
    // Re-mock after resetModules
    vi.doMock('../env.js', () => ({
      readEnvFile: vi.fn(() => ({})),
    }));
    config = await import('./config.js');
  });

  it('GALILEO_ROUTING_MODE defaults to CLAUDE_ONLY', () => {
    expect(config.GALILEO_ROUTING_MODE).toBe('CLAUDE_ONLY');
  });

  it('GALILEO_LMSTUDIO_URL defaults to localhost:1234', () => {
    expect(config.GALILEO_LMSTUDIO_URL).toBe('http://localhost:1234/v1');
  });

  it('GALILEO_MODEL_GENERAL defaults to qwen3.5-27b', () => {
    expect(config.GALILEO_MODEL_GENERAL).toBe('qwen3.5-27b');
  });

  it('GALILEO_MODEL_EXTRACTION defaults to qwen3.5-9b', () => {
    expect(config.GALILEO_MODEL_EXTRACTION).toBe('qwen3.5-9b');
  });

  it('GALILEO_MODEL_EMBEDDING defaults to text-embedding-nomic-embed-text-v1.5@f16', () => {
    expect(config.GALILEO_MODEL_EMBEDDING).toBe('text-embedding-nomic-embed-text-v1.5@f16');
  });

  it('GALILEO_MEMORY_ENABLED defaults to false', () => {
    expect(config.GALILEO_MEMORY_ENABLED).toBe(false);
  });

  it('isGalileoMemoryEnabled() returns false by default', () => {
    expect(config.isGalileoMemoryEnabled()).toBe(false);
  });

  it('GALILEO_NEO4J_URI defaults to bolt://localhost:7687', () => {
    expect(config.GALILEO_NEO4J_URI).toBe('bolt://localhost:7687');
  });

  it('GALILEO_MAX_RECALL_RESULTS defaults to 5', () => {
    expect(config.GALILEO_MAX_RECALL_RESULTS).toBe(5);
  });

  it('GALILEO_DECAY_HALF_LIFE_DAYS defaults to 30', () => {
    expect(config.GALILEO_DECAY_HALF_LIFE_DAYS).toBe(30);
  });

  it('GALILEO_OBSIDIAN_VAULT_PATH defaults to empty string', () => {
    expect(config.GALILEO_OBSIDIAN_VAULT_PATH).toBe('');
  });
});

describe('config with invalid GALILEO_ROUTING_MODE', () => {
  it('falls back to CLAUDE_ONLY for invalid mode', async () => {
    vi.resetModules();
    vi.doMock('../env.js', () => ({
      readEnvFile: vi.fn(() => ({ GALILEO_ROUTING_MODE: 'INVALID_MODE' })),
    }));

    // Clear process.env so only the mocked envConfig is used
    delete process.env.GALILEO_ROUTING_MODE;

    const config = await import('./config.js');
    expect(config.GALILEO_ROUTING_MODE).toBe('CLAUDE_ONLY');
  });
});

describe('config with valid GALILEO_ROUTING_MODE', () => {
  it('accepts LOCAL_FIRST', async () => {
    vi.resetModules();
    vi.doMock('../env.js', () => ({
      readEnvFile: vi.fn(() => ({ GALILEO_ROUTING_MODE: 'LOCAL_FIRST' })),
    }));

    delete process.env.GALILEO_ROUTING_MODE;

    const config = await import('./config.js');
    expect(config.GALILEO_ROUTING_MODE).toBe('LOCAL_FIRST');
  });

  it('accepts LOCAL_ONLY', async () => {
    vi.resetModules();
    vi.doMock('../env.js', () => ({
      readEnvFile: vi.fn(() => ({ GALILEO_ROUTING_MODE: 'LOCAL_ONLY' })),
    }));

    delete process.env.GALILEO_ROUTING_MODE;

    const config = await import('./config.js');
    expect(config.GALILEO_ROUTING_MODE).toBe('LOCAL_ONLY');
  });
});
