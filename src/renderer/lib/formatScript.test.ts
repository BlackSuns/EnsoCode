import { describe, expect, it } from 'vitest';
import { formatScript } from './formatScript';

describe('formatScript', () => {
  it('格式化含顶层 await 与顶层 return 的工作流脚本', async () => {
    const result = await formatScript(
      "const r=await agent('hi',{label:'a'})\nif(r){log(r)}\nreturn r"
    );
    expect(result).toEqual({
      ok: true,
      code: "const r = await agent('hi', { label: 'a' });\nif (r) {\n  log(r);\n}\nreturn r;\n",
    });
  });

  it('语法错误时返回带行号的错误，不抛出', async () => {
    const result = await formatScript('const a = ;\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/\(1:\d+\)/);
  });
});
