/** 引擎只吃 16kHz 单声道；采集端负责降采样，Main 只校验 */
export const SPEECH_SAMPLE_RATE = 16_000;
export const SPEECH_MAX_SECONDS = 300;

export const SPEECH_MODEL_IDS = ['x-asr-streaming', 'x-asr', 'qwen3-asr', 'sense-voice'] as const;
export type SpeechModelId = (typeof SPEECH_MODEL_IDS)[number];
export const DEFAULT_SPEECH_MODEL_ID: SpeechModelId = 'x-asr-streaming';

export function isSpeechModelId(value: unknown): value is SpeechModelId {
  return typeof value === 'string' && (SPEECH_MODEL_IDS as readonly string[]).includes(value);
}

export type SpeechAssetState = 'unsupported' | 'missing' | 'downloading' | 'ready';

export interface SpeechModelDto {
  id: SpeechModelId;
  /** 边说边出字 */
  streaming: boolean;
  /** 下载体积 */
  approxBytes: number;
  /** 加载后常驻内存估算 */
  memoryBytes: number;
  downloadedBytes: number;
  state: Exclude<SpeechAssetState, 'unsupported'>;
}

export interface SpeechStatusDto {
  /** 所选模型连同引擎是否可用 */
  state: SpeechAssetState;
  selected: SpeechModelId;
  models: SpeechModelDto[];
}

export interface SpeechDownloadProgressDto {
  modelId: SpeechModelId;
  file: string;
  fileIndex: number;
  fileCount: number;
  received: number;
  total: number | null;
  done?: true;
  error?: string;
}

export type SpeechErrorCode = 'disabled' | 'not-ready' | 'invalid-audio' | 'failed';

export type SpeechTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: SpeechErrorCode };

/** 录音会话 id 由发起方生成，Main 按来源窗口隔离 */
export const SPEECH_SESSION_ID_MAX = 64;

export interface SpeechPartialDto {
  sessionId: string;
  text: string;
}

/** 输入框录音会话：边录边推 16kHz PCM，中间结果经 onPartial 回调，finish 给定稿（已纠错） */
export interface VoiceSession {
  push(samples: Float32Array): void;
  finish(): Promise<SpeechTranscribeResult>;
  cancel(): void;
}

export type StartVoiceSession = (onPartial: (text: string) => void) => VoiceSession;
