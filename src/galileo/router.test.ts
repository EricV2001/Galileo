import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

// We need to re-import the router for each routing mode because config
// values are captured at module load time. Use vi.doMock + dynamic import.

async function loadRouterWithMode(mode: string) {
  vi.resetModules();
  vi.doMock('./config.js', () => ({
    GALILEO_ROUTING_MODE: mode,
  }));
  return await import('./router.js');
}

describe('router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CLAUDE_ONLY mode', () => {
    it('shouldRouteLocal() returns false', async () => {
      const router = await loadRouterWithMode('CLAUDE_ONLY');
      expect(router.shouldRouteLocal()).toBe(false);
    });

    it('shouldFallbackToClaude() returns false', async () => {
      const router = await loadRouterWithMode('CLAUDE_ONLY');
      expect(router.shouldFallbackToClaude()).toBe(false);
    });

    it('getRoutingMode() returns CLAUDE_ONLY', async () => {
      const router = await loadRouterWithMode('CLAUDE_ONLY');
      expect(router.getRoutingMode()).toBe('CLAUDE_ONLY');
    });
  });

  describe('LOCAL_FIRST mode', () => {
    it('shouldRouteLocal() returns true', async () => {
      const router = await loadRouterWithMode('LOCAL_FIRST');
      expect(router.shouldRouteLocal()).toBe(true);
    });

    it('shouldFallbackToClaude() returns true', async () => {
      const router = await loadRouterWithMode('LOCAL_FIRST');
      expect(router.shouldFallbackToClaude()).toBe(true);
    });

    it('getRoutingMode() returns LOCAL_FIRST', async () => {
      const router = await loadRouterWithMode('LOCAL_FIRST');
      expect(router.getRoutingMode()).toBe('LOCAL_FIRST');
    });
  });

  describe('LOCAL_ONLY mode', () => {
    it('shouldRouteLocal() returns true', async () => {
      const router = await loadRouterWithMode('LOCAL_ONLY');
      expect(router.shouldRouteLocal()).toBe(true);
    });

    it('shouldFallbackToClaude() returns false', async () => {
      const router = await loadRouterWithMode('LOCAL_ONLY');
      expect(router.shouldFallbackToClaude()).toBe(false);
    });

    it('getRoutingMode() returns LOCAL_ONLY', async () => {
      const router = await loadRouterWithMode('LOCAL_ONLY');
      expect(router.getRoutingMode()).toBe('LOCAL_ONLY');
    });
  });
});
