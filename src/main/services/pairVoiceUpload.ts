import { decodeVoiceChunk } from '@enso/pair';
import { SPEECH_MAX_SECONDS, SPEECH_SAMPLE_RATE, type SpeechErrorCode } from '@shared/types/speech';

/**
 * 手机语音分块拼包（单连接一份）。直连/中继回退会乱序，按 index 存；
 * 收到 last 才知道总块数，齐了才交付。
 */

export interface VoiceChunkInput {
  requestId: string;
  index: number;
  data: string;
  last?: true;
}

export type VoiceUploadResult =
  | { kind: 'complete'; requestId: string; samples: Float32Array }
  | { kind: 'error'; requestId: string; error: SpeechErrorCode };

interface Upload {
  startedAt: number;
  chunks: Map<number, Int16Array>;
  total?: number;
  samples: number;
}

/** 已失败/超时的 requestId 记一阵，后续分块静默丢弃，避免重建半截上传占名额 */
const DEAD_MAX = 32;

export class VoiceUploads {
  private uploads = new Map<string, Upload>();
  private dead = new Map<string, number>();
  private readonly maxSamples: number;
  private readonly maxActive: number;
  private readonly ttlMs: number;

  constructor(limits: { maxSamples?: number; maxActive?: number; ttlMs?: number } = {}) {
    this.maxSamples = limits.maxSamples ?? SPEECH_SAMPLE_RATE * SPEECH_MAX_SECONDS;
    this.maxActive = limits.maxActive ?? 2;
    this.ttlMs = limits.ttlMs ?? 120_000;
  }

  /** null = 等待更多分块或已忽略 */
  accept(chunk: VoiceChunkInput, now: number): VoiceUploadResult | null {
    this.prune(now);
    const { requestId, index } = chunk;
    if (this.dead.has(requestId)) return null;
    let upload = this.uploads.get(requestId);
    if (!upload) {
      if (this.uploads.size >= this.maxActive) return this.fail(requestId, 'failed', now);
      upload = { startedAt: now, chunks: new Map(), samples: 0 };
      this.uploads.set(requestId, upload);
    }
    const pcm = decodeVoiceChunk(chunk.data);
    if (!pcm || upload.chunks.has(index)) return this.fail(requestId, 'invalid-audio', now);
    if (chunk.last) {
      if (upload.total !== undefined) return this.fail(requestId, 'invalid-audio', now);
      upload.total = index + 1;
      for (const i of upload.chunks.keys()) {
        if (i >= index) return this.fail(requestId, 'invalid-audio', now);
      }
    } else if (upload.total !== undefined && index >= upload.total) {
      return this.fail(requestId, 'invalid-audio', now);
    }
    upload.samples += pcm.length;
    if (upload.samples > this.maxSamples) return this.fail(requestId, 'invalid-audio', now);
    upload.chunks.set(index, pcm);
    if (upload.chunks.size !== upload.total) return null;
    this.uploads.delete(requestId);
    const samples = new Float32Array(upload.samples);
    let offset = 0;
    for (let i = 0; i < upload.total; i++) {
      const part = upload.chunks.get(i) as Int16Array;
      for (let j = 0; j < part.length; j++) samples[offset + j] = part[j] / 32768;
      offset += part.length;
    }
    return { kind: 'complete', requestId, samples };
  }

  clear(): void {
    this.uploads.clear();
    this.dead.clear();
  }

  private fail(requestId: string, error: SpeechErrorCode, now: number): VoiceUploadResult {
    this.uploads.delete(requestId);
    this.markDead(requestId, now);
    return { kind: 'error', requestId, error };
  }

  private markDead(requestId: string, now: number): void {
    this.dead.set(requestId, now);
    if (this.dead.size > DEAD_MAX) this.dead.delete(this.dead.keys().next().value as string);
  }

  private prune(now: number): void {
    for (const [id, upload] of this.uploads) {
      if (now - upload.startedAt > this.ttlMs) {
        this.uploads.delete(id);
        this.markDead(id, now);
      }
    }
    for (const [id, at] of this.dead) {
      if (now - at > this.ttlMs) this.dead.delete(id);
    }
  }
}
