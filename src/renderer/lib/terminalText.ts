// biome-ignore lint/suspicious/noControlCharactersInRegex: 匹配终端 OSC（标题、超链接），含流式末尾未闭合序列
const OSC_RE = /(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|$)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: 匹配终端 CSI（颜色、光标），含流式末尾未闭合序列
const CSI_RE = /(?:\x1b\[|\x9b)[0-?]*[ -/]*(?:[@-~]|$)/g;

export function stripAnsi(text: string): string {
  return text.replace(OSC_RE, '').replace(CSI_RE, '');
}
