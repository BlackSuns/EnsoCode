# apply_patch 显式绝对路径支持

## 行为差距与所属层

文本替换和 Hashline 可按既有审批规则修改工作区外的绝对路径，但 `apply_patch` 在自身路径归一化及 Local/SSH IO 层硬性限制为 cwd 内相对路径。目标是允许显式本地 POSIX 绝对路径、Windows 完整盘符绝对路径及 SSH POSIX 绝对路径；相对路径仍不得以 `../` 逃逸。

## 必改文件

- `src/agent/applyPatch/localIo.ts`：区分 cwd 内相对路径、POSIX/Windows 完整盘符绝对路径及平台非法路径，保持逐段符号链接和文件类型检查。
- `src/agent/applyPatch/remoteIo.ts`：将 POSIX 绝对目标安全拆为根目录与相对段，继续以独立 argv 传递；拒绝 Windows 盘符和 UNC。
- `src/agent/applyPatch/engine.ts`：让冲突检查基于同一物理路径语义，覆盖相对/绝对别名及跨表示祖先冲突。
- `src/agent/applyPatch/tool.ts`：说明显式绝对路径可用、相对逃逸仍禁止。
- 对应 applyPatch、scope/approval 测试：先复现外部路径失败，再锁定既有安全边界。

## 明确不做

不恢复 `edit` 共存，不修改 `writeScope` 或审批配置，不新增受信目录设置，不新增 Windows UNC 或无盘符 root-relative 支持，不允许相对路径逃逸，不削弱目录穿越、符号链接、Move 双端、全量预检、别名冲突、预算、取消及 partial/uncertain 检查。SSH 远端路径与本机同名文件污染属于既存相邻风险，本次不扩修。也不改写 `v0.1.27` tag、不发布版本。

## 验证

- 定向测试 100 例通过；全量测试 4444 例通过、4 例 live SSH 跳过；build、相关 13 文件 Biome 与 knowledge 检查均为 0。typecheck/lint 仅剩既有的 2 个 TypeScript 错误、29 个生成文件格式错误和 2 个 warning。
- Google 自然 supervised 单 patch 成功修改相对路径与工作区外绝对路径，覆盖 BOM/CRLF；审批一次包含两个目标，raw、投影与磁盘结果一致。
- Codex 以不同的 plain LF 用例自然单 patch 成功；安全 JSON 复核确认 raw、投影与磁盘一致、一次审批包含两个目标，schema/prepare 正常且未暴露 `edit`/`write`。

以上模型验证均在首个 patch result 后立即中止，仅证明该次 patch，不代表完整 turn。Codex 早先 minimal 请求的 400 为 harness 配置错误；其有效 BOM 用例因模型在旧行中携带 BOM，随后在 harness approval 处失败且未保留 raw result。父代理仅以同 payload 离线重放确认 context mismatch 且零写，不能视为该实际轮次取证，也不能用 plain LF 成功宣称 BOM 用例成功；这是既有匹配/模型格式限制，本轮不扩修。Google staged auth 期间发生合法 OAuth 刷新，原配置仅被读取，未验证并发状态不变。
