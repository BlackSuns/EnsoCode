import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { SpawnModelConfig } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import { createSubagentTool, type SubagentDeps } from './subagent';

const cheapConfig: SpawnModelConfig = {
  api: 'openai-completions',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'k',
  modelId: 'gpt-cheap',
  settingsProviderId: 'p1',
};

function fakeSession(reply: string): AgentSession {
  return {
    messages: [{ role: 'assistant', content: [{ type: 'text', text: reply }] }],
    subscribe: () => () => {},
    prompt: vi.fn(async () => {}),
    abort: async () => {},
    dispose: () => {},
  } as unknown as AgentSession;
}

function makeDeps(overrides: Partial<SubagentDeps> = {}): SubagentDeps {
  return {
    createSubSession: vi.fn(async () => fakeSession('done')),
    modelId: 'parent-model',
    agentTypes: [],
    models: [{ name: 'OpenAI/gpt-cheap', config: cheapConfig, description: '便宜快' }],
    emitUpdate: vi.fn(),
    runGate: vi.fn(async () => 'PASSED'),
    notify: vi.fn(),
    ...overrides,
  };
}

describe('subagent tool model 参数', () => {
  it('未知 model 报错并列出可用项', async () => {
    const tool = createSubagentTool(makeDeps());
    await expect(
      tool.execute(
        't1',
        { description: 'x', prompt: 'do', model: 'nope' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/OpenAI\/gpt-cheap/);
  });

  it('指定 model 时以该配置创建子会话并如实上报 modelId', async () => {
    const deps = makeDeps();
    const tool = createSubagentTool(deps);
    const result = await tool.execute(
      't1',
      { description: 'x', prompt: 'do', model: 'OpenAI/gpt-cheap' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.createSubSession).toHaveBeenCalledWith(undefined, cheapConfig, undefined);
    expect((result.details as { modelId?: string }).modelId).toBe('gpt-cheap');
    const emitted = (deps.emitUpdate as ReturnType<typeof vi.fn>).mock.calls.map(
      ([info]) => info.modelId
    );
    expect(emitted).toContain('gpt-cheap');
  });

  it('未指定 model 时沿用现状(agent_type/父模型),不传 override', async () => {
    const deps = makeDeps();
    const tool = createSubagentTool(deps);
    await tool.execute('t1', { description: 'x', prompt: 'do' }, undefined, undefined, {} as never);
    expect(deps.createSubSession).toHaveBeenCalledWith(undefined, undefined, undefined);
  });

  it('报告末尾附运行脚注:工具调用统计与模型', async () => {
    const session = {
      ...fakeSession('report body'),
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'c1', name: 'read', arguments: {} }],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'report body' }] },
      ],
    } as unknown as AgentSession;
    const deps = makeDeps({ createSubSession: vi.fn(async () => session) });
    const tool = createSubagentTool(deps);
    const result = await tool.execute(
      't1',
      { description: 'x', prompt: 'do' },
      undefined,
      undefined,
      {} as never
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text.startsWith('report body')).toBe(true);
    expect(text).toContain('read 1');
    expect(text).toContain('shell 0');
    expect(text).toContain('parent-model');
  });

  it('model 参数说明携带用户写的选型描述', () => {
    const tool = createSubagentTool(makeDeps());
    const properties = (tool.parameters as { properties: Record<string, { description?: string }> })
      .properties;
    expect(properties.model?.description).toContain('OpenAI/gpt-cheap');
    expect(properties.model?.description).toContain('便宜快');
  });

  it('models 为空时 schema 不含 model 参数', () => {
    const tool = createSubagentTool(makeDeps({ models: [] }));
    const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
    expect('model' in properties).toBe(false);
  });

  it('promptSnippet 仅在有可选模型时提及 model 参数(开关关闭不泄露)', () => {
    expect(createSubagentTool(makeDeps()).promptSnippet).toMatch(/model parameter/);
    expect(createSubagentTool(makeDeps({ models: [] })).promptSnippet).not.toMatch(
      /model parameter/
    );
  });

  it('promptGuidelines 写入条件式委派规则，含内置类型选型；无类型时不提类型', () => {
    const guidelines = createSubagentTool(
      makeDeps({
        agentTypes: [
          { name: 'scout', description: 'recon', systemPrompt: '', tools: 'readonly' },
          { name: 'worker', description: 'impl', systemPrompt: '', tools: 'all' },
          { name: 'reviewer', description: 'review', systemPrompt: '', tools: 'readonly' },
        ],
      })
    ).promptGuidelines;
    expect(guidelines?.join('\n')).toMatch(/clear benefit.*parallel/is);
    expect(guidelines?.join('\n')).toMatch(/scout.*worker.*reviewer/s);
    expect(createSubagentTool(makeDeps()).promptGuidelines?.join('\n')).not.toMatch(/scout/);
  });

  it('存在必须自选的 agent_type 时，guidelines 提前要求带 model，避免漏填重试', () => {
    const text =
      createSubagentTool(
        makeDeps({
          agentTypes: [
            {
              name: 'scout',
              description: 'recon',
              systemPrompt: '',
              tools: 'readonly',
              allowModelOverride: true,
            },
          ],
        })
      ).promptGuidelines?.join('\n') ?? '';
    expect(text).toMatch(/\[custom model required\]/);
    expect(text).toMatch(/always pass model/i);
    expect(text).toMatch(/OpenAI\/gpt-cheap/);
    expect(
      createSubagentTool(
        makeDeps({
          agentTypes: [
            { name: 'scout', description: 'recon', systemPrompt: '', tools: 'readonly' },
          ],
        })
      ).promptGuidelines?.join('\n')
    ).not.toMatch(/always pass model/i);
  });

  it('类型选型按类型逐个拼接，关掉一个不影响其余', () => {
    const text = createSubagentTool(
      makeDeps({
        agentTypes: [
          { name: 'scout', description: 'recon', systemPrompt: '', tools: 'readonly' },
          { name: 'worker', description: 'impl', systemPrompt: '', tools: 'all' },
        ],
      })
    ).promptGuidelines?.join('\n');
    expect(text).toMatch(/scout/);
    expect(text).toMatch(/worker/);
    expect(text).not.toMatch(/reviewer/);
  });

  it('先判断委派收益，短小且上下文已知时直接做，并一次性选择委派类型', () => {
    const tool = createSubagentTool(makeDeps());
    const text = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join(
      '\n'
    );
    expect(text).toMatch(/short tasks.*directly.*context.*known/is);
    expect(text).toMatch(/user.*request/is);
    expect(text).toMatch(/parallel/is);
    expect(text).toMatch(/isolated context/is);
    expect(text).toMatch(/independent review/is);
    expect(text).not.toMatch(/hand any independent subtask|Delegate by default|anti-pattern/i);
  });

  it('交叉推荐 coworker 带可用性条件，且仅持续协作与上下文复用时选择', () => {
    const tool = createSubagentTool(makeDeps());
    const text = `${tool.description}\n${tool.promptSnippet}`;
    expect(text).toMatch(/coworker.*if available/is);
    expect(text).toMatch(/sustained collaboration.*context reuse/is);
    expect(text).toMatch(/availability.*does not.*delegat|do not delegate.*availability/is);
  });

  it('单次评审用 subagent；同一角色多轮复评交给 coworker，不要每轮新开', () => {
    const tool = createSubagentTool(makeDeps());
    const text = `${tool.description}\n${tool.promptSnippet}`;
    expect(text).toMatch(/single review/is);
    expect(text).toMatch(/same role across/is);
    expect(text).toMatch(/do not start a new subagent each round/is);
  });

  it('判断型并行派 N 个 subagent；同类 grep 汇总走 exec，且 exec 互斥不写进 description', () => {
    const tool = createSubagentTool(makeDeps());
    const alwaysOn = `${tool.promptSnippet}\n${(tool.promptGuidelines ?? []).join('\n')}`;
    expect(tool.description).toMatch(/isolated judgment/i);
    expect(tool.description).toMatch(/same message/i);
    expect(alwaysOn).toMatch(/isolated judgment/i);
    expect(alwaysOn).toMatch(/do not serial-search/i);
    expect(alwaysOn).toMatch(/3\+ similar guest calls/i);
    expect(alwaysOn).toMatch(/reduced result/i);
    expect(alwaysOn).toMatch(/use exec/i);
    expect(tool.description).not.toMatch(/use exec/i);
  });

  it('当 agent_type 锁定模型（allowModelOverride === false）时，主 agent 传 model 报错拒绝', async () => {
    const deps = makeDeps({
      agentTypes: [
        {
          name: 'fixed-worker',
          description: 'fixed',
          systemPrompt: '',
          tools: 'all',
          allowModelOverride: false,
        },
      ],
    });
    const tool = createSubagentTool(deps);
    await expect(
      tool.execute(
        't1',
        {
          description: 'x',
          prompt: 'do',
          agent_type: 'fixed-worker',
          model: 'OpenAI/gpt-cheap',
        },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/does not allow custom model selection/i);
  });

  it('当 agent_type 设为必须自选（allowModelOverride === true）时，不填 model 拒绝继承', async () => {
    const deps = makeDeps({
      agentTypes: [
        {
          name: 'scout',
          description: 'scout',
          systemPrompt: '',
          tools: 'readonly',
          allowModelOverride: true,
        },
      ],
    });
    const tool = createSubagentTool(deps);
    await expect(
      tool.execute(
        't1',
        { description: 'x', prompt: 'do', agent_type: 'scout' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/requires a model/i);
    expect(deps.createSubSession).not.toHaveBeenCalled();
  });

  it('当 agent_type 设为必须自选（allowModelOverride === true）时，允许指定 model', async () => {
    const deps = makeDeps({
      agentTypes: [
        {
          name: 'scout',
          description: 'scout',
          systemPrompt: '',
          tools: 'readonly',
          allowModelOverride: true,
        },
      ],
    });
    const tool = createSubagentTool(deps);
    const result = await tool.execute(
      't1',
      {
        description: 'x',
        prompt: 'do',
        agent_type: 'scout',
        model: 'OpenAI/gpt-cheap',
      },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.createSubSession).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'scout' }),
      cheapConfig,
      undefined
    );
    expect((result.details as { modelId?: string }).modelId).toBe('gpt-cheap');
  });

  it('model 后缀 :high 解析为模型 + thinking，thinking 参数优先', async () => {
    const deps = makeDeps();
    const tool = createSubagentTool(deps);
    await tool.execute(
      't1',
      { description: 'x', prompt: 'do', model: 'OpenAI/gpt-cheap:high' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.createSubSession).toHaveBeenCalledWith(undefined, cheapConfig, 'high');

    await tool.execute(
      't2',
      {
        description: 'x',
        prompt: 'do',
        model: 'OpenAI/gpt-cheap:high',
        thinking: 'off',
      },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.createSubSession).toHaveBeenLastCalledWith(undefined, cheapConfig, 'off');
  });

  it('仅 thinking 参数时不改模型，非法档位报错', async () => {
    const deps = makeDeps();
    const tool = createSubagentTool(deps);
    await tool.execute(
      't1',
      { description: 'x', prompt: 'do', thinking: 'xhigh' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.createSubSession).toHaveBeenCalledWith(undefined, undefined, 'xhigh');
    await expect(
      tool.execute(
        't2',
        { description: 'x', prompt: 'do', thinking: 'ultra' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/xhigh/);
  });
});

describe('subagent structured yield', () => {
  const schema = {
    type: 'object',
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  };

  it('stores valid JSON and mentions the schema in the child prompt', async () => {
    const session = fakeSession('{"ok":true}');
    const storeYield = vi.fn();
    const deps = makeDeps({ createSubSession: vi.fn(async () => session), storeYield });
    const tool = createSubagentTool(deps);
    await tool.execute(
      't1',
      { description: 'x', prompt: 'do', schema },
      undefined,
      undefined,
      {} as never
    );
    expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('"ok"'));
    expect(storeYield).toHaveBeenCalledWith(expect.stringMatching(/^agent-/), { ok: true });
  });

  it('nudges then fails if JSON never matches', async () => {
    const session = {
      ...fakeSession('nope'),
      prompt: vi.fn(async () => {}),
    } as unknown as AgentSession;
    const deps = makeDeps({ createSubSession: vi.fn(async () => session) });
    const tool = createSubagentTool(deps);
    await expect(
      tool.execute(
        't1',
        { description: 'x', prompt: 'do', schema },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/structured yield/);
    expect(session.prompt).toHaveBeenCalledTimes(3);
  });
});

describe('subagent 启动失败收尾', () => {
  it.each([true, false] as const)(
    'createSubSession 拒绝后发出同 id failed，且不返回 dispatched（wait=%s）',
    async (wait) => {
      const error = new Error('oauth model not found...');
      const deps = makeDeps({
        createSubSession: vi.fn(async () => {
          throw error;
        }),
      });
      const tool = createSubagentTool(deps);
      await expect(
        tool.execute(
          't1',
          { description: 'x', prompt: 'do', wait },
          undefined,
          undefined,
          {} as never
        )
      ).rejects.toBe(error);
      expect(deps.notify).not.toHaveBeenCalled();
      const emitted = (deps.emitUpdate as ReturnType<typeof vi.fn>).mock.calls.map(
        ([info]) => info
      );
      expect(emitted).toHaveLength(2);
      expect(emitted[0]).toMatchObject({ status: 'running', currentActivity: 'starting…' });
      expect(emitted[1]).toMatchObject({
        id: emitted[0].id,
        status: 'failed',
        currentActivity: '',
        resultText: error.message,
      });
    }
  );
});

describe('subagent 可见活动详情', () => {
  it('归并 assistant 流式正文与工具参数、输出和结果', async () => {
    let listener: ((event: Record<string, unknown>) => void) | undefined;
    const session = {
      ...fakeSession('final report'),
      subscribe: (next: (event: Record<string, unknown>) => void) => {
        listener = next;
        return () => {};
      },
      prompt: vi.fn(async () => {
        listener?.({ type: 'message_start', message: { role: 'assistant', content: [] } });
        listener?.({
          type: 'message_update',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'hidden' },
              { type: 'text', text: 'checking' },
            ],
          },
        });
        listener?.({
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: 'checking files' }] },
        });
        listener?.({
          type: 'tool_execution_start',
          toolCallId: 'read-1',
          toolName: 'read',
          args: { path: 'src/a.ts', offset: 10 },
        });
        listener?.({
          type: 'tool_execution_update',
          toolCallId: 'read-1',
          partialResult: { content: [{ type: 'text', text: 'partial' }] },
        });
        listener?.({
          type: 'tool_execution_end',
          toolCallId: 'read-1',
          result: { content: [{ type: 'text', text: 'file body' }] },
          isError: false,
        });
      }),
    } as unknown as AgentSession;
    const deps = makeDeps({ createSubSession: vi.fn(async () => session) });
    const tool = createSubagentTool(deps);
    await tool.execute('t1', { description: 'x', prompt: 'do' }, undefined, undefined, {} as never);

    const final = (deps.emitUpdate as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(final.activities).toEqual([
      {
        id: 'assistant-1',
        type: 'assistant',
        text: 'checking files',
        streaming: false,
      },
      {
        id: 'read-1',
        type: 'tool',
        toolName: 'read',
        argumentsText: expect.stringContaining('"offset": 10'),
        outputText: 'file body',
        status: 'done',
      },
    ]);
    expect(JSON.stringify(final.activities)).not.toContain('hidden');
  });

  it('失败时保留此前采集的可见过程', async () => {
    let listener: ((event: Record<string, unknown>) => void) | undefined;
    const session = {
      ...fakeSession('partial'),
      subscribe: (next: (event: Record<string, unknown>) => void) => {
        listener = next;
        return () => {};
      },
      prompt: vi.fn(async () => {
        listener?.({ type: 'message_start', message: { role: 'assistant', content: [] } });
        listener?.({
          type: 'message_update',
          message: { role: 'assistant', content: [{ type: 'text', text: 'work before failure' }] },
        });
        throw new Error('provider failed');
      }),
    } as unknown as AgentSession;
    const deps = makeDeps({ createSubSession: vi.fn(async () => session) });
    const tool = createSubagentTool(deps);
    await expect(
      tool.execute('t1', { description: 'x', prompt: 'do' }, undefined, undefined, {} as never)
    ).rejects.toThrow('provider failed');

    const final = (deps.emitUpdate as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(final).toMatchObject({ status: 'failed', resultText: 'provider failed' });
    expect(final.activities).toEqual([
      {
        id: 'assistant-1',
        type: 'assistant',
        text: 'work before failure',
        streaming: false,
      },
    ]);
  });
});

