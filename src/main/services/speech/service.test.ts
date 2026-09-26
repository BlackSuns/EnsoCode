import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

import { SENSE_VOICE_MODEL } from './model';
import { SHERPA_ONNX_VERSION, speechRuntimeDir } from './runtime';
import {
  __setSpeechTestHooks,
  deleteSpeechAssets,
  getSpeechStatus,
  onSpeechAvailabilityChange,
  speechAvailable,
  syncSpeechFromSettings,
  transcribeSpeech,
} from './service';

let root: string;
let loads: number;
let decoded: number[];

function installFakeAssets(): void {
  const runtime = speechRuntimeDir(path.join(root, 'runtime'), SHERPA_ONNX_VERSION);
  mkdirSync(path.join(runtime, 'sherpa-onnx-darwin-arm64'), { recursive: true });
  mkdirSync(path.join(runtime, 'sherpa-onnx-node'), { recursive: true });
  writeFileSync(path.join(runtime, 'sherpa-onnx-darwin-arm64', 'sherpa-onnx.node'), '');
  writeFileSync(path.join(runtime, 'sherpa-onnx-node', 'package.json'), '{}');
  writeFileSync(path.join(runtime, '.ready'), '');
  const model = path.join(root, 'models', SENSE_VOICE_MODEL.id);
  mkdirSync(model, { recursive: true });
  for (const file of SENSE_VOICE_MODEL.files) writeFileSync(path.join(model, file.name), 'x');
  writeFileSync(path.join(model, '.ready'), '{}');
}

const second = () => new Float32Array(16_000);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'enso-speech-'));
  loads = 0;
  decoded = [];
  __setSpeechTestHooks({
    root,
    platform: 'darwin',
    arch: 'arm64',
    createRecognizer: async () => {
      loads++;
      const lengths = new WeakMap<object, number>();
      return {
        createStream: () => {
          const stream = {
            acceptWaveform: (wave: { samples: Float32Array }) => {
              lengths.set(stream, wave.samples.length);
            },
          };
          return stream;
        },
        decodeAsync: async (stream: object) => {
          decoded.push(lengths.get(stream) ?? -1);
        },
        getResult: () => ({ text: ' 你好，世界。 ' }),
      };
    },
  });
  syncSpeechFromSettings({});
});

afterEach(() => {
  __setSpeechTestHooks(null);
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

describe('speech service', () => {
  it('refuses to transcribe while voice input is switched off', async () => {
    installFakeAssets();
    await expect(transcribeSpeech(second(), 16_000)).resolves.toEqual({
      ok: false,
      error: 'disabled',
    });
    expect(loads).toBe(0);
  });

  it('reports missing assets instead of loading an engine that is not on disk', async () => {
    syncSpeechFromSettings({ voiceInputEnabled: true });
    expect(getSpeechStatus().state).toBe('missing');
    await expect(transcribeSpeech(second(), 16_000)).resolves.toEqual({
      ok: false,
      error: 'not-ready',
    });
  });

  it('transcribes with one cached recognizer and trims the text', async () => {
    installFakeAssets();
    syncSpeechFromSettings({ voiceInputEnabled: true });
    expect(getSpeechStatus().state).toBe('ready');
    await expect(transcribeSpeech(second(), 16_000)).resolves.toEqual({
      ok: true,
      text: '你好，世界。',
    });
    await transcribeSpeech(second(), 16_000);
    expect(loads).toBe(1);
    expect(decoded).toEqual([16_000, 16_000]);
  });

  it('rejects audio at the wrong rate, empty or longer than the cap', async () => {
    installFakeAssets();
    syncSpeechFromSettings({ voiceInputEnabled: true });
    const invalid = { ok: false, error: 'invalid-audio' };
    await expect(transcribeSpeech(second(), 48_000)).resolves.toEqual(invalid);
    await expect(transcribeSpeech(new Float32Array(0), 16_000)).resolves.toEqual(invalid);
    await expect(transcribeSpeech(new Float32Array(16_000 * 301), 16_000)).resolves.toEqual(
      invalid
    );
    expect(loads).toBe(0);
  });

  it('drops the recognizer after ten idle minutes and reloads on the next request', async () => {
    vi.useFakeTimers();
    installFakeAssets();
    syncSpeechFromSettings({ voiceInputEnabled: true });
    await transcribeSpeech(second(), 16_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await transcribeSpeech(second(), 16_000);
    expect(loads).toBe(2);
  });

  it('tells listeners when voice input becomes usable or stops being usable', async () => {
    installFakeAssets();
    const seen: boolean[] = [];
    const off = onSpeechAvailabilityChange((available) => seen.push(available));
    syncSpeechFromSettings({ voiceInputEnabled: true });
    syncSpeechFromSettings({ voiceInputEnabled: true });
    expect(speechAvailable()).toBe(true);
    await deleteSpeechAssets();
    expect(speechAvailable()).toBe(false);
    expect(getSpeechStatus().state).toBe('missing');
    off();
    expect(seen).toEqual([true, false]);
  });
});
