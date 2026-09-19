import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { prependToolText, SystemReminderRegistry, withSystemReminders } from './systemReminder';

describe('SystemReminderRegistry', () => {
  it('按 priority 高到低拼接，取完即空', () => {
    const registry = new SystemReminderRegistry();
    const late = ['second'];
    const early = ['first'];
    registry.register('late', () => late.splice(0), 1);
    registry.register('early', () => early.splice(0), 10);
    registry.register('empty', () => [], 100);
    expect(registry.takePending()).toEqual(['first', 'second']);
    expect(registry.takePending()).toEqual([]);
  });

  it('provider 抛错不影响其他 provider', () => {
    const registry = new SystemReminderRegistry();
    registry.register('boom', () => {
      throw new Error('nope');
    });
    registry.register('ok', () => ['kept']);
    expect(registry.takePending()).toEqual(['kept']);
  });
});

describe('prependToolText', () => {
  it('垫到首个 text block；没有 text 则插入', () => {
    expect(
      prependToolText({ content: [{ type: 'text', text: 'body' }], details: 1 }, 'HEAD')
    ).toEqual({
      content: [{ type: 'text', text: 'HEAD\n\nbody' }],
      details: 1,
    });
    expect(prependToolText({ content: [], details: undefined }, 'HEAD')).toEqual({
      content: [{ type: 'text', text: 'HEAD' }],
      details: undefined,
    });
  });
});

describe('withSystemReminders', () => {
  it('把 registry 待发提醒垫到任意工具结果', async () => {
    const registry = new SystemReminderRegistry();
    const pending = ['task-1 done'];
    registry.register('background-task', () => pending.splice(0));
    const inner: ToolDefinition = {
      name: 'read',
      label: 'read',
      description: 'read',
      parameters: { type: 'object', properties: {} } as ToolDefinition['parameters'],
      async execute() {
        return { content: [{ type: 'text' as const, text: 'file' }], details: undefined };
      },
    };
    const wrapped = withSystemReminders(inner, registry);
    const result = await wrapped.execute('1', {}, undefined, undefined, undefined as never);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: '<system-reminder>\ntask-1 done\n</system-reminder>\n\nfile',
    });
    const again = await wrapped.execute('2', {}, undefined, undefined, undefined as never);
    expect(again.content[0]).toEqual({ type: 'text', text: 'file' });
  });
});
