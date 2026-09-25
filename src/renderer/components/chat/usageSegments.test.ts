import { describe, expect, it } from 'vitest';
import type { SessionStats } from '@/stores/sessions/stats';
import { buildUsageSegmentValues, toSessionUsageStats } from './usageSegments';

const t = (key: string, params?: Record<string, string | number>) =>
  key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ''));

const stats = (patch: Partial<SessionStats> = {}): SessionStats => ({
  turns: 1,
  steps: 2,
  llmMs: 0,
  toolMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheHitPercent: null,
  ttftAvgMs: null,
  tokensPerSecond: null,
  ...patch,
});

describe('toSessionUsageStats', () => {
  it('无用量、无速度、无占用时不产值', () => {
    expect(toSessionUsageStats(stats())).toBeUndefined();
  });

  it('缺省字段不下发，占用窗口优先于会话窗口', () => {
    expect(
      toSessionUsageStats(
        stats({ inputTokens: 1200, outputTokens: 30, cacheHitPercent: 80, tokensPerSecond: 42.5 }),
        { used: 5000, contextWindow: 200_000 },
        128_000
      )
    ).toEqual({
      inputTokens: 1200,
      outputTokens: 30,
      cacheHitPercent: 80,
      tokensPerSecond: 42.5,
      contextUsed: 5000,
      contextWindow: 200_000,
    });
  });

  it('占用无窗口时回落会话窗口；两者都未知时只给已用量', () => {
    expect(toSessionUsageStats(stats(), { used: 10 }, 128_000)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      contextUsed: 10,
      contextWindow: 128_000,
    });
    expect(toSessionUsageStats(stats(), { used: 0, contextWindow: 0 }, 0)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      contextUsed: 0,
    });
  });
});

describe('buildUsageSegmentValues', () => {
  it('无数据时四段均为空', () => {
    expect(buildUsageSegmentValues(t, undefined)).toEqual({
      tokens: undefined,
      cache: undefined,
      context: undefined,
      speed: undefined,
    });
  });

  it('与桌面状态栏同口径格式化四段', () => {
    const values = buildUsageSegmentValues(t, {
      inputTokens: 12_345,
      outputTokens: 678,
      cacheHitPercent: 87,
      ttftAvgMs: 1234,
      tokensPerSecond: 45.3,
      contextUsed: 185_000,
      contextWindow: 200_000,
    });
    expect(values.tokens).toEqual({
      compact: '↑12.3K ↓678',
      full: 'Input 12.3K tok · Output 678 tok',
    });
    expect(values.cache).toEqual({ compact: '87%', full: 'Cache hit 87%' });
    expect(values.context).toEqual({
      compact: '93%',
      full: '200K · 93%',
      percent: 93,
      critical: true,
    });
    expect(values.speed).toEqual({
      compact: '1.2s · 45.3 tok/s',
      full: 'First token avg 1.2s · 45.3 tok/s',
    });
  });

  it('窗口未知时上下文不编造百分比', () => {
    expect(
      buildUsageSegmentValues(t, { inputTokens: 0, outputTokens: 0, contextUsed: 4200 }).context
    ).toEqual({ compact: '4.2K·?', full: '4.2K · ?' });
  });

  it('占用超过窗口时百分比封顶 100', () => {
    expect(
      buildUsageSegmentValues(t, {
        inputTokens: 0,
        outputTokens: 0,
        contextUsed: 300,
        contextWindow: 200,
      }).context?.percent
    ).toBe(100);
  });
});
