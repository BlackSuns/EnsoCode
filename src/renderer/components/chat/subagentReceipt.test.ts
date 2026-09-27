import { describe, expect, it } from 'vitest';
import { parseSubagentReceipt } from './subagentReceipt';

const json = (value: object) => JSON.stringify(value, null, 2);
const run = (over: Record<string, unknown> = {}) => ({
  owner: { ownerId: 'conv', projectId: 'proj', kind: 'chatSession' },
  agentId: 'agent-a',
  runId: 'run-a',
  mode: 'task',
  status: 'succeeded',
  createdAt: 1000,
  startedAt: 2000,
  finishedAt: 14000,
  ...over,
});

describe('parseSubagentReceipt', () => {
  it('report：回答单独拿出来，运行信息里不再重复回答', () => {
    const view = parseSubagentReceipt(
      'report',
      json({ run: run(), text: 'fake-ok', usage: { inputTokens: 10, outputTokens: 2 } })
    );
    expect(view).toMatchObject({
      kind: 'report',
      head: '',
      text: 'fake-ok',
      value: null,
      error: null,
      runs: [{ agentId: 'agent-a', runId: 'run-a', status: 'succeeded', durationMs: 12000 }],
    });
    expect(view?.info).toContain('"usage"');
    expect(view?.info).toContain('run-a');
    expect(view?.info).not.toContain('fake-ok');
  });

  it('report：结构化结果按 JSON 排版，失败原因单独给出，空白回答视为没有', () => {
    const view = parseSubagentReceipt(
      'report',
      json({ run: run({ status: 'failed' }), text: '  ', value: { ok: true }, error: 'boom' })
    );
    expect(view).toMatchObject({ text: null, value: '{\n  "ok": true\n}', error: 'boom' });
    expect(view?.info).not.toContain('boom');
  });

  it('wait：逐个 run 给出状态与用时，未结束的没有用时；保留超时 / 打断标记', () => {
    const view = parseSubagentReceipt(
      'wait',
      json({
        runs: [
          run({ startedAt: undefined }),
          run({ agentId: 'agent-b', runId: 'run-b', status: 'running', finishedAt: undefined }),
        ],
        timedOut: true,
        interrupted: false,
      })
    );
    expect(view).toMatchObject({
      kind: 'wait',
      timedOut: true,
      interrupted: false,
      runs: [
        { agentId: 'agent-a', status: 'succeeded', durationMs: 13000 },
        { agentId: 'agent-b', runId: 'run-b', status: 'running', durationMs: null },
      ],
    });
    expect(view?.info).toContain('run-b');
  });

  it('回执前捎带的系统提醒原样保留', () => {
    const reminder = '<system-reminder>\n后台任务已结束\n</system-reminder>';
    const view = parseSubagentReceipt('report', `${reminder}\n${json({ run: run(), text: 'ok' })}`);
    expect(view).toMatchObject({ head: reminder, text: 'ok' });
  });

  it('对不上形状时返回 null，由调用方回退原文', () => {
    const waited = json({ runs: [run()], timedOut: false, interrupted: false });
    expect(parseSubagentReceipt('report', null)).toBeNull();
    expect(
      parseSubagentReceipt('report', '[Tool output externalized\nTool: subagent\nArtifact: x]')
    ).toBeNull();
    expect(parseSubagentReceipt('report', waited)).toBeNull();
    expect(parseSubagentReceipt('wait', json({ run: run(), text: 'ok' }))).toBeNull();
    expect(
      parseSubagentReceipt(
        'wait',
        json({ runs: [{ runId: 'x' }], timedOut: false, interrupted: false })
      )
    ).toBeNull();
  });
});
