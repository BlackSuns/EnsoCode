import { describe, expect, it } from 'vitest';
import { buildWorkflowPresetMessage, parseWorkflowPresetMessage } from './workflowPresetMessage';

describe('workflow preset message', () => {
  it('生成的消息可原样解析回预设 id、显示名和参数', () => {
    const text = buildWorkflowPresetMessage({
      id: 'multi-angle-investigation',
      name: '多角度调研 "A" & <B>',
      args: { question: '兼容哪些 API 格式？\nmessages？"response"？</workflow-preset>' },
    });
    expect(parseWorkflowPresetMessage(text)).toEqual({
      id: 'multi-angle-investigation',
      name: '多角度调研 "A" & <B>',
      args: [['question', '兼容哪些 API 格式？\nmessages？"response"？</workflow-preset>']],
    });
  });

  it('块内 JSON 就是 workflow 工具入参，给模型的说明是英文', () => {
    const text = buildWorkflowPresetMessage({ id: 'x', name: 'X', args: {} });
    const json = /\n(\{.*\})\n/.exec(text)?.[1];
    expect(JSON.parse(json ?? '')).toEqual({ preset: 'x' });
    expect(text).toMatch(/call the workflow tool/);
    expect(parseWorkflowPresetMessage(text)).toEqual({ id: 'x', name: 'X', args: [] });
  });

  it('普通文本、坏 JSON、缺 preset 或非字符串参数都不识别', () => {
    expect(parseWorkflowPresetMessage('hello')).toBeNull();
    expect(
      parseWorkflowPresetMessage('<workflow-preset name="X">\n{bad}\n</workflow-preset>\n\nrun')
    ).toBeNull();
    expect(
      parseWorkflowPresetMessage(
        '<workflow-preset name="X">\n{"args":{}}\n</workflow-preset>\n\nrun'
      )
    ).toBeNull();
    expect(
      parseWorkflowPresetMessage(
        '<workflow-preset name="X">\n{"preset":"x","args":{"a":1}}\n</workflow-preset>\n\nrun'
      )
    ).toBeNull();
    expect(
      parseWorkflowPresetMessage(
        'prefix <workflow-preset name="X">\n{"preset":"x"}\n</workflow-preset>\n\nrun'
      )
    ).toBeNull();
  });
});
