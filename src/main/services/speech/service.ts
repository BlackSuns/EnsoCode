import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  SPEECH_MAX_SECONDS,
  SPEECH_SAMPLE_RATE,
  type SpeechDownloadProgressDto,
  type SpeechStatusDto,
  type SpeechTranscribeResult,
} from '@shared/types/speech';
import { app } from 'electron';
import { downloadedBytes, downloadModel, isModelReady } from '../memory/embedding/downloader';
import { SENSE_VOICE_MODEL, SPEECH_APPROX_BYTES } from './model';
import {
  installSpeechRuntime,
  isSpeechRuntimeReady,
  SHERPA_ONNX_VERSION,
  sherpaPlatformPackage,
  speechRuntimeDir,
  speechRuntimeWrapperDir,
} from './runtime';

const IDLE_UNLOAD_MS = 10 * 60_000;

interface RecognizerStream {
  acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void;
}

interface Recognizer {
  createStream(): RecognizerStream;
  decodeAsync(stream: RecognizerStream): Promise<void>;
  getResult(stream: RecognizerStream): { text?: unknown };
}

interface RecognizerPaths {
  runtimeDir: string;
  model: string;
  tokens: string;
}

interface SpeechTestHooks {
  root: string;
  platform: string;
  arch: string;
  createRecognizer: (paths: RecognizerPaths) => Promise<Recognizer>;
}

let hooks: SpeechTestHooks | null = null;
let enabled = false;
let download: { controller: AbortController; settled: Promise<void> } | null = null;
let recognizer: Promise<Recognizer> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();
let progressSink: ((progress: SpeechDownloadProgressDto) => void) | null = null;
let lastAvailable = false;
const availabilityListeners = new Set<(available: boolean) => void>();

/** 仅供测试：临时目录 + 假识别器，不碰真实 userData 与原生插件 */
export function __setSpeechTestHooks(next: SpeechTestHooks | null): void {
  hooks = next;
  enabled = false;
  lastAvailable = false;
  download = null;
  unloadRecognizer();
  queue = Promise.resolve();
  availabilityListeners.clear();
}

export function setSpeechProgressSink(
  sink: ((progress: SpeechDownloadProgressDto) => void) | null
): void {
  progressSink = sink;
}

export function onSpeechAvailabilityChange(listener: (available: boolean) => void): () => void {
  availabilityListeners.add(listener);
  return () => {
    availabilityListeners.delete(listener);
  };
}

function speechRoot(): string {
  return hooks?.root ?? path.join(app.getPath('userData'), 'speech');
}

function platformPackage(): string | null {
  return sherpaPlatformPackage(hooks?.platform ?? process.platform, hooks?.arch ?? process.arch);
}

function runtimeDir(): string {
  return speechRuntimeDir(path.join(speechRoot(), 'runtime'), SHERPA_ONNX_VERSION);
}

function modelDir(): string {
  return path.join(speechRoot(), 'models', SENSE_VOICE_MODEL.id);
}

function assetsReady(): boolean {
  const pkg = platformPackage();
  return (
    pkg !== null &&
    isSpeechRuntimeReady(runtimeDir(), pkg) &&
    isModelReady(modelDir(), SENSE_VOICE_MODEL)
  );
}

export function speechAvailable(): boolean {
  return enabled && assetsReady();
}

function notifyAvailability(): void {
  const available = speechAvailable();
  if (available === lastAvailable) return;
  lastAvailable = available;
  for (const listener of [...availabilityListeners]) {
    try {
      listener(available);
    } catch {}
  }
}

/** settings.json 的 state 按 unknown 收窄；关闭即卸载常驻模型 */
export function syncSpeechFromSettings(state: Record<string, unknown>): void {
  enabled = state.voiceInputEnabled === true;
  if (!enabled) unloadRecognizer();
  notifyAvailability();
}

export function getSpeechStatus(): SpeechStatusDto {
  const base = {
    approxBytes: SPEECH_APPROX_BYTES,
    downloadedBytes: downloadedBytes(modelDir(), SENSE_VOICE_MODEL),
  };
  if (!platformPackage()) return { ...base, state: 'unsupported' };
  if (download) return { ...base, state: 'downloading' };
  return { ...base, state: assetsReady() ? 'ready' : 'missing' };
}

