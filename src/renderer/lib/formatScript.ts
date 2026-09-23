export type FormatResult = { ok: true; code: string } | { ok: false; error: string };

/** 按需加载 prettier 格式化 JS；babel 解析器允许顶层 await / return，适配工作流脚本 */
export async function formatScript(code: string): Promise<FormatResult> {
  const [prettier, babel, estree] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
  ]);
  try {
    const formatted = await prettier.format(code, {
      parser: 'babel',
      plugins: [babel, estree],
      singleQuote: true,
      printWidth: 100,
      trailingComma: 'es5',
    });
    return { ok: true, code: formatted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.split('\n')[0] ?? message };
  }
}
