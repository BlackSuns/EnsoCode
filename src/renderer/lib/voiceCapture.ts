import { SPEECH_SAMPLE_RATE } from '@shared/types/speech';

/**
 * 边录边降到 16kHz：按窗口取均值（比逐点抽取少混叠），跨块保留未凑满窗口的尾巴，
 * 任意切块结果都与整段一次处理一致。
 */
export function createDownsampler(inputRate: number): (chunk: Float32Array) => Float32Array {
  if (inputRate === SPEECH_SAMPLE_RATE) return (chunk) => chunk;
  const ratio = inputRate / SPEECH_SAMPLE_RATE;
  let pending = new Float32Array(0);
  /** pending[0] 在整段输入中的下标 */
  let base = 0;
  let produced = 0;
  return (chunk) => {
    const input = new Float32Array(pending.length + chunk.length);
    input.set(pending);
    input.set(chunk, pending.length);
    const end = base + input.length;
    const out: number[] = [];
    for (;;) {
      const from = Math.floor(produced * ratio);
      const to = Math.floor((produced + 1) * ratio);
      if (to > end) break;
      let sum = 0;
      for (let j = from; j < to; j++) sum += input[j - base];
      out.push(to > from ? sum / (to - from) : (input[from - base] ?? 0));
      produced++;
    }
    const keep = Math.floor(produced * ratio);
    pending = input.slice(keep - base);
    base = keep;
    return Float32Array.from(out);
  };
}

export class SilentRecordingError extends Error {}

export interface VoiceRecording {
  /** 停止采集；全程无信号（常见于系统拒绝授权）抛 SilentRecordingError */
  stop(): Promise<void>;
  cancel(): void;
}

/** 须在用户手势内调用：iOS 只允许手势里启动 AudioContext。onChunk 收 16kHz 单声道 PCM */
export async function startVoiceRecording(
  onChunk: (samples: Float32Array) => void
): Promise<VoiceRecording> {
  // 先同步建并 resume：等完 getUserMedia 再建，iOS 会判定手势已过期而一直 suspended
  const context = new AudioContext();
  const resumed = context.resume();
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    // 没有用户激活时 resume 永不落定（Chrome 自动播放策略），别让按钮一直转圈
    await Promise.race([
      resumed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('audio context stayed suspended')), 3000)
      ),
    ]);
  } catch (error) {
    for (const track of stream?.getTracks() ?? []) track.stop();
    void context.close();
    throw error;
  }
  const tracks = stream.getTracks();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor 已弃用但 Safari/Electron 都可用，免去 AudioWorklet 的模块加载与 CSP
  const processor = context.createScriptProcessor(4096, 1, 1);
  const downsample = createDownsampler(context.sampleRate);
  let peak = 0;
  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const samples = downsample(new Float32Array(data));
    if (samples.length > 0) onChunk(samples);
  };
  source.connect(processor);
  processor.connect(context.destination);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    processor.onaudioprocess = null;
    processor.disconnect();
    source.disconnect();
    for (const track of tracks) track.stop();
    void context.close();
  };
  return {
    cancel: release,
    stop: async () => {
      release();
      if (peak === 0) throw new SilentRecordingError('silent recording');
    },
  };
}
