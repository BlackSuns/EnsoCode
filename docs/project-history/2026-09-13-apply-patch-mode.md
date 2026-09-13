# 可选 apply_patch 编辑模式

## 行为差距与所属层

原配置只有 `hashlineEditEnabled` 开关；目标是在设置中选择文本替换、Hashline 或 `apply_patch`，由 worker 在会话实例创建时互斥装配工具。默认文本替换；已有 Hashline 用户保留选择。运行中的实例不热切换协议。

新模式使用独立 `apply_patch` 工具及 JSON 参数 `{ input: string }`，不是 provider 原生 freeform。该模式不装配 `edit` / `write`，只读工具不带 Hashline 标签；Hashline 模式的生产入口只展示 PUT 协议。

## 必改范围

| 层 | 文件及原因 |
| --- | --- |
| 配置与协议 | `shared/types/editMode.ts`、`shared/types/agent.ts`、settings store/types/migrate、settings IPC、`agentHost.ts`、configSync：枚举、旧配置迁移、参数收窄与下发；合法新枚举优先，局部同步缺字段不重置设置 |
| 设置入口 | `BuiltinToolsSettings.tsx`、i18n、searchAnything、产品能力夹具：三选一与生效时机说明 |
| 补丁执行 | `agent/applyPatch/`：同源语法解析、路径提取、多文件预检、Local/SSH IO、实际落盘结果 |
| 工具运行时 | `supervisor.ts`、Hashline 工具 schema、approval、writeScope、checkpoint、exec、bash 拦截建议与必要工具过滤：互斥装配、所有路径审批和写范围、父子会话一致 |
| 结果链路 | 结果扩展、projection、shared 消息类型、renderer 消息归并、timeline、工具卡、Changes 聚合：只显示实际已应用文件，部分失败仍保留真实变更 |
| 变更快照 | sidePanel store、preload、Changes IPC 和 Main 快照存储：以 `null` 持久记录未知初始基线，防止截断后的中途状态冒充原文件 |

不新增 IPC 通道，复用现有 typed 设置出口。补丁解析按公开语法独立实现，不新增依赖、不复制上游源码。

## 安全与结果契约

- 单次调用使用一对 Begin/End，其中可包含多个 Add/Delete/Update/Move；支持上下文块与 EOF。上下文按 exact → trimEnd 分级唯一匹配，歧义拒绝，不任取第一个。裸 `@@` 仅容忍 ASCII 空格/tab 尾缀，不裁剪非空锚点和正文。
- 解析器同时供执行、全路径提取与权限检查使用，Move 两端都受检查。目标限制于工作区内，目录、符号链接、二进制和冲突路径拒绝。同补丁以 NFC+小写冲突键保守拒绝别名及祖先冲突，但不改变实际 IO 路径。
- 所有文件先读取、校验和内存计算；任一预检失败不产生文件或目录修改。写前复核不等于原子 CAS。
- 局部预算：补丁 1 MiB、100 个物理目标、1000 个 chunk、单文件 4 MiB、总读取 16 MiB、共享 100 万次行比较；超限拒绝。
- 开始写盘后的 I/O 失败或取消不承诺事务回滚。明确报告已写、失败、未尝试及结果不确定的文件；移动拆分操作只记录已实际完成的步骤。
- 工具结果以受控 `details.kind/status/fileChanges` 表达结果。SDK 的 `execute` 返回顶层 `isError` 不生效，抛异常又会丢失 details；因此通过公开 `tool_result` 扩展保留结果并设置错误状态，exec 嵌套调用使用同一判定。
- 保存 BOM 和未修改行的原始换行。投影截断必须显式标记，不能将截断文本作为完整历史快照；未知初始基线持久记录为 `null`，Changes 保留不完整提示。
- 成功、失败、未尝试和结果未知的路径清单独立于正文截断投影，防止长 Applied 列表遮蔽失败结果。

## 明确不做

不修改 provider/freeform 协议，不按模型自动切换，不做全局文件系统事务或外部进程 CAS，不改既有 Hashline 哈希算法和恢复策略，不修理无关 typecheck/lint 问题。

## 验证与限制

- TDD 覆盖路径及别名、整份预检零写、部分失败、取消、编码、上下文歧义、投影截断与持久快照。最终全量测试 4402 通过、4 跳过；构建、源码 Biome、知识检查及独立静态评审通过。
- 隔离 Electron 验证三选一保存为 v10 枚举、跨窗口同步及重新读取；用实际引擎产生的 partial 结果投影验证多文件 diff、自动展开、Changes 自动打开、完整失败清单和 `null` 未知基线落盘。这是 UI＋引擎投影验证，不冒充模型在 Electron 中完成整轮任务。
- Google `gemini-2.5-flash-lite` 与 OpenAI `gpt-5.3-codex` 均完成自然语言任务下的真实 read→apply_patch，多文件增删改、BOM/CRLF、磁盘内容与结果元数据一致。用户 prompt 未提供目标补丁；每例在首个 patch 结果后停止，不声称自然完成整个对话回合。
- 保留兼容性限制：`gpt-4.1-mini` 自主生成曾因格式问题被安全拒绝；Codex 最初也曾拼接多个 envelope，工具说明改为完整多文件示例后单次复验通过。此前给定完整目标补丁的双厂商成功/冲突四例只作为工具链和零写预检证据，不作为自主生成证据。
- 全量 typecheck 仍有既有 `Sidebar.tsx:1801`、`messageCache.test.ts:168` 错误；全量 lint 仍被既有 phone-ios JSON 格式问题阻断，未顺带修改。
- 临时应用 profile、工作区、会话、脚本和凭证副本已清理；不使用用户既有会话，不改写或回滚原凭证配置。
