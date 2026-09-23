import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type Context,
  getCurrentSystemPrompt,
  getCurrentTools,
  normalizeContext,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import {
  streamSimple as compatStreamSimple,
  getApiProvider,
  registerApiProvider,
} from '@earendil-works/pi-ai/compat';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCursorProvider, resetCursorProviderLoadForTests } from './loadProvider';

const registration = vi.hoisted(() => ({ repeat: undefined as (() => void) | undefined }));

vi.mock('@rahularya01/pi-cursor', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rahularya01/pi-cursor')>();
  return {
    ...original,
    default(api: { registerProvider: (id: string, config: unknown) => void }) {
      original.default({
        ...api,
        registerProvider(id: string, config: unknown) {
          const provider = getApiProvider('cursor-native');
          registration.repeat = () => {
            if (!provider) throw new Error('Cursor compat API was not registered');
            registerApiProvider(provider, '@rahularya01/pi-cursor');
            api.registerProvider(id, config);
          };
          api.registerProvider(id, config);
        },
      });
    },
  };
});

describe('loadCursorProvider', () => {
  const dirs: string[] = [];

  afterEach(() => {
    resetCursorProviderLoadForTests();
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('worker/OAuth 同一套 load：cursor 出现在 OAuth 列表且 getModel 可离线解析', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-cursor-'));
    dirs.push(tmp);
    vi.stubEnv('PI_OFFLINE', '1');
    vi.stubEnv('PI_CURSOR_SYSTEM_CREDENTIALS', '0');
    const runtime = await ModelRuntime.create({
      authPath: path.join(tmp, 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false,
    });
    await loadCursorProvider(runtime);
    const provider = runtime.getProvider('cursor');
    expect(provider).toBeTruthy();
    expect(provider?.id).toBe('cursor');
    expect(provider?.auth.oauth).toBeTruthy();
    const listed = provider?.getModels() ?? runtime.getModels('cursor');
    expect(listed.length).toBeGreaterThan(0);
    const modelId = listed[0]?.id;
    expect(modelId).toBeTruthy();
    const model = runtime.getModel('cursor', modelId as string);
    expect(model).toBeTruthy();
    expect(model?.provider).toBe('cursor');
  });

  it('把 Pi 归一化上下文还原到 compat 与 runtime 注册路径的 Cursor 请求 payload', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-cursor-context-'));
    dirs.push(tmp);
    vi.stubEnv('PI_OFFLINE', '1');
    vi.stubEnv('PI_CURSOR_SYSTEM_CREDENTIALS', '0');
    const runtime = await ModelRuntime.create({
      authPath: path.join(tmp, 'auth.json'),
      modelsPath: null,
      refreshOnCreate: false,
    });
    await loadCursorProvider(runtime);

    const model = runtime.getModels('cursor')[0];
    if (!model) throw new Error('Cursor offline model was not registered');
    const context: Context = {
      systemPrompt: 'cursor-system-context-fixture',
      tools: [
        {
          name: 'cursor_context_tool_fixture',
          description: 'A test-only tool declaration',
          parameters: Type.Object({ value: Type.String() }),
        },
      ],
      messages: [{ role: 'user', content: 'cursor-user-context-fixture', timestamp: 1 }],
    };
    const transcript = normalizeContext(context);
    expect(Object.keys(transcript)).toEqual(['messages']);
    expect(getCurrentSystemPrompt(transcript.messages)).toContain('cursor-system-context-fixture');
    expect(getCurrentTools(transcript.messages)).toHaveLength(1);

    const compatPayload = await captureCursorPayload((options) =>
      compatStreamSimple(model, context, options)
    );
    expectCursorPayload(compatPayload);

    const runtimeStream = runtime.getRegisteredProviderConfig('cursor')?.streamSimple;
    expect(runtimeStream).toBeTypeOf('function');
    if (!runtimeStream) throw new Error('Cursor runtime stream was not registered');
    const runtimePayload = await captureCursorPayload((options) =>
      runtimeStream(model, transcript, options)
    );
    expectCursorPayload(runtimePayload);

    // 登录或刷新凭据后扩展会重复双注册，适配必须随之重新安装
    expect(registration.repeat).toBeTypeOf('function');
    registration.repeat?.();
    expectCursorPayload(
      await captureCursorPayload((options) => compatStreamSimple(model, context, options))
    );
  });
});

async function captureCursorPayload(
  start: (options: SimpleStreamOptions) => { result(): Promise<unknown> }
): Promise<unknown> {
  let payload: unknown;
  const stream = start({
    apiKey: 'fixture-not-a-real-credential',
    onPayload(value) {
      payload = value;
      throw new Error('test capture: stop before Cursor transport');
    },
  });
  await stream.result();
  return payload;
}

function expectCursorPayload(payload: unknown): void {
  expect(payload).toMatchObject({
    messages: [
      { role: 'system', content: 'cursor-system-context-fixture' },
      { role: 'user', content: 'cursor-user-context-fixture' },
    ],
    tools: [
      {
        type: 'function',
        function: { name: 'cursor_context_tool_fixture' },
      },
    ],
  });
}
