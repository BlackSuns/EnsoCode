import type { CoworkerInfo, SpawnModelConfig } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';
import { type CoworkerToolDeps, createCoworkerTool } from './coworker';

const cheapConfig: SpawnModelConfig = {
  api: 'openai-completions',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'k',
  modelId: 'gpt-cheap',
  settingsProviderId: 'p1',
};

function makeDeps(overrides: Partial<CoworkerToolDeps> = {}): CoworkerToolDeps {
  return {
    agentTypes: [],
    models: [{ name: 'OpenAI/gpt-cheap', config: cheapConfig }],
    spawn: vi.fn(
      async (name: string): Promise<CoworkerInfo> => ({
        id: `s::cw-${name}`,
        name,
        status: 'idle',
        createdAt: 0,
      })
    ),
    send: vi.fn(async () => 'ok'),
    list: vi.fn(() => []),
    dismiss: vi.fn(async () => {}),
    wait: vi.fn(async () => 'waited'),
    report: vi.fn(() => 'full'),
    message: vi.fn(async () => 'peer-ok'),
    ...overrides,
  };
}

describe('coworker tool model 参数', () => {
  it('spawn 携未知 model 报错并列出可用项', async () => {
    const tool = createCoworkerTool(makeDeps());
    await expect(
      tool.execute(
        't1',
        { operation: 'spawn', name: 'bob', task: 'do', model: 'nope' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/OpenAI\/gpt-cheap/);
  });

  it('spawn 携合法 model 透传给 deps.spawn', async () => {
    const deps = makeDeps();
    const tool = createCoworkerTool(deps);
    await tool.execute(
      't1',
      { operation: 'spawn', name: 'bob', task: 'do', model: 'OpenAI/gpt-cheap' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.spawn).toHaveBeenCalledWith('bob', undefined, 'OpenAI/gpt-cheap', undefined);
  });

  it('spawn 解析 model:high 后缀，显式 thinking 优先', async () => {
    const deps = makeDeps();
    const tool = createCoworkerTool(deps);
    await tool.execute(
      't1',
      { operation: 'spawn', name: 'bob', task: 'do', model: 'OpenAI/gpt-cheap:high' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.spawn).toHaveBeenCalledWith('bob', undefined, 'OpenAI/gpt-cheap', 'high');

    await tool.execute(
      't2',
      {
        operation: 'spawn',
        name: 'alice',
        task: 'do',
        model: 'OpenAI/gpt-cheap:high',
        thinking: 'off',
      },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.spawn).toHaveBeenLastCalledWith('alice', undefined, 'OpenAI/gpt-cheap', 'off');
  });

  it('spawn 的非法显式 thinking 在创建 coworker 前报错', async () => {
    const deps = makeDeps();
    const tool = createCoworkerTool(deps);
    await expect(
      tool.execute(
        't1',
        { operation: 'spawn', name: 'bob', task: 'do', thinking: 'ultra' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(
      'unknown thinking "ultra". Available: [off, minimal, low, medium, high, xhigh, max] or omit to inherit.'
    );
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('models 为空时 schema 不含 model 参数', () => {
    const tool = createCoworkerTool(makeDeps({ models: [] }));
    const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
    expect('model' in properties).toBe(false);
  });

  it('promptSnippet 仅在有可选模型时提及 model 参数(开关关闭不泄露)', () => {
    expect(createCoworkerTool(makeDeps()).promptSnippet).toMatch(/model parameter/);
    expect(createCoworkerTool(makeDeps({ models: [] })).promptSnippet).not.toMatch(
      /model parameter/
    );
  });

  it('promptGuidelines 先验收报告，仅有具体不足才继续 send', () => {
    const tool = createCoworkerTool(makeDeps());
    const text = tool.promptGuidelines?.join('\n') ?? '';
    expect(text).toMatch(/assess.*report.*concrete gap.*send/is);
    expect(text).toMatch(/message_main_agent.*question.*response.*send/is);
    expect(text).toMatch(/assess completion reports first/is);
    expect(text).toMatch(/goal is met.*dismiss.*finish/is);
    const properties = (tool.parameters as { properties: Record<string, { description: string }> })
      .properties;
    expect(properties.task.description).not.toMatch(/self-contained/);
    expect(properties.task.description).toMatch(/send/);
  });

  it('先判断委派收益，短小且上下文已知时直接做；持续协作与上下文复用才选 coworker', () => {
    const tool = createCoworkerTool(makeDeps({ agentTypes: [] }));
    const text = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join(
      '\n'
    );
    expect(text).toMatch(/short tasks.*directly.*context.*known/is);
    expect(text).toMatch(/user.*request/is);
    expect(text).toMatch(/parallel/is);
    expect(text).toMatch(/isolated context/is);
    expect(text).toMatch(/independent review/is);
    expect(text).toMatch(/sustained collaboration.*context reuse/is);
    expect(text).not.toMatch(
      /MAY need|FIRST round|When in doubt choose coworker|unused coworker costs one dismiss/i
    );
  });

  it('同一角色多轮复评用 coworker：spawn 一次再 send，不要每轮新开 subagent', () => {
    const tool = createCoworkerTool(makeDeps({ agentTypes: [] }));
    const text = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join(
      '\n'
    );
    expect(text).toMatch(/same role across/is);
    expect(text).toMatch(/do not start a new subagent each round/is);
    expect(text).toMatch(/single review/is);
  });

  it('存在必须自选的 agent_type 时，guidelines 提前要求 spawn 带 model', () => {
    const text =
      createCoworkerTool(
        makeDeps({
          agentTypes: [
            {
              name: 'scout',
              description: 'scout',
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
      createCoworkerTool(
        makeDeps({
          agentTypes: [
            { name: 'scout', description: 'scout', systemPrompt: '', tools: 'readonly' },
          ],
        })
      ).promptGuidelines?.join('\n')
    ).not.toMatch(/always pass model/i);
  });

  it('交叉推荐 subagent 带可用性条件，不因工具缺失强制改用另一种委派', () => {
    const tool = createCoworkerTool(makeDeps());
    expect(`${tool.description}\n${tool.promptSnippet}`).toMatch(/subagent.*if available/is);
    expect(`${tool.description}\n${tool.promptSnippet}`).toMatch(
      /availability.*does not.*delegat|do not delegate.*availability/is
    );
  });

  it('gate 仅用于适合可执行验证的任务，只读评审按报告证据验收', () => {
    const snippet = createCoworkerTool(makeDeps()).promptSnippet ?? '';
    expect(snippet).toMatch(/executable verification.*gate/is);
    expect(snippet).toMatch(/read-only review.*report evidence/is);
  });

  it('当 agent_type 设为必须自选（allowModelOverride === true）时，spawn 不填 model 拒绝继承', async () => {
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
    const tool = createCoworkerTool(deps);
    await expect(
      tool.execute(
        't1',
        { operation: 'spawn', name: 'bob', task: 'do', agent_type: 'scout' },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/requires a model/i);
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it('当 agent_type 锁定模型（allowModelOverride === false）时，spawn 传 model 报错拒绝', async () => {
    const deps = makeDeps({
      agentTypes: [
        {
          name: 'reviewer',
          description: 'reviewer',
          systemPrompt: '',
          tools: 'readonly',
          allowModelOverride: false,
        },
      ],
    });
    const tool = createCoworkerTool(deps);
    await expect(
      tool.execute(
        't1',
        {
          operation: 'spawn',
          name: 'bob',
          task: 'do',
          agent_type: 'reviewer',
          model: 'OpenAI/gpt-cheap',
        },
        undefined,
        undefined,
        {} as never
      )
    ).rejects.toThrow(/does not allow custom model selection/i);
  });
});

describe('coworker tool wait/report 操作', () => {
  it('wait 操作路由到 deps.wait,透传 name 与 gate', async () => {
    const deps = makeDeps();
    const tool = createCoworkerTool(deps);
    const result = await tool.execute(
      't1',
      { operation: 'wait', name: 'bob', gate: 'pnpm test' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.wait).toHaveBeenCalledWith('bob', expect.objectContaining({ gate: 'pnpm test' }));
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/waited/);
  });

  it('report 操作路由到 deps.report,只传 name', async () => {
    const deps = makeDeps();
    const tool = createCoworkerTool(deps);
    const result = await tool.execute(
      't1',
      { operation: 'report', name: 'bob' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.report).toHaveBeenCalledWith('bob');
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/full/);
  });

  it('wait 缺 name 报错', async () => {
    const tool = createCoworkerTool(makeDeps());
    await expect(
      tool.execute('t1', { operation: 'wait' }, undefined, undefined, {} as never)
    ).rejects.toThrow(/name/i);
  });

  it('report 缺 name 报错', async () => {
    const tool = createCoworkerTool(makeDeps());
    await expect(
      tool.execute('t1', { operation: 'report' }, undefined, undefined, {} as never)
    ).rejects.toThrow(/name/i);
  });

  it('report 结果超 20000 字截断,尾注为 …(truncated at 20000 chars)', async () => {
    const longText = 'a'.repeat(20050);
    const deps = makeDeps({ report: vi.fn(() => longText) });
    const tool = createCoworkerTool(deps);
    const result = await tool.execute(
      't1',
      { operation: 'report', name: 'bob' },
      undefined,
      undefined,
      {} as never
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeLessThan(longText.length);
    expect(text).toMatch(/…\(truncated at 20000 chars\)/);
  });

  it('send 结果超上限截断时,尾注提示用 coworker report 取全文', async () => {
    const longText = 'b'.repeat(5000);
    const deps = makeDeps({ send: vi.fn(async () => longText) });
    const tool = createCoworkerTool(deps);
    const result = await tool.execute(
      't1',
      { operation: 'send', name: 'bob', message: 'hi', wait: true },
      undefined,
      undefined,
      {} as never
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toMatch(/coworker report/);
  });

  it('schema 的 operation enum 含 wait 与 report', () => {
    const tool = createCoworkerTool(makeDeps());
    const properties = (tool.parameters as { properties: { operation: { enum: string[] } } })
      .properties;
    expect(properties.operation.enum).toEqual(
      expect.arrayContaining(['wait', 'report', 'message'])
    );
  });

  it('operation=message 投递给 deps.message，不走 send', async () => {
    const deps = makeDeps();
    const tool = createCoworkerTool(deps);
    const result = await tool.execute(
      't1',
      { operation: 'message', name: 'alice', to: 'bob', text: 'ping' },
      undefined,
      undefined,
      {} as never
    );
    expect(deps.message).toHaveBeenCalledWith('alice', 'bob', 'ping');
    expect(deps.send).not.toHaveBeenCalled();
    expect((result.content[0] as { text: string }).text).toBe('peer-ok');
  });

  it('promptSnippet 提到 wait,并劝阻 sleep/poll', () => {
    const snippet = createCoworkerTool(makeDeps()).promptSnippet ?? '';
    expect(snippet).toMatch(/\bwait\b/);
    expect(snippet).toMatch(/sleep|poll/i);
  });
});
