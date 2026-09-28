# 未确认消息导致回退多撤一轮

## 症状

断流后发送“继续”未生效，再回退该消息，之前一轮的任务进度也消失；选择“对话＋文件”时还可能撤掉上一轮文件修改。

## 根因

Renderer 的消息列表包含乐观回显，worker 的当前分支只包含实际持久化记录。两边各自解析 `userIndexFromEnd=0` 时，前者指向未确认的“继续”，后者却指向上一条执行指令。Todo 和 Plan 按回退后的记录重建，进度归零是错误锚点的后果，不是 Plan 主动清空。

## 修法

桌面回退使用持久化 user `entryId`，无 ID 或仍为 optimistic 的消息不允许回退。确认框和冷唤醒等待期间都保留同一 ID；worker 只在当前分支查找该 ID，缺失时拒绝，不能降级为倒数位置。消息投影从源 entry 绑定 ID，不按正文匹配，避免重复“继续”串号。

回退被拒时恢复权威投影，IPC 投递失败时撤销界面乐观裁剪。旧手机协议仍保留数字锚点兼容，本次不改变手机协议或断流重试机制。

## 回归防线

- `conversationRewind.test.ts`：未确认消息、确认框目标消失、分页位移。
- `sessions/index.test.ts`：保留已有进度、冷恢复期间目标变化、投递拒绝和异常。
- `supervisor.compact.test.ts`：缺失 ID 不裁剪、不恢复文件；worker 投影与分支数量不同仍定位同一 ID。
- `transcript.test.ts` / `sessionHistoryTail.test.ts`：重复正文、压缩、冷热投影的 ID 一致且不污染原消息。

## 相关代码

- `src/renderer/stores/sessions/conversationRewind.ts`
- `src/renderer/stores/sessions/index.ts`
- `src/agent/supervisor.ts`
- `src/agent/transcript.ts`
- `src/main/services/sessionHistoryTail.ts`