export async function startSpeechDownload(): Promise<boolean> {
  const pkg = platformPackage();
  if (!pkg || download) return false;
  const controller = new AbortController();
  let settle!: () => void;
  const task = { controller, settled: new Promise<void>((resolve) => (settle = resolve)) };
  download = task;
  const fileCount = SENSE_VOICE_MODEL.files.length + 1;
  const emit = (progress: Omit<SpeechDownloadProgressDto, 'fileCount'>) => {
    if (download === task) progressSink?.({ ...progress, fileCount });
  };
  let error: string | undefined;
  try {
    if (!isSpeechRuntimeReady(runtimeDir(), pkg)) {
      emit({ file: pkg, fileIndex: 0, received: 0, total: null });
      await installSpeechRuntime({
        dir: runtimeDir(),
        platformPackage: pkg,
        version: SHERPA_ONNX_VERSION,
        signal: controller.signal,
      });
    }
    controller.signal.throwIfAborted();
    await downloadModel(SENSE_VOICE_MODEL, modelDir(), {
      signal: controller.signal,
      onProgress: (p) => emit({ ...p, fileIndex: p.fileIndex + 1 }),
    });
    return true;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    emit({ file: '', fileIndex: 0, received: 0, total: null, done: true, error });
    if (download === task) download = null;
    settle();
    notifyAvailability();
  }
}

export function cancelSpeechDownload(): boolean {
  if (!download || download.controller.signal.aborted) return false;
  download.controller.abort();
  return true;
}

/** 删模型必删；已加载的原生插件在 Windows 上删不掉运行时，失败就留着（约 30MB） */
export async function deleteSpeechAssets(): Promise<boolean> {
  const task = download;
  cancelSpeechDownload();
  await task?.settled;
  unloadRecognizer();
  await queue.catch(() => {});
  try {
    fs.rmSync(modelDir(), { recursive: true, force: true });
    try {
      fs.rmSync(runtimeDir(), { recursive: true, force: true });
    } catch {}
    return true;
  } catch {
    return false;
  } finally {
    notifyAvailability();
  }
}

function unloadRecognizer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  recognizer = null;
}

function loadRecognizer(): Promise<Recognizer> {
  if (!recognizer) {
    const paths = {
      runtimeDir: runtimeDir(),
      model: path.join(modelDir(), 'model.int8.onnx'),
      tokens: path.join(modelDir(), 'tokens.txt'),
    };
    const pending = (hooks?.createRecognizer ?? createSherpaRecognizer)(paths);
    recognizer = pending;
    pending.catch(() => {
      if (recognizer === pending) recognizer = null;
    });
  }
  return recognizer;
}

async function createSherpaRecognizer(paths: RecognizerPaths): Promise<Recognizer> {
  // 不能写成 require(...)：electron-vite 见到它会往 main 包插 CJS shim，插入点用正则找，会落进 i18n 字符串
  const load = createRequire(import.meta.url);
  const sherpa = load(speechRuntimeWrapperDir(paths.runtimeDir)) as {
    OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> };
  };
  return sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: SPEECH_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: paths.model, language: 'auto', useInverseTextNormalization: 1 },
      tokens: paths.tokens,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
  });
}

/** 一次只解码一段；识别器懒加载、空闲 10 分钟卸载（常驻约 250MB） */
export function transcribeSpeech(
  samples: Float32Array,
  sampleRate: number
): Promise<SpeechTranscribeResult> {
  if (!enabled) return Promise.resolve({ ok: false, error: 'disabled' });
  if (
    sampleRate !== SPEECH_SAMPLE_RATE ||
    samples.length === 0 ||
    samples.length > SPEECH_SAMPLE_RATE * SPEECH_MAX_SECONDS
  ) {
    return Promise.resolve({ ok: false, error: 'invalid-audio' });
  }
  if (!assetsReady()) return Promise.resolve({ ok: false, error: 'not-ready' });
  const run = queue.then(async (): Promise<SpeechTranscribeResult> => {
    try {
      const rec = await loadRecognizer();
      const stream = rec.createStream();
      stream.acceptWaveform({ samples, sampleRate });
      await rec.decodeAsync(stream);
      const text = rec.getResult(stream).text;
      return { ok: true, text: typeof text === 'string' ? text.trim() : '' };
    } catch (error) {
      console.warn('[speech] transcription failed:', error);
      return { ok: false, error: 'failed' };
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(unloadRecognizer, IDLE_UNLOAD_MS);
      idleTimer.unref?.();
    }
  });
  queue = run;
  return run;
}
