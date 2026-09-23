import { describe, expect, it, vi } from 'vitest';
import { createWorkflowTool, workflowChildOutcome } from './workflow';
import { loadWorkflowPreset } from './workflowPresets';

describe('workflowChildOutcome', () => {
  it('成功子代理取文本，失败、超时和中断都不是成功', () => {
    expect(
      workflowChildOutcome({ report: { runs: [{ status: 'succeeded' }] } }, { text: 'done' })
    ).toEqual({ failed: false, text: 'done' });
    expect(
      workflowChildOutcome({ report: { runs: [{ status: 'failed' }] } }, { text: 'partial' }).failed
    ).toBe(true);
    expect(
      workflowChildOutcome({ report: { runs: [{ status: 'succeeded' }], timedOut: true } }, {})
        .failed
    ).toBe(true);
  });
});

describe('workflow tool', () => {
  it('schema 声明完整类型，并且只在显式编排时使用', () => {
    const tool = createWorkflowTool({ invoke: vi.fn(), emit: vi.fn() });
    const parameters = tool.parameters as {
      type: string;
      required: string[];
      additionalProperties: boolean;
      properties: {
        preset: { type: string };
        script: { type: string };
        meta: { type: string; required: string[]; properties: { name: { type: string } } };
        args: { type: string };
      };
    };
    expect(parameters.type).toBe('object');
    expect(parameters.additionalProperties).toBe(false);
    expect(parameters.required).toEqual([]);
    expect(parameters.properties.preset.type).toBe('string');
    expect(parameters.properties.script.type).toBe('string');
    expect(parameters.properties.meta.type).toBe('object');
    expect(parameters.properties.meta.required).toEqual(['name', 'description']);
    expect(parameters.properties.meta.properties.name.type).toBe('string');
    expect(parameters.properties.args.type).toBe('object');
    expect(tool.promptGuidelines?.join('\n')).toMatch(/explicit|asks for a workflow/i);
  });

  it('扇出两个子代理，失败的一个变成 null，侧边栏快照能看到阶段和成员', async () => {
    const emit = vi.fn();
    const invoke = vi.fn(async (request) => {
      if (request.operation === 'report') {
        return {
          ok: true as const,
          value: { text: request.runId === 'bad' ? '' : `ok:${request.runId}` },
        };
      }
      const failed = request.operation === 'spawn' && request.prompt.includes('bad');
      return {
        ok: true as const,
        value: {
          agentId: failed ? 'child-bad' : 'child-good',
          runId: failed ? 'bad' : 'good',
          report: {
            runs: [{ status: failed ? 'failed' : 'succeeded' }],
            timedOut: false,
            interrupted: false,
          },
        },
      };
    });
    const tool = createWorkflowTool({ invoke, emit, randomUuid: () => 'workflow-1' });
    const result = await tool.execute(
      'call-1',
      {
        meta: { name: 'audit', description: 'Audit two files' },
        script:
          "await phase('review');\n" +
          'const rows = await parallel([\n' +
          "  () => agent('good file', { label: 'good' }),\n" +
          "  () => agent('bad file', { label: 'bad' }),\n" +
          ']);\n' +
          'return rows;',
      },
      undefined,
      undefined,
      {} as never
    );
    expect((result as { isError?: boolean }).isError).toBeUndefined();
    expect(result.details).toMatchObject({
      runId: 'workflow-1',
      agentsStarted: 2,
      result: ['ok:good', null],
    });
    const last = emit.mock.calls.at(-1)?.[0];
    expect(last).toMatchObject({
      runId: 'workflow-1',
      name: 'audit',
      status: 'completed',
      phase: 'review',
    });
    expect(last.members).toEqual([
      {
        seq: 1,
        label: 'good',
        phase: 'review',
        batch: 1,
        status: 'completed',
        prompt: 'good file',
        result: 'ok:good',
        childId: 'child-good',
      },
      {
        seq: 2,
        label: 'bad',
        phase: 'review',
        batch: 1,
        status: 'failed',
        prompt: 'bad file',
        childId: 'child-bad',
      },
    ]);
  });

  it('先后启动的子代理不进同一并行批次', async () => {
    const emit = vi.fn();
    const tool = createWorkflowTool({
      invoke: vi.fn(async (request) => {
        if (request.operation === 'report') return { ok: true as const, value: { text: 'done' } };
        return {
          ok: true as const,
          value: {
            agentId: `child-${request.prompt}`,
            runId: request.prompt,
            report: { runs: [{ status: 'succeeded' }], timedOut: false, interrupted: false },
          },
        };
      }),
      emit,
      randomUuid: () => 'workflow-seq',
    });
    await tool.execute(
      'call-seq',
      {
        meta: { name: 'seq', description: 'Sequential agents' },
        script:
          "await agent('first', { label: 'first' }); await agent('second', { label: 'second' });",
      },
      undefined,
      undefined,
      {} as never
    );
    const members = emit.mock.calls.at(-1)?.[0].members;
    expect(members.map((member: { batch: number }) => member.batch)).toEqual([1, 2]);
  });

  it('不支持的 agent 选项会让整次运行失败', async () => {
    const emit = vi.fn();
    const tool = createWorkflowTool({
      invoke: vi.fn(),
      emit,
      randomUuid: () => 'workflow-2',
    });
    const result = await tool.execute(
      'call-2',
      {
        meta: { name: 'bad-option', description: 'Reject unknown option' },
        script: "return await agent('work', { effort: 'high' });",
      },
      undefined,
      undefined,
      {} as never
    );
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/not supported/),
    });
  });

  describe('preset', () => {
    const saved = {
      id: 'echo',
      source: 'project' as const,
      name: 'Echo preset',
      description: 'Return the resolved args',
      args: [
        { key: 'target', label: 'Target', default: 'HEAD' },
        { key: 'focus', label: 'Focus', required: true },
      ],
      script: 'return args;',
    };
    const make = () => {
      const emit = vi.fn();
      const loadPreset = vi.fn((id: string) => (id === 'echo' ? saved : null));
      const tool = createWorkflowTool({
        invoke: vi.fn(),
        emit,
        loadPreset,
        randomUuid: () => 'wf-p',
      });
      const run = (params: Record<string, unknown>) =>
        tool.execute('call-p', params, undefined, undefined, {} as never);
      return { emit, run };
    };

    it('按 id 运行预设脚本，补默认参数并用预设元数据展示', async () => {
      const { emit, run } = make();
      const result = await run({ preset: 'echo', args: { focus: 'perf' } });
      expect(result.details).toMatchObject({ result: { target: 'HEAD', focus: 'perf' } });
      expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({
        name: 'Echo preset',
        description: 'Return the resolved args',
        status: 'completed',
      });
    });

    it('可用预设写进工具说明（单行、截断），并允许模型自行挑选合适的预设', () => {
      const noPresets = createWorkflowTool({ invoke: vi.fn(), emit: vi.fn() });
      expect(noPresets.description).not.toMatch(/Available presets/);
      const tool = createWorkflowTool({
        invoke: vi.fn(),
        emit: vi.fn(),
        presets: [
          { ...saved, description: `line one\nline two ${'x'.repeat(400)}` },
          { id: 'plain', source: 'builtin', name: 'Plain', description: 'No args', args: [] },
        ],
      });
      const lines = tool.description.split('\n');
      const echo = lines.find((line) => line.startsWith('- echo:'));
      expect(echo).toMatch(/Echo preset — line one line two x+… \(args: target="HEAD", focus\*\)$/);
      expect(echo?.length).toBeLessThan(300);
      expect(lines).toContain('- plain: Plain — No args');
      const guidelines = tool.promptGuidelines?.join('\n') ?? '';
      expect(guidelines).toMatch(/listed preset/i);
      expect(guidelines).not.toMatch(/never guess preset ids/);
    });

    it('未知预设、同时给脚本、缺必填参数都在启动前拒绝', async () => {
      const { emit, run } = make();
      await expect(run({ preset: 'nope' })).rejects.toThrow(/unknown workflow preset/);
      await expect(
        run({ preset: 'echo', script: 'return 1;', args: { focus: 'x' } })
      ).rejects.toThrow(/either preset or script/);
      await expect(run({ preset: 'echo' })).rejects.toThrow(/focus/);
      expect(emit).not.toHaveBeenCalled();
    });

    it('内置预设在沙箱里按默认参数扇出只读子代理', async () => {
      const invoke = vi.fn(async (request) => {
        if (request.operation === 'report') return { ok: true as const, value: { text: 'none' } };
        return {
          ok: true as const,
          value: {
            agentId: `child-${request.description}`,
            runId: request.description,
            report: { runs: [{ status: 'succeeded' }], timedOut: false, interrupted: false },
          },
        };
      });
      const tool = createWorkflowTool({
        invoke,
        emit: vi.fn(),
        loadPreset: (id) => loadWorkflowPreset(id, []),
      });
      const result = await tool.execute(
        'call-b',
        { preset: 'parallel-review' },
        undefined,
        undefined,
        {} as never
      );
      expect(result.details).toMatchObject({
        agentsStarted: 3,
        result: [
          { dimension: 'correctness', findings: 'none' },
          { dimension: 'security', findings: 'none' },
          { dimension: 'performance', findings: 'none' },
        ],
      });
      const spawns = invoke.mock.calls
        .map(([request]) => request)
        .filter((r) => r.operation === 'spawn');
      expect(spawns.every((r) => r.agentType === 'reviewer')).toBe(true);
    });
  });
});
