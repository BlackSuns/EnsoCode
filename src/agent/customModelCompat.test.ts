import { describe, expect, it } from 'vitest';
import { resolveCustomModelCompat, selectCatalogEntryForCompat } from './customModelCompat';

const glmCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  maxTokensField: 'max_tokens',
  thinkingFormat: 'zai',
  zaiToolStream: true,
} as const;

describe('resolveCustomModelCompat', () => {
  it('中转 openai-completions 未知模型关掉 developer', () => {
    expect(
      resolveCustomModelCompat('openai-completions', 'https://new-api.jishu666.com/v1')
    ).toEqual({ supportsDeveloperRole: false });
  });

  it('openai-responses 中转不默认关 developer', () => {
    expect(resolveCustomModelCompat('openai-responses', 'https://gw.example/v1')).toBeUndefined();
  });

  it('官方 OpenAI host 不覆盖，交给 detectCompat', () => {
    expect(
      resolveCustomModelCompat('openai-completions', 'https://api.openai.com/v1')
    ).toBeUndefined();
    expect(
      resolveCustomModelCompat('openai-completions', 'https://us.api.openai.com/v1/')
    ).toBeUndefined();
  });

  it('路径里出现 api.openai.com 不算官方', () => {
    expect(
      resolveCustomModelCompat('openai-completions', 'https://evil.example/api.openai.com/v1')
    ).toEqual({ supportsDeveloperRole: false });
  });

  it('anthropic / google 不塞 openai compat', () => {
    expect(
      resolveCustomModelCompat('anthropic-messages', 'https://relay.example/v1')
    ).toBeUndefined();
    expect(
      resolveCustomModelCompat('google-generative-ai', 'https://generativelanguage.googleapis.com')
    ).toBeUndefined();
  });

  it('带 catalog 的 anthropic / responses 仍不抄 openai compat', () => {
    const catalog = { id: 'glm-5.3-flash', api: 'openai-completions', compat: glmCompat };
    expect(
      resolveCustomModelCompat('anthropic-messages', 'https://relay.example/v1', catalog)
    ).toBeUndefined();
    expect(
      resolveCustomModelCompat('openai-responses', 'https://gw.example/v1', catalog)
    ).toBeUndefined();
  });

  it('catalog 命中时白名单透传 glm compat', () => {
    expect(
      resolveCustomModelCompat('openai-completions', 'https://new-api.jishu666.com/v1', {
        id: 'glm-5.3-flash',
        api: 'openai-completions',
        compat: { ...glmCompat, extra: 'drop-me' },
      })
    ).toEqual({ ...glmCompat });
  });

  it('catalog.api 与 spawn.api 不一致时忽略 catalog', () => {
    expect(
      resolveCustomModelCompat('openai-completions', 'https://gw.example/v1', {
        id: 'glm-5.3-flash',
        api: 'anthropic-messages',
        compat: glmCompat,
      })
    ).toEqual({ supportsDeveloperRole: false });
  });

  it('catalog 显式 supportsDeveloperRole: true 照抄', () => {
    expect(
      resolveCustomModelCompat('openai-completions', 'https://gw.example/v1', {
        api: 'openai-completions',
        compat: { supportsDeveloperRole: true },
      })
    ).toEqual({ supportsDeveloperRole: true });
  });

  it('catalog 只有 thinkingFormat 时中转仍默认关 developer', () => {
    expect(
      resolveCustomModelCompat('openai-completions', 'https://gw.example/v1', {
        api: 'openai-completions',
        compat: { thinkingFormat: 'zai' },
      })
    ).toEqual({ supportsDeveloperRole: false, thinkingFormat: 'zai' });
  });

  it('OpenRouter 不覆盖，交给 detectCompat', () => {
    expect(
      resolveCustomModelCompat('openai-completions', 'https://openrouter.ai/api/v1')
    ).toBeUndefined();
  });

  it('Azure OpenAI host 不覆盖，交给 detectCompat', () => {
    expect(
      resolveCustomModelCompat(
        'openai-completions',
        'https://myres.openai.azure.com/openai/deployments/gpt'
      )
    ).toBeUndefined();
    expect(
      resolveCustomModelCompat(
        'openai-completions',
        'https://myres.cognitiveservices.azure.com/openai/v1'
      )
    ).toBeUndefined();
  });

  it('catalog 命中 baseten 时连 chatTemplateArgs 一起抄', () => {
    const args = { enable_thinking: { $var: 'thinking.enabled' } };
    expect(
      resolveCustomModelCompat('openai-completions', 'https://gw.example/v1', {
        id: 'moonshotai/Kimi-K2.5',
        api: 'openai-completions',
        compat: {
          supportsReasoningEffort: false,
          thinkingFormat: 'baseten',
          chatTemplateArgs: args,
          chatTemplateKwargs: { preserve_thinking: true },
        },
      })
    ).toEqual({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      thinkingFormat: 'baseten',
      chatTemplateArgs: args,
      chatTemplateKwargs: { preserve_thinking: true },
    });
  });

  it('同 id 多 provider 冲突时不选 catalog', () => {
    expect(
      selectCatalogEntryForCompat(
        [
          {
            id: 'zai-org/GLM-5.2',
            api: 'openai-completions',
            baseUrl: 'https://inference.baseten.co/v1',
            compat: { thinkingFormat: 'baseten', chatTemplateArgs: { x: 1 } },
          },
          {
            id: 'zai-org/GLM-5.2',
            api: 'openai-completions',
            baseUrl: 'https://api.together.xyz/v1',
            compat: { thinkingFormat: 'together' },
          },
        ],
        'openai-completions',
        'https://gw.example/v1',
        'zai-org/GLM-5.2'
      )
    ).toBeUndefined();
  });

  it('host 命中时选对应 catalog 条目', () => {
    const baseten = {
      id: 'zai-org/GLM-5.2',
      api: 'openai-completions',
      baseUrl: 'https://inference.baseten.co/v1',
      compat: { thinkingFormat: 'baseten' },
    };
    expect(
      selectCatalogEntryForCompat(
        [
          baseten,
          {
            id: 'zai-org/GLM-5.2',
            api: 'openai-completions',
            baseUrl: 'https://api.together.xyz/v1',
            compat: { thinkingFormat: 'together' },
          },
        ],
        'openai-completions',
        'https://inference.baseten.co/v1',
        'zai-org/GLM-5.2'
      )
    ).toBe(baseten);
  });

  it('冲突时只保留候选都同意的字段', () => {
    const selected = selectCatalogEntryForCompat(
      [
        {
          id: 'glm-5.3-flash',
          api: 'openai-completions',
          provider: 'zai',
          compat: glmCompat,
        },
        {
          id: 'glm-5.3-flash',
          api: 'openai-completions',
          provider: 'opencode',
          compat: {
            supportsStore: false,
            supportsDeveloperRole: false,
            maxTokensField: 'max_tokens',
          },
        },
      ],
      'openai-completions',
      'https://gw.example/v1',
      'glm-5.3-flash'
    );
    expect(selected).toEqual({
      api: 'openai-completions',
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        maxTokensField: 'max_tokens',
      },
    });
  });

  it('同 id 同 api 且 compat 一致时可选', () => {
    const a = {
      id: 'glm-5.3-flash',
      api: 'openai-completions',
      compat: glmCompat,
    };
    expect(
      selectCatalogEntryForCompat(
        [a, { ...a, provider: 'zai-coding-cn' }],
        'openai-completions',
        'https://gw.example/v1',
        'glm-5.3-flash'
      )
    ).toEqual(a);
  });

  it('脏 catalog.compat 忽略后仍按中转默认关掉 developer', () => {
    expect(
      resolveCustomModelCompat('openai-completions', 'https://gw.example/v1', {
        compat: 'nope',
      })
    ).toEqual({ supportsDeveloperRole: false });
    expect(resolveCustomModelCompat('openai-completions', 'https://gw.example/v1', null)).toEqual({
      supportsDeveloperRole: false,
    });
  });
});
