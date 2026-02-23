/**
 * Unit tests for the key pool rotation logic from cloudLLMService.
 * We recreate the pure logic here to test it without Electron dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Extracted key pool logic (mirrors cloudLLMService.js) ───────────
class KeyPoolManager {
  _keyPools: Record<string, Array<{ key: string; cooldownUntil: number }>> = {};
  _keyPoolIndex: Record<string, number> = {};

  addKeyToPool(provider: string, key: string) {
    if (!key || !key.trim()) return;
    if (!this._keyPools[provider]) {
      this._keyPools[provider] = [];
      this._keyPoolIndex[provider] = 0;
    }
    if (this._keyPools[provider].some(entry => entry.key === key)) return;
    this._keyPools[provider].push({ key, cooldownUntil: 0 });
  }

  _getPoolKey(provider: string): string | null {
    const pool = this._keyPools[provider];
    if (!pool || pool.length === 0) return null;

    const now = Date.now();
    const poolSize = pool.length;
    const startIdx = this._keyPoolIndex[provider] || 0;

    for (let i = 0; i < poolSize; i++) {
      const idx = (startIdx + i) % poolSize;
      const entry = pool[idx];
      if (entry.cooldownUntil <= now) {
        this._keyPoolIndex[provider] = (idx + 1) % poolSize;
        return entry.key;
      }
    }

    const soonest = pool.reduce((best, entry) =>
      entry.cooldownUntil < best.cooldownUntil ? entry : best
    );
    return null; // All on cooldown
  }

  _cooldownPoolKey(provider: string, key: string, durationMs = 60000) {
    const pool = this._keyPools[provider];
    if (!pool) return;
    const entry = pool.find(e => e.key === key);
    if (entry) {
      entry.cooldownUntil = Date.now() + durationMs;
    }
  }

  getPoolStatus(provider: string) {
    const pool = this._keyPools[provider];
    if (!pool || pool.length === 0) return null;
    const now = Date.now();
    return {
      provider,
      totalKeys: pool.length,
      availableKeys: pool.filter(e => e.cooldownUntil <= now).length,
      keys: pool.map((e, i) => ({
        index: i,
        available: e.cooldownUntil <= now,
        cooldownRemaining: Math.max(0, Math.ceil((e.cooldownUntil - now) / 1000)),
      })),
    };
  }
}

// ─── Tests ───────────────────────────────────────────────────────────
describe('KeyPoolManager', () => {
  let pool: KeyPoolManager;

  beforeEach(() => {
    pool = new KeyPoolManager();
  });

  describe('addKeyToPool', () => {
    it('adds keys to the pool', () => {
      pool.addKeyToPool('cerebras', 'key-1');
      pool.addKeyToPool('cerebras', 'key-2');
      expect(pool._keyPools.cerebras).toHaveLength(2);
    });

    it('rejects empty keys', () => {
      pool.addKeyToPool('cerebras', '');
      pool.addKeyToPool('cerebras', '  ');
      expect(pool._keyPools.cerebras).toBeUndefined();
    });

    it('deduplicates keys', () => {
      pool.addKeyToPool('cerebras', 'key-1');
      pool.addKeyToPool('cerebras', 'key-1');
      pool.addKeyToPool('cerebras', 'key-1');
      expect(pool._keyPools.cerebras).toHaveLength(1);
    });

    it('keeps providers separate', () => {
      pool.addKeyToPool('cerebras', 'ck-1');
      pool.addKeyToPool('groq', 'gk-1');
      expect(pool._keyPools.cerebras).toHaveLength(1);
      expect(pool._keyPools.groq).toHaveLength(1);
    });
  });

  describe('_getPoolKey (round-robin)', () => {
    it('returns null for empty pool', () => {
      expect(pool._getPoolKey('cerebras')).toBeNull();
    });

    it('round-robins through keys', () => {
      pool.addKeyToPool('cerebras', 'key-A');
      pool.addKeyToPool('cerebras', 'key-B');
      pool.addKeyToPool('cerebras', 'key-C');

      expect(pool._getPoolKey('cerebras')).toBe('key-A');
      expect(pool._getPoolKey('cerebras')).toBe('key-B');
      expect(pool._getPoolKey('cerebras')).toBe('key-C');
      expect(pool._getPoolKey('cerebras')).toBe('key-A'); // wraps around
    });

    it('skips keys on cooldown', () => {
      pool.addKeyToPool('cerebras', 'key-A');
      pool.addKeyToPool('cerebras', 'key-B');
      pool.addKeyToPool('cerebras', 'key-C');

      pool._cooldownPoolKey('cerebras', 'key-A', 60000);

      expect(pool._getPoolKey('cerebras')).toBe('key-B');
      expect(pool._getPoolKey('cerebras')).toBe('key-C');
      expect(pool._getPoolKey('cerebras')).toBe('key-B'); // key-A still on cooldown
    });

    it('returns null when all keys on cooldown', () => {
      pool.addKeyToPool('cerebras', 'key-A');
      pool.addKeyToPool('cerebras', 'key-B');

      pool._cooldownPoolKey('cerebras', 'key-A', 60000);
      pool._cooldownPoolKey('cerebras', 'key-B', 60000);

      expect(pool._getPoolKey('cerebras')).toBeNull();
    });
  });

  describe('_cooldownPoolKey', () => {
    it('puts a key on cooldown', () => {
      pool.addKeyToPool('cerebras', 'key-A');
      pool._cooldownPoolKey('cerebras', 'key-A', 5000);

      const entry = pool._keyPools.cerebras[0];
      expect(entry.cooldownUntil).toBeGreaterThan(Date.now());
    });

    it('does nothing for non-existent key', () => {
      pool.addKeyToPool('cerebras', 'key-A');
      pool._cooldownPoolKey('cerebras', 'nonexistent', 5000);
      // No error thrown, key-A unchanged
      expect(pool._keyPools.cerebras[0].cooldownUntil).toBe(0);
    });
  });

  describe('getPoolStatus', () => {
    it('returns null for unknown provider', () => {
      expect(pool.getPoolStatus('unknown')).toBeNull();
    });

    it('returns correct status', () => {
      pool.addKeyToPool('cerebras', 'key-A');
      pool.addKeyToPool('cerebras', 'key-B');
      pool._cooldownPoolKey('cerebras', 'key-B', 60000);

      const status = pool.getPoolStatus('cerebras')!;
      expect(status.totalKeys).toBe(2);
      expect(status.availableKeys).toBe(1);
      expect(status.keys[0].available).toBe(true);
      expect(status.keys[1].available).toBe(false);
      expect(status.keys[1].cooldownRemaining).toBeGreaterThan(0);
    });
  });

  describe('cooldown expiry', () => {
    it('key becomes available after cooldown expires', () => {
      vi.useFakeTimers();
      pool.addKeyToPool('cerebras', 'key-A');
      pool.addKeyToPool('cerebras', 'key-B');

      pool._cooldownPoolKey('cerebras', 'key-A', 1000);

      // key-A is on cooldown, should get key-B
      expect(pool._getPoolKey('cerebras')).toBe('key-B');

      // Advance past cooldown
      vi.advanceTimersByTime(1100);

      // Now key-A should be available again (round-robin continues)
      expect(pool._getPoolKey('cerebras')).toBe('key-A');
      vi.useRealTimers();
    });
  });
});
