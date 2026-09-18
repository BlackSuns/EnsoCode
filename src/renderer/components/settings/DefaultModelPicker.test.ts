import type { ModelProvider } from '@shared/types';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DefaultModelPicker } from './DefaultModelPicker';

const providers: ModelProvider[] = [
  {
    id: 'api',
    name: 'API entry',
    api: 'openai-completions',
    apiKey: 'secret',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    models: [{ id: 'model', label: 'Chosen model' }],
  },
];

const harness = vi.hoisted(() => ({
  state: {
    defaultModelFollowLast: false,
  },
  setDefaultModel: vi.fn(),
  setDefaultModelFollowLast: vi.fn(),
  setDefaultReasoningEnabled: vi.fn(),
  setDefaultThinkingLevel: vi.fn(),
  pickerProps: null as Record<string, unknown> | null,
}));

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      providers,
      defaultModel: { providerId: 'api', modelId: 'model' },
      setDefaultModel: harness.setDefaultModel,
      defaultModelFollowLast: harness.state.defaultModelFollowLast,
      setDefaultModelFollowLast: harness.setDefaultModelFollowLast,
      defaultReasoningEnabled: true,
      defaultThinkingLevel: 'high',
      setDefaultReasoningEnabled: harness.setDefaultReasoningEnabled,
      setDefaultThinkingLevel: harness.setDefaultThinkingLevel,
    }),
  useDefaultModelRevalidationStore: (selector: (state: { latest: null }) => unknown) =>
    selector({ latest: null }),
}));

vi.mock('@/stores/oauthCredentials', () => ({
  useOauthCredentialStore: (
    selector: (state: {
      snapshot: {
        revision: number;
        availability: { status: 'ready'; authenticatedAccountKeys: ReadonlySet<string> };
      };
    }) => unknown
  ) =>
    selector({
      snapshot: {
        revision: 1,
        availability: { status: 'ready', authenticatedAccountKeys: new Set() },
      },
    }),
  usableProvidersForOauthSnapshot: (entries: ModelProvider[]) => entries,
}));

vi.mock('@/components/chat/ModelPicker', () => ({
  MODEL_PICKER_FORM_TRIGGER_CLASS: 'form-trigger',
  ModelPicker: (props: Record<string, unknown>) => {
    harness.pickerProps = props;
    return createElement('i', {
      'data-default-picker': 'true',
      'data-reasoning-controls': String(props.showReasoningControls),
    });
  },
}));

describe('DefaultModelPicker', () => {
  it('reuses ModelPicker with reasoning controls and writes selection + reasoning defaults', () => {
    harness.state.defaultModelFollowLast = false;
    const html = renderToStaticMarkup(createElement(DefaultModelPicker));
    expect(html).toContain('data-default-picker="true"');
    expect(html).toContain('data-reasoning-controls="true"');
    expect(html).toContain('Follow last selection');

    expect(harness.pickerProps?.reasoningEnabled).toBe(true);
    expect(harness.pickerProps?.thinkingLevel).toBe('high');

    const onSelect = harness.pickerProps?.onSelect;
    expect(onSelect).toBeTypeOf('function');
    if (typeof onSelect === 'function') onSelect('api', 'next-model');
    expect(harness.setDefaultModel).toHaveBeenCalledWith({
      providerId: 'api',
      modelId: 'next-model',
    });
    expect(harness.setDefaultModelFollowLast).not.toHaveBeenCalled();

    const onReasoningChange = harness.pickerProps?.onReasoningChange;
    if (typeof onReasoningChange === 'function') onReasoningChange(false);
    expect(harness.setDefaultReasoningEnabled).toHaveBeenCalledWith(false);

    const onThinkingChange = harness.pickerProps?.onThinkingChange;
    if (typeof onThinkingChange === 'function') onThinkingChange('max');
    expect(harness.setDefaultThinkingLevel).toHaveBeenCalledWith('max');
  });

  it('follow-last mode labels the picker and hides the extra option', () => {
    harness.state.defaultModelFollowLast = true;
    const html = renderToStaticMarkup(createElement(DefaultModelPicker));
    expect(harness.pickerProps?.triggerLabel).toBe('Follow last selection');
    expect(harness.pickerProps?.showReasoningControls).toBe(false);
    expect(html).not.toContain('Follow last selection');
  });
});
