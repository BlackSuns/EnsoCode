import { SPEECH_SAMPLE_RATE } from '@shared/types/speech';

export function joinChunks(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** 按窗口取均值降到 16kHz：语音够用，且比逐点抽取少混叠 */
export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === SPEECH_SAMPLE_RATE) return input;
  const ratio = inputRate / SPEECH_SAMPLE_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : (input[start] ?? 0);
  }
  return out;
}

export class SilentRecordingError extends Error {}

export interface VoiceRecording {
  /** 结束并返回 16kHz 单声道 PCM；全程无信号（常见于系统拒绝授权）抛 SilentRecordingError */
  stop(): Promise<Float32Array>;
  cancel(): void;
}

/** 须在用户手势内调用：iOS 只允许手势里启动 AudioContext */
export async function startVoiceRecording(): Promise<VoiceRecording> {
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
  const chunks: Float32Array[] = [];
  let peak = 0;
  processor.onaudioprocess = (event) => {
    const data = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
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
      return downsampleTo16k(joinChunks(chunks), context.sampleRate);
    },
  };
}
