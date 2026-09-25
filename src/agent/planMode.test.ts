import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  EMPTY_PLAN_STATE,
  PLAN_ENTRY_TYPE,
  PLAN_MODE_OFF_NOTE,
  PLAN_MODE_ON_NOTE,
  type PlanDoc,
  type PlanState,
  planPhase,
} from '@shared/planMode';
import type { ApprovalRequestInfo } from '@shared/types/agent';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate, withApproval } from './approval';
import { createSubmitPlanTool, PlanController, withPlanGate } from './planMode';

const planning: PlanState = { active: true, resolutions: {} };
const reviewing: PlanState = {
  active: true,
  pending: { planId: 'p0', title: 'T', text: 'x' },
  resolutions: {},
};
const ok = { content: [{ type: 'text' as const, text: 'ok' }], details: undefined };

const tool = (name: string, execute = vi.fn().mockResolvedValue(ok)): ToolDefinition => ({
  name,
  label: name,
  description: '',
  parameters: {} as never,
  execute,
});

function setup(state: PlanState, mode: 'supervised' | 'full' = 'full') {
  const requests: ApprovalRequestInfo[] = [];
  const gate = new ApprovalGate(
    mode,
    (info) => requests.push(info),
    () => undefined
  );
  const host = { state: () => state, submit: vi.fn<(doc: PlanDoc) => void>() };
  const deps = { host, gate, readonlyAgentTypes: new Set(['scout']) };
  const run = (definition: ToolDefinition, params: unknown, category?: 'mcp') =>
    withPlanGate(definition, { ...deps, ...(category ? { category } : {}) }).execute(
      'c1',
      params as never,
      undefined,
      undefined,
      undefined as never
    );
  return { gate, host, requests, run };
}