describe('subagent 手动中止', () => {
  it('createSubSession 挂起时 abort 能结束 starting 并标 failed', async () => {
    let abort: (() => void) | undefined;
    let resolveCreate: ((session: AgentSession) => void) | undefined;
    const late = fakeSession('late');
    late.dispose = vi.fn();
    const deps = makeDeps({
      createSubSession: vi.fn(
        () =>
          new Promise<AgentSession>((resolve) => {
            resolveCreate = resolve;
          })
      ),
      registerAbort: (_id, fn) => {
        if (fn) abort = fn;
      },
    });
    const tool = createSubagentTool(deps);
    const running = tool.execute(
      't1',
      { description: 'x', prompt: 'do' },
      undefined,
      undefined,
      {} as never
    );
    await vi.waitFor(() => expect(abort).toBeDefined());
    abort?.();
    await expect(running).rejects.toThrow(/aborted/i);
    const emitted = (deps.emitUpdate as ReturnType<typeof vi.fn>).mock.calls.map(([info]) => info);
    expect(emitted.at(-1)).toMatchObject({
      id: emitted[0].id,
      status: 'failed',
      currentActivity: '',
      resultText: expect.stringMatching(/aborted/i),
    });
    resolveCreate?.(late);
    await vi.waitFor(() => expect(late.dispose).toHaveBeenCalled());
  });

  it('wait:true 父 signal 在 starting 阶段即可连坐', async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      createSubSession: vi.fn(() => new Promise<AgentSession>(() => {})),
    });
    const tool = createSubagentTool(deps);
    const running = tool.execute(
      't1',
      { description: 'x', prompt: 'do' },
      controller.signal,
      undefined,
      {} as never
    );
    await vi.waitFor(() => expect(deps.emitUpdate).toHaveBeenCalled());
    controller.abort();
    await expect(running).rejects.toThrow(/aborted/i);
  });

  it('已创建会话后 abort 会 session.abort', async () => {
    let abort: (() => void) | undefined;
    const session = fakeSession('running');
    session.abort = vi.fn(async () => {});
    session.prompt = vi.fn(() => new Promise<void>(() => {}));
    const deps = makeDeps({
      createSubSession: vi.fn(async () => session),
      registerAbort: (_id, fn) => {
        if (fn) abort = fn;
      },
    });
    const tool = createSubagentTool(deps);
    const running = tool.execute(
      't1',
      { description: 'x', prompt: 'do' },
      undefined,
      undefined,
      {} as never
    );
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalled());
    abort?.();
    await expect(running).rejects.toThrow(/aborted/i);
    expect(session.abort).toHaveBeenCalled();
  });
});
