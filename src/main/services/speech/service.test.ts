import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SpeechModelId } from '@shared/types/speech';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

import type { SpeechEngine } from './engine';
import { SPEECH_MODELS, speechModelDirName } from './model';
import { SHERPA_ONNX_VERSION, speechRuntimeDir } from './runtime';
import {
  __setSpeechTestHooks,
  deleteSpeechModel,
  getSpeechStatus,
  onSpeechAvailabilityChange,
  openSpeechSession,
  speechAvailable,
  syncSpeechFromSettings,
} from './service';

let root: string;
let loads: SpeechModelId[];
let disposed: SpeechModelId[];
let transcribed: number[];
let cancelled: number;

function installRuntime(): void {
  const runtime = speechRuntimeDir(path.join(root, 'runtime'), SHERPA_ONNX_VERSION);
  mkdirSync(path.join(runtime, 'sherpa-onnx-darwin-arm64'), { recursive: true });
  mkdirSync(path.join(runtime, 'sherpa-onnx-node'), { recursive: true });
  writeFileSync(path.join(runtime, 'sherpa-onnx-darwin-arm64', 'sherpa-onnx.node'), '');
  writeFileSync(path.join(runtime, 'sherpa-onnx-node', 'package.json'), '{}');
  writeFileSync(path.join(runtime, '.ready'), '');
}

function installModel(id: SpeechModelId): void {
  installRuntime();
  const dir = path.join(root, 'models', speechModelDirName(id));
  for (const file of SPEECH_MODELS[id].files) {
    mkdirSync(path.dirname(path.join(dir, file.name)), { recursive: true });
    writeFileSync(path.join(dir, file.name), 'x');
  }
  writeFileSync(path.join(dir, '.ready'), '{}');
}

/** 流式假引擎：每块回“已收到的块数”个字；整段假引擎：回带多余空格的一句 */
function fakeEngine(id: SpeechModelId): SpeechEngine {
  return {
    transcribe: async (samples) => {
      transcribed.push(samples.length);
      return ' 你好， 世界。 ';
    },
    openStream: () => {
      let text = '';
      return {
        accept: async () => {
          text += '字';
          return text;
        },
        finish: async () => `${text}。`,
        cancel: () => {
          cancelled++;
        },
      };
    },
    dispose: () => {
      disposed.push(id);
    },
  };
}

const second = () => new Float32Array(16_000);
const enable = (extra: Record<string, unknown> = {}) =>
  syncSpeechFromSettings({ voiceInputEnabled: true, ...extra });

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'enso-speech-'));
  loads = [];
  disposed = [];
  transcribed = [];
  cancelled = 0;
  __setSpeechTestHooks({
    root,
    platform: 'darwin',
    arch: 'arm64',
    createEngine: async (spec) => {
      loads.push(spec.id);
      return fakeEngine(spec.id);
    },
  });
  syncSpeechFromSettings({});
});

afterEach(() => {
  __setSpeechTestHooks(null);
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

describe('speech sessions', () => {
  it('refuses to record while voice input is switched off', async () => {
    installModel('x-asr-streaming');
    const session = openSpeechSession(() => {});
    session.push(second());
    await expect(session.finish()).resolves.toEqual({ ok: false, error: 'disabled' });
    expect(loads).toEqual([]);
  });

  it('reports a missing model instead of loading an engine that is not on disk', async () => {
    enable();
    expect(getSpeechStatus().state).toBe('missing');
    await expect(openSpeechSession(() => {}).finish()).resolves.toEqual({
      ok: false,
      error: 'not-ready',
    });
  });

  it('streams partial text while recording and returns the final text', async () => {
    installModel('x-asr-streaming');
    enable();
    const partials: string[] = [];
    const session = openSpeechSession((text) => partials.push(text));
    session.push(second());
    session.push(second());
    await expect(session.finish()).resolves.toEqual({ ok: true, text: '字字。' });
    expect(partials).toEqual(['字', '字字']);
  });

  it('buffers audio for a whole-utterance model and normalizes its output', async () => {
    installModel('x-asr');
    enable({ voiceModel: 'x-asr' });
    const partials: string[] = [];
    for (let i = 0; i < 2; i++) {
      const session = openSpeechSession((text) => partials.push(text));
      session.push(second());
      session.push(second());
      await expect(session.finish()).resolves.toEqual({ ok: true, text: '你好，世界。' });
    }
    expect(transcribed).toEqual([32_000, 32_000]);
    expect(loads).toEqual(['x-asr']);
    expect(partials).toEqual([]);
  });

  it('rejects empty recordings and recordings longer than the cap', async () => {
    installModel('x-asr-streaming');
    enable();
    await expect(openSpeechSession(() => {}).finish()).resolves.toEqual({
      ok: false,
      error: 'invalid-audio',
    });
    const long = openSpeechSession(() => {});
    for (let i = 0; i < 301; i++) long.push(second());
    await expect(long.finish()).resolves.toEqual({ ok: false, error: 'invalid-audio' });
  });

  it('cancels the engine stream and ignores audio pushed after cancel', async () => {
    installModel('x-asr-streaming');
    enable();
    const partials: string[] = [];
    const session = openSpeechSession((text) => partials.push(text));
    session.cancel();
    session.push(second());
    await expect(session.finish()).resolves.toEqual({ ok: false, error: 'failed' });
    await vi.waitFor(() => expect(cancelled).toBe(1));
    expect(partials).toEqual([]);
  });

  it('swaps the engine when the selected model changes', async () => {
    installModel('x-asr-streaming');
    installModel('sense-voice');
    enable();
    const first = openSpeechSession(() => {});
    first.push(second());
    await first.finish();
    enable({ voiceModel: 'sense-voice' });
    const next = openSpeechSession(() => {});
    next.push(second());
    await expect(next.finish()).resolves.toMatchObject({ ok: true });
    expect(loads).toEqual(['x-asr-streaming', 'sense-voice']);
    expect(disposed).toEqual(['x-asr-streaming']);
  });

  it('drops the engine after ten idle minutes but not while a session is open', async () => {
    vi.useFakeTimers();
    installModel('x-asr-streaming');
    enable();
    const open = openSpeechSession(() => {});
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(disposed).toEqual([]);
    open.push(second());
    await open.finish();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(disposed).toEqual(['x-asr-streaming']);
    const again = openSpeechSession(() => {});
    again.push(second());
    await again.finish();
    expect(loads).toEqual(['x-asr-streaming', 'x-asr-streaming']);
  });
});

describe('speech status', () => {
  it('lists every model with its streaming flag and download state', () => {
    installModel('x-asr');
    enable({ voiceModel: 'x-asr' });
    const status = getSpeechStatus();
    expect(status.selected).toBe('x-asr');
    expect(status.state).toBe('ready');
    expect(status.models.map((m) => [m.id, m.streaming, m.state])).toEqual([
      ['x-asr-streaming', true, 'missing'],
      ['x-asr', false, 'ready'],
      ['qwen3-asr', false, 'missing'],
      ['sense-voice', false, 'missing'],
    ]);
  });

  it('tells listeners when voice input becomes usable or stops being usable', async () => {
    installModel('x-asr-streaming');
    const seen: boolean[] = [];
    const off = onSpeechAvailabilityChange((available) => seen.push(available));
    enable();
    enable();
    expect(speechAvailable()).toBe(true);
    await deleteSpeechModel('x-asr-streaming');
    expect(speechAvailable()).toBe(false);
    expect(getSpeechStatus().state).toBe('missing');
    off();
    expect(seen).toEqual([true, false]);
  });
});