describe('withPlanGate', () => {
  it('非 Plan 状态原样放行', async () => {
    const { run } = setup(EMPTY_PLAN_STATE);
    const edit = tool('edit');
    await run(edit, {});
    expect(edit.execute).toHaveBeenCalled();
  });

  it.each(['edit', 'write', 'apply_patch', 'todo', 'workflow'])(
    '规划与待审期间拒绝 %s',
    async (name) => {
      for (const state of [planning, reviewing]) {
        const { run } = setup(state);
        const definition = tool(name);
        await expect(run(definition, {})).rejects.toThrow(/Plan mode is active/);
        expect(definition.execute).not.toHaveBeenCalled();
      }
    }
  );

  it('只读 bash 与读工具免询问放行', async () => {
    const { run, requests } = setup(planning);
    const bash = tool('bash');
    await run(bash, { command: 'rg foo src' });
    await run(tool('read'), { path: 'a' });
    expect(bash.execute).toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it('非只读 bash 即使 full 档也强制询问，批准后内层审批不重复', async () => {
    const { run, requests, gate } = setup(planning, 'supervised');
    const execute = vi.fn().mockResolvedValue(ok);
    const bash = withApproval(gate, 'command', tool('bash', execute));
    const pending = run(bash, { command: 'npm install' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ planMode: true, kind: 'command', summary: 'npm install' });
    gate.respond(requests[0].requestId, 'allow');
    await pending;
    expect(requests).toHaveLength(1);
    expect(execute).toHaveBeenCalled();
  });

  it('非只读 bash 被拒绝时不执行', async () => {
    const { run, requests, gate } = setup(planning);
    const bash = tool('bash');
    const pending = run(bash, { command: 'rm -rf dist' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    gate.respond(requests[0].requestId, 'deny');
    await expect(pending).rejects.toThrow(/denied/);
    expect(bash.execute).not.toHaveBeenCalled();
  });

  it('MCP 工具强制询问', async () => {
    const { run, requests, gate } = setup(planning);
    const mcp = tool('mcp__db__query');
    const pending = run(mcp, { sql: 'select 1' }, 'mcp');
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ planMode: true, kind: 'mcp' });
    gate.respond(requests[0].requestId, 'allow');
    await pending;
    expect(mcp.execute).toHaveBeenCalled();
  });

  it('subagent 只允许派生只读类型，禁止向已有代理发消息', async () => {
    const { run } = setup(planning);
    const subagent = tool('subagent');
    await run(subagent, { operation: 'spawn', agent_type: 'scout', description: 'd', prompt: 'p' });
    await run(subagent, { operation: 'wait', runId: 'r' });
    expect(subagent.execute).toHaveBeenCalledTimes(2);
    await expect(
      run(subagent, { operation: 'spawn', agent_type: 'worker', description: 'd', prompt: 'p' })
    ).rejects.toThrow(/read-only agent_type/);
    await expect(
      run(subagent, { operation: 'spawn', description: 'd', prompt: 'p' })
    ).rejects.toThrow(/read-only agent_type/);
    await expect(run(subagent, { operation: 'send', agentId: 'a', message: 'm' })).rejects.toThrow(
      /Plan mode is active/
    );
    expect(subagent.execute).toHaveBeenCalledTimes(2);
  });
});

describe('submit_plan', () => {
  const exec = (state: PlanState, params: unknown) => {
    const host = { state: () => state, submit: vi.fn<(doc: PlanDoc) => void>() };
    const definition = createSubmitPlanTool(host, () => 'p1');
    return {
      host,
      result: definition.execute('c1', params as never, undefined, undefined, undefined as never),
    };
  };

  it('规划中提交成功并结束本轮', async () => {
    const { host, result } = exec(planning, { title: ' 重构 ', plan: '# 步骤\n1. 改 A' });
    await expect(result).resolves.toMatchObject({
      terminate: true,
      details: { planId: 'p1', title: '重构' },
    });
    expect(host.submit).toHaveBeenCalledWith({
      planId: 'p1',
      title: '重构',
      text: '# 步骤\n1. 改 A',
    });
  });

  it.each([
    [EMPTY_PLAN_STATE, { title: 't', plan: 'p' }, /not active/],
    [reviewing, { title: 't', plan: 'p' }, /already awaiting review/],
    [planning, { title: '  ', plan: 'p' }, /title/],
    [planning, { title: 't', plan: '' }, /plan/],
    [planning, { title: 'x'.repeat(121), plan: 'p' }, /title/],
    [planning, { title: 't', plan: 'x'.repeat(32 * 1024 + 1) }, /plan/],
  ])('拒绝 %#', async (state, params, error) => {
    const { host, result } = exec(state, params);
    await expect(result).rejects.toThrow(error);
    expect(host.submit).not.toHaveBeenCalled();
  });
});

describe('PlanController', () => {
  const make = (initial: unknown[] = []) => {
    const entries: unknown[] = [...initial];
    const changes: PlanState[] = [];
    const controller = new PlanController(
      {
        branch: () => entries,
        append: (entry) =>
          entries.push({ type: 'custom', customType: PLAN_ENTRY_TYPE, data: entry }),
      },
      (state) => changes.push(state)
    );
    return { controller, entries, changes };
  };

  it('进入 → 提交 → 批准：提示、状态与 kickoff', () => {
    const { controller, changes } = make();
    controller.setActive(true);
    expect(planPhase(controller.state())).toBe('planning');
    expect(controller.takeNote()).toBe(PLAN_MODE_ON_NOTE);
    expect(controller.takeNote()).toBeUndefined();
    controller.submit({ planId: 'p1', title: 'T', text: '1. A' });
    expect(planPhase(controller.state())).toBe('awaiting_review');
    expect(controller.respond('stale', 'approve')).toBeNull();
    const result = controller.respond('p1', 'approve');
    expect(result?.prompt).toMatch(/^<plan-approved id="p1">/);
    expect(planPhase(controller.state())).toBe('executing');
    expect(controller.takeNote()).toBeUndefined();
    expect(changes.length).toBeGreaterThanOrEqual(3);
  });

  it('未告知模型前开了又关，不产生提示', () => {
    const { controller } = make();
    controller.setActive(true);
    controller.setActive(false);
    expect(controller.takeNote()).toBeUndefined();
  });

  it('告知后退出发 OFF 提示', () => {
    const { controller } = make();
    controller.setActive(true);
    controller.takeNote();
    controller.setActive(false);
    expect(controller.takeNote()).toBe(PLAN_MODE_OFF_NOTE);
  });

  it('修改意见需要非空反馈，放弃退出 Plan', () => {
    const { controller } = make();
    controller.setActive(true);
    controller.submit({ planId: 'p1', title: 'T', text: 'x' });
    expect(controller.respond('p1', 'revise', '  ')).toBeNull();
    expect(controller.respond('p1', 'revise', '别动 B')?.prompt).toMatch(/别动 B/);
    expect(planPhase(controller.state())).toBe('planning');
    controller.submit({ planId: 'p2', title: 'T', text: 'x' });
    expect(controller.respond('p2', 'discard')).toEqual({});
    expect(planPhase(controller.state())).toBe('off');
    expect(controller.state().resolutions).toEqual({ p1: 'revised', p2: 'discarded' });
  });

  it('待审时用户发消息取代计划；执行态可结束', () => {
    const { controller } = make();
    controller.setActive(true);
    controller.submit({ planId: 'p1', title: 'T', text: 'x' });
    controller.supersede();
    expect(controller.state().resolutions.p1).toBe('superseded');
    controller.submit({ planId: 'p2', title: 'T', text: 'x' });
    controller.respond('p2', 'approve');
    expect(controller.respond('p1', 'finish')).toBeNull();
    expect(controller.respond('p2', 'finish')).toEqual({});
    expect(planPhase(controller.state())).toBe('off');
  });

  it('冷恢复处于规划中时重申规则；压缩后执行态补计划', () => {
    const { controller: resumed } = make([
      {
        type: 'custom',
        customType: PLAN_ENTRY_TYPE,
        data: { v: 1, kind: 'mode', active: true, at: 1 },
      },
    ]);
    expect(resumed.takeNote()).toBe(PLAN_MODE_ON_NOTE);
    const { controller } = make();
    controller.setActive(true);
    controller.submit({ planId: 'p1', title: 'T', text: '1. A' });
    controller.respond('p1', 'approve');
    controller.compacted();
    expect(controller.takeNote()).toMatch(/^<active-plan id="p1">[\s\S]*1\. A/);
  });
});
