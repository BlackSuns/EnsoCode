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

/** 一块音频的响度映射到 0–1，按 dB 线性：-55dB 以下算静音，-10dB 顶满 */
export function levelFromSamples(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / Math.max(1, data.length));
  if (rms === 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) + 55) / 45));
}

export class SilentRecordingError extends Error {}

let primed: AudioContext | null = null;

/**
 * 在点击手势里调用：建好并启动共享 AudioContext。
 * 按住说话从触摸按下开始录，而触摸按下不算用户激活，iOS 不许那时启动音频，只能提前备好。
 */
export function primeVoiceAudio(): AudioContext {
  if (!primed || primed.state === 'closed') primed = new AudioContext();
  if (primed.state !== 'running') void primed.resume().catch(() => {});
  return primed;
}

export function releaseVoiceAudio(): void {
  const context = primed;
  primed = null;
  void context?.close().catch(() => {});
}

export interface VoiceCaptureOptions {
  /** 已启动的 AudioContext（见 primeVoiceAudio），录完不关闭 */
  context?: AudioContext;
  /** 每块原始音频的响度 0–1，画波形用 */
  onLevel?: (level: number) => void;
}

export interface VoiceRecording {
  /** 停止采集；全程无信号（常见于系统拒绝授权）抛 SilentRecordingError */
  stop(): Promise<void>;
  cancel(): void;
}

/** 不传 context 时须在用户手势内调用：iOS 只允许手势里启动 AudioContext。onChunk 收 16kHz 单声道 PCM */
export async function startVoiceRecording(
  onChunk: (samples: Float32Array) => void,
  options: VoiceCaptureOptions = {}
): Promise<VoiceRecording> {
  const owned = !options.context;
  // 先同步建并 resume：等完 getUserMedia 再建，iOS 会判定手势已过期而一直 suspended
  const context = options.context ?? new AudioContext();
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
    if (owned) void context.close();
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
    options.onLevel?.(levelFromSamples(data));
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
    if (owned) void context.close();
  };
  return {
    cancel: release,
    stop: async () => {
      release();
      if (peak === 0) throw new SilentRecordingError('silent recording');
    },
  };
}
