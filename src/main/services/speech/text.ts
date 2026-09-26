/** 识别结果的纯文本处理，不依赖 Electron */

export function normalizeTranscript(text: string): string {
  return (
    text
      // Qwen3-ASR 偶发把残缺字节解成 U+FFFD
      .replace(/\uFFFD/g, '')
      // X-ASR 在中文标点后多带一个空格
      .replace(/([，。？！、；：])\s+/g, '$1')
      .trim()
  );
}
