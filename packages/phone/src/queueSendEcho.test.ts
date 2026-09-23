import { PROJECTED_FILE_TEXT_LIMIT } from '@shared/types/fileChanges';
import { describe, expect, it } from 'vitest';
import {
  appendEchoMessages,
  captureQueueSendEcho,
  retainQueueSendEchoes,
  withoutQueuedIds,
} from './queueSendEcho';

const queued = [
  { id: 'q1', text: '马上发' },
  { id: 'q2', text: '留下' },
];

describe('PWA 排队消息马上发送：乐观上墙', () => {
  it('点击马上发送时记下回显，并从排队区拿掉', () => {
    const echo = captureQueueSendEcho(queued, 's1', 'q1', ['旧消息']);
    expect(echo).toEqual({
      sessionId: 's1',
      messageId: 'q1',
      text: '马上发',
      priorMatches: 0,
      priorUserCount: 1,
    });
    expect(withoutQueuedIds(queued, [echo!], 's1').map((item) => item.id)).toEqual(['q2']);
  });

  it('回显浮在权威消息之后，当前轮 assistant 更新不会把它顶掉', () => {
    const echo = captureQueueSendEcho(queued, 's1', 'q1', ['旧消息']);
    const wall = appendEchoMessages(
      [
        { role: 'user', content: [{ type: 'text', text: '旧消息' }] },
        { role: 'assistant', content: [{ type: 'text', text: '还在写…' }] },
      ],
      [echo!],
      's1'
    );
    expect(wall.map((message) => message.content[0])).toEqual([
      { type: 'text', text: '旧消息' },
      { type: 'text', text: '还在写…' },
      { type: 'text', text: '马上发' },
    ]);
  });

  it('历史里已有同文 user 时不误消费；权威区出现新的同文 user 才收掉回显', () => {
    const echo = captureQueueSendEcho([{ id: 'q1', text: 'hi' }], 's1', 'q1', ['hi']);
    expect(retainQueueSendEchoes([echo!], 's1', ['hi'])).toEqual([echo]);
    expect(retainQueueSendEchoes([echo!], 's1', ['hi', 'hi'])).toEqual([]);
  });

  it('找不到排队项则不上墙', () => {
    expect(captureQueueSendEcho(queued, 's1', 'missing', [])).toBeNull();
  });

  it('超长正文被投影截断后，权威 user 仍能收掉回显', () => {
    const text = 'log line\n'.repeat(8000);
    const truncated = `${text.slice(0, PROJECTED_FILE_TEXT_LIMIT)}\n…`;
    const echo = captureQueueSendEcho([{ id: 'q1', text }], 's1', 'q1', []);
    expect(retainQueueSendEchoes([echo!], 's1', [truncated])).toEqual([]);
  });

  it('文本对不上时：轮次收束且已有新 user 落地才收掉；中断收束（尚无新 user）保留', () => {
    const echo = captureQueueSendEcho([{ id: 'q1', text: '原文' }], 's1', 'q1', ['old']);
    const other = { ...echo!, sessionId: 's2' };
    expect(retainQueueSendEchoes([echo!], 's1', ['old', '改写'])).toEqual([echo]);
    expect(retainQueueSendEchoes([echo!, other], 's1', ['old'], { turnSettled: true })).toEqual([
      echo,
      other,
    ]);
    expect(
      retainQueueSendEchoes([echo!, other], 's1', ['old', '改写'], { turnSettled: true })
    ).toEqual([other]);
  });
});
