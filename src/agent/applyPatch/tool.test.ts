import { describe, expect, it, vi } from 'vitest';
import type { SshExecutor } from '../ssh/executor';
import { type ApplyPatchDetails, createApplyPatchTool, createRemoteApplyPatchIo } from './index';

const input = '*** Begin Patch\n*** Add File: a.txt\n+a\n*** End Patch';

describe('apply_patch tool 与 SSH IO', () => {
  it('暴露完整且排他的 {input:string} schema，并在校验前归一', () => {
    const tool = createApplyPatchTool({ cwd: '/tmp' });
    expect(tool.name).toBe('apply_patch');
    expect(tool.promptSnippet).not.toMatch(/atomic/i);
    expect(tool.description).toContain('*** Update File: example/config.txt');
    expect(tool.description).toContain('*** Add File: example/new-note.txt');
    expect(tool.description).toContain('*** Delete File: example/old-note.txt');
    expect(tool.description?.match(/\*\*\* Begin Patch/g)).toHaveLength(1);
    expect(tool.description?.match(/\*\*\* End Patch/g)).toHaveLength(1);
    expect(tool.description).toContain('never concatenate patches');
    expect(tool.description).toContain('Never put an unprefixed blank separator inside Update');
    expect(tool.description).toContain('blank context must start with one space');
    expect(tool.description).toContain('trimEnd');
    expect(tool.description).toContain('*** Add File: path');
    expect(tool.description).toContain('*** Delete File: path');
    expect(tool.description).toContain('never use unified-diff line-number ranges');
    expect(tool.description).toContain("put the locator on '@@ ...'");
    expect(tool.description).toContain('never add a BOM or NUL');
    expect(tool.description).toMatch(/explicit absolute paths/i);
    expect(tool.description).toMatch(/relative paths.*workspace/i);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input'],
      additionalProperties: false,
    });
    expect(tool.prepareArguments?.(input)).toEqual({ input });
    expect(tool.prepareArguments?.(JSON.stringify({ input, path: 'bad' }))).toEqual({
      input,
      path: 'bad',
    });
  });

  it('execute 也走同一归一且拒绝混入 path/edits', async () => {
    const tool = createApplyPatchTool({ cwd: '/tmp' });
    await expect(
      tool.execute(
        'call',
        { input, edits: [] } as never,
        new AbortController().signal,
        undefined,
        undefined as never
      )
    ).rejects.toThrow();
  });

  it('失败 details 用 kind discriminator，不自创 isError', () => {
    const details: ApplyPatchDetails = {
      kind: 'apply_patch',
      status: 'failed',
      fileChanges: [],
      applied: [],
      failed: ['x'],
      error: 'failure',
      unattempted: [],
      uncertain: [],
    };
    expect(details).not.toHaveProperty('isError');
  });

  it('远端命令使用固定脚本和独立 argv 传路径，不把路径插进 shell 文本', async () => {
    const calls: Array<{ command: string[] | string; stdin?: string | Buffer }> = [];
    const executor = {
      host: 'mock',
      exec: vi.fn(async (command: string[] | string, options?: { stdin?: string | Buffer }) => {
        calls.push({ command, stdin: options?.stdin });
        return { stdout: '', stderr: '', code: 0 };
      }),
      execRaw: vi.fn(async (command: string[] | string) => {
        calls.push({ command });
        return { stdout: Buffer.alloc(0), stderr: '', code: 1 };
      }),
      execStream: vi.fn(),
    } as unknown as SshExecutor;
    const dangerous = "dir/name'; echo PWN";
    const io = createRemoteApplyPatchIo('/workspace', executor);
    await io.write(dangerous, Buffer.from('safe'), { exclusive: true });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(Array.isArray(call.command)).toBe(true);
      const argv = call.command as string[];
      expect(argv).toContain(dangerous);
      expect(argv.slice(0, -1).join(' ')).not.toContain(dangerous);
    }
  });
});
