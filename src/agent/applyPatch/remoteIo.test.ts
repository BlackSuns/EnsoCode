import { describe, expect, it, vi } from 'vitest';
import type { SshExecOptions, SshExecutor } from '../ssh/executor';
import { createRemoteApplyPatchIo, PatchMutationUncertainError } from './index';

interface RecordedCall {
  command: string[] | string;
  options?: SshExecOptions;
}

function fakeExecutor(
  options: { inspectKind?: 'missing' | 'file' | 'symlink'; raw?: Buffer } = {}
) {
  const calls: RecordedCall[] = [];
  const kind = options.inspectKind ?? 'missing';
  const executor = {
    host: 'fake',
    exec: vi.fn(async (command: string[] | string, execOptions?: SshExecOptions) => {
      calls.push({ command, options: execOptions });
      const script = Array.isArray(command) ? command[2] : '';
      if (script.includes("printf 'symlink\\n")) {
        return { stdout: `${kind}\n/workspace/target\n`, stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    }),
    execRaw: vi.fn(async (command: string[] | string, execOptions?: SshExecOptions) => {
      calls.push({ command, options: execOptions });
      return { stdout: options.raw ?? Buffer.from('remote\n'), stderr: '', code: 0 };
    }),
    execStream: vi.fn(),
  } as unknown as SshExecutor;
  return { calls, executor };
}

describe('远端 apply_patch IO', () => {
  it('路径始终作为独立 argv 传递，文件内容只走 stdin', async () => {
    const { calls, executor } = fakeExecutor();
    const io = createRemoteApplyPatchIo('/workspace with space', executor);
    const target = "nested/name'; echo PWN";
    const raw = Buffer.from('safe content');
    await io.write(target, raw, { exclusive: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toEqual(
      expect.arrayContaining(['sh', '-c', '/workspace with space', '1', target])
    );
    expect((calls[0].command as string[]).at(-1)).toBe(target);
    expect(calls[0].options?.stdin).toBe(raw);
    expect((calls[0].command as string[]).slice(0, -1).join(' ')).not.toContain(target);
  });

  it.each(['/absolute.txt', '../escape.txt', 'nested/../../escape.txt'])(
    '在调用 SSH 前拒绝越界路径 %s',
    async (target) => {
      const { calls, executor } = fakeExecutor();
      const io = createRemoteApplyPatchIo('/workspace', executor);
      await expect(io.inspect(target)).rejects.toThrow();
      await expect(io.write(target, Buffer.from('x'), { exclusive: true })).rejects.toThrow();
      await expect(io.remove(target)).rejects.toThrow();
      expect(calls).toHaveLength(0);
    }
  );

  it('inspect 明确返回符号链接类型且不继续读取文件', async () => {
    const { calls, executor } = fakeExecutor({ inspectKind: 'symlink' });
    const entry = await createRemoteApplyPatchIo('/workspace', executor).inspect('link/file.txt');
    expect(entry).toEqual({ kind: 'symlink', canonicalPath: '/workspace/target' });
    expect(calls).toHaveLength(1);
    expect(executor.execRaw).not.toHaveBeenCalled();
  });

  it('覆盖写使用 mktemp 所有权临时文件，不清理可预测的外部路径', async () => {
    const { calls, executor } = fakeExecutor();
    await createRemoteApplyPatchIo('/workspace', executor).write(
      'file.txt',
      Buffer.from('updated'),
      { exclusive: false }
    );
    const script = (calls[0].command as string[])[2];
    expect(script).toContain('mktemp');
    expect(script).toContain('trap cleanup');
    expect(script).not.toContain('tmp=$current/.enso-patch-$$');
  });

  it('SSH transport 中断转换为 mutation uncertain，禁止当作确认未写', async () => {
    const { executor } = fakeExecutor();
    vi.mocked(executor.exec).mockRejectedValueOnce(new Error('ssh command aborted'));
    const io = createRemoteApplyPatchIo('/workspace', executor);
    await expect(
      io.write('file.txt', Buffer.from('content'), { exclusive: true })
    ).rejects.toBeInstanceOf(PatchMutationUncertainError);
  });

  it('inspect 将独立短 timeout 透传给 metadata 与文件读取', async () => {
    const { calls, executor } = fakeExecutor({ inspectKind: 'file' });
    await createRemoteApplyPatchIo('/workspace', executor).inspect(
      'file.txt',
      1024,
      undefined,
      5_000
    );
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.options?.timeoutMs === 5_000)).toBe(true);
  });

  it('文件读取有 maxBytes+1 上界并透传 AbortSignal', async () => {
    const { calls, executor } = fakeExecutor({
      inspectKind: 'file',
      raw: Buffer.from('12345'),
    });
    const controller = new AbortController();
    const io = createRemoteApplyPatchIo('/workspace', executor);
    await expect(io.inspect('file.txt', 4, controller.signal)).rejects.toThrow(/read limit/);
    expect(calls).toHaveLength(2);
    expect(calls[1].command as string[]).toContain('5');
    expect(calls.every((call) => call.options?.signal === controller.signal)).toBe(true);
  });
});
