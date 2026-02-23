import { describe, it, expect } from 'vitest';
import { PROVIDER_INFO } from '../../src/components/Chat/ModelPicker';

describe('ModelPicker — PROVIDER_INFO', () => {
  it('should contain all expected cloud providers', () => {
    const expected = [
      'google', 'groq', 'cerebras', 'sambanova', 'openrouter',
      'apifreellm', 'nvidia', 'cohere', 'mistral', 'huggingface',
      'cloudflare', 'together', 'fireworks', 'openai', 'anthropic', 'xai',
    ];
    for (const provider of expected) {
      expect(PROVIDER_INFO).toHaveProperty(provider);
    }
  });

  it('should have valid signup URLs for all providers', () => {
    for (const [name, info] of Object.entries(PROVIDER_INFO)) {
      expect(info.signupUrl, `${name} should have a valid URL`).toMatch(/^https?:\/\//);
    }
  });

  it('should have placeholder text for all providers', () => {
    for (const [name, info] of Object.entries(PROVIDER_INFO)) {
      expect(info.placeholder, `${name} should have a placeholder`).toBeTruthy();
    }
  });

  it('should have boolean free status for all providers', () => {
    for (const [name, info] of Object.entries(PROVIDER_INFO)) {
      expect(typeof info.free, `${name} should have boolean free`).toBe('boolean');
    }
  });

  it('should classify free providers correctly', () => {
    const freeProviders = Object.entries(PROVIDER_INFO)
      .filter(([_, info]) => info.free)
      .map(([name]) => name);

    expect(freeProviders).toContain('google');
    expect(freeProviders).toContain('groq');
    expect(freeProviders).toContain('cerebras');
    expect(freeProviders).toContain('sambanova');
    expect(freeProviders).toContain('openrouter');
    expect(freeProviders).not.toContain('openai');
    expect(freeProviders).not.toContain('anthropic');
  });

  it('should classify paid providers correctly', () => {
    const paidProviders = Object.entries(PROVIDER_INFO)
      .filter(([_, info]) => !info.free)
      .map(([name]) => name);

    expect(paidProviders).toContain('openai');
    expect(paidProviders).toContain('anthropic');
    expect(paidProviders).toContain('together');
    expect(paidProviders).toContain('fireworks');
    expect(paidProviders).toContain('xai');
    expect(paidProviders).not.toContain('google');
  });

  it('should have notes for free providers', () => {
    const freeWithNotes = Object.entries(PROVIDER_INFO)
      .filter(([_, info]) => info.free);

    for (const [name, info] of freeWithNotes) {
      expect(info.note, `${name} (free) should have a note`).toBeTruthy();
    }
  });

  it('free providers should outnumber paid providers', () => {
    const freeCount = Object.values(PROVIDER_INFO).filter(i => i.free).length;
    const paidCount = Object.values(PROVIDER_INFO).filter(i => !i.free).length;
    expect(freeCount).toBeGreaterThan(paidCount);
  });

  it('should have exactly 16 providers', () => {
    expect(Object.keys(PROVIDER_INFO).length).toBe(16);
  });
});
