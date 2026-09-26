import type { DownloadableModel } from '../memory/embedding/downloader';

/** SenseVoice int8：中英日韩粤，自带标点与反正则化；HF 为 sherpa-onnx 作者仓库，ModelScope 为同文件镜像 */
export const SENSE_VOICE_MODEL = {
  id: 'sense-voice-int8-2024-07-17',
  files: [
    {
      name: 'model.int8.onnx',
      sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
    },
    {
      name: 'tokens.txt',
      sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
    },
  ],
  sources: {
    huggingface: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    modelscope: 'pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue',
  },
} as const satisfies DownloadableModel;

/** 模型两文件 + 平台引擎 tgz 约 10MB */
export const SPEECH_APPROX_BYTES = 239_233_841 + 315_894 + 10_000_000;
