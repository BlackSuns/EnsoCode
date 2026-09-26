/** 引擎只吃 16kHz 单声道；采集端负责降采样，Main 只校验 */
export const SPEECH_SAMPLE_RATE = 16_000;
export const SPEECH_MAX_SECONDS = 300;

export type SpeechAssetState = 'unsupported' | 'missing' | 'downloading' | 'ready';

export interface SpeechStatusDto {
  state: SpeechAssetState;
  approxBytes: number;
  downloadedBytes: number;
}

export interface SpeechDownloadProgressDto {
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
