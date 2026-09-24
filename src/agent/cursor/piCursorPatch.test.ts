import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

describe('pi-cursor pnpm patch', () => {
  it('keeps Enso exec/interaction hooks on the installed 1.4.38 bundle', () => {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@rahularya01/pi-cursor/package.json');
    const { version } = JSON.parse(readFileSync(pkgJson, 'utf8')) as { version: string };
    expect(version).toBe('1.4.38');
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).toContain('__ensoCursorHandleInteraction');
    expect(bundle).toContain('__ensoCursorHandleExec');
  });

  // 上游 1.4.37 起按 exec case 累计原生本地工具拒绝数，满 8 次掐断本轮；Enso 接管执行的帧不能计入
  it('exempts Enso-handled native exec frames from the local tool rejection counter', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).toMatch(/\.__ensoHandled=true/);
    expect(bundle).toMatch(/&&!\w+\.__ensoHandled&&\(\w+\.localToolRejections=/);
  });

  // Rahularya01/pi-cursor#40：GetDynamicTools 不列 pi 命名空间，Claude 类模型据此放弃；规则和拒绝文案都要指明 CallDynamicTool
  it('guides models to CallDynamicTool when the pi namespace is missing from discovery', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    // 规则文案在双引号字符串里（引号转义），拒绝文案在模板字符串里
    expect(bundle).toContain(
      'call them with CallDynamicTool using namespace \\"pi\\" and toolName \\"mcp_pi_<name>\\"'
    );
    expect(bundle).toContain(
      'call them with CallDynamicTool using namespace "pi" and toolName set to the listed name'
    );
  });

  // 上游 1.4.32 已不再发 model_details（#23）。回归守卫：补丁只挂 hook，不能把字段加回去。
  it('keeps the upstream Run request without modelDetails', () => {
    const require = createRequire(import.meta.url);
    const bundle = readFileSync(require.resolve('@rahularya01/pi-cursor'), 'utf8');
    expect(bundle).not.toContain('modelDetails');
    expect(bundle).toMatch(/requestedModel:\w+/);
  });
});
