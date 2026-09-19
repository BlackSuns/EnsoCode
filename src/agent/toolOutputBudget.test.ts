import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_URI_SCHEME,
  parseArtifactUri,
  ToolOutputBudget,
  withToolOutputBudget,
} from './toolOutputBudget';

function textTool(name: string, text: string): ToolDefinition {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: 'object', properties: {} } as ToolDefinition['parameters'],
    async execute() {
      return { content: [{ type: 'text' as const, text }], details: { kept: true } };
    },
  };
}

describe('ToolOutputBudget', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function budget(maxInlineBytes = 32): ToolOutputBudget {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-budget-'));
    dirs.push(root);
    mkdirSync(root, { recursive: true });
    return new ToolOutputBudget({ rootDir: root, maxInlineBytes });
  }

  it('短结果原样返回', async () => {
    const store = budget(64);
    const wrapped = withToolOutputBudget(textTool('grep', 'short'), store);
    const result = await wrapped.execute(
      'c1',
      { pattern: 'x' },
      undefined,
      undefined,
      undefined as never
    );
    expect(result.content).toEqual([{ type: 'text', text: 'short' }]);
    expect(result.details).toEqual({ kept: true });
  });

  it('超长结果外置为 artifact，receipt 可经 read 回取', async () => {
    const store = budget(16);
    const body = 'abcdefghij'.repeat(8);
    const wrapped = withToolOutputBudget(textTool('grep', body), store);
    const result = await wrapped.execute(
      'call-1',
      { pattern: 'TODO', path: 'src' },
      undefined,
      undefined,
      undefined as never
    );
    const text = result.content[0];
    expect(text?.type).toBe('text');
    if (text?.type !== 'text') throw new Error('expected text');
    expect(text.text).toContain('[Tool output externalized');
    expect(text.text).toContain('grep');
    expect(text.text).toContain('TODO');
    expect(text.text).not.toContain(body);
    const uri = parseArtifactUri(text.text.match(/enso-artifact:\/\/[^\s]+/)?.[0] ?? '');
    expect(uri).toBeTruthy();
    const details = result.details as { externalized?: boolean; reference?: string };
    expect(details.externalized).toBe(true);
    expect(details.reference).toContain(ARTIFACT_URI_SCHEME);

    const recovered = store.read(details.reference ?? '');
    expect(recovered).toBe(body);
    expect(readFileSync(path.join(store.rootDir, 'call-1.txt'), 'utf8')).toBe(body);
  });

  it('read 工具不外置，但能按 uri 取回 artifact', async () => {
    const store = budget(8);
    store.write('call-9', 'abcdefghijklmnop');
    const reader = withToolOutputBudget(textTool('read', 'file-body'), store);
    const file = await reader.execute(
      'r1',
      { path: '/tmp/x.ts' },
      undefined,
      undefined,
      undefined as never
    );
    expect(file.content).toEqual([{ type: 'text', text: 'file-body' }]);
    const hit = await reader.execute(
      'r2',
      { path: `${ARTIFACT_URI_SCHEME}call-9` },
      undefined,
      undefined,
      undefined as never
    );
    expect(hit.content).toEqual([{ type: 'text', text: 'abcdefghijklmnop' }]);
  });

  it('落盘失败时退回 head/tail 预览', async () => {
    const blocker = path.join(tmpdir(), `enso-budget-file-${process.pid}`);
    writeFileSync(blocker, 'not-a-dir');
    dirs.push(blocker);
    const store = new ToolOutputBudget({ rootDir: blocker, maxInlineBytes: 8 });
    const wrapped = withToolOutputBudget(textTool('bash', '0123456789abcdef'), store);
    const result = await wrapped.execute(
      'c1',
      { command: 'x' },
      undefined,
      undefined,
      undefined as never
    );
    const text = result.content[0];
    expect(text?.type).toBe('text');
    if (text?.type !== 'text') throw new Error('expected text');
    expect(text.text).toMatch(/truncated/i);
    expect(text.text).toContain('0123');
    expect((result.details as { fallback?: boolean }).fallback).toBe(true);
  });
});
