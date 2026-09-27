# subagent 雇的 coworker 首个 Run 永远停在 running

## 症状

- `subagent spawn mode=coworker` 后子会话早已回复完，`wait` / `report` 仍是「进行中」或 `Run has not reached an immutable result`。
- 接着 `send`（默认 auto）会 steer 进一个已空闲的子会话：消息进不了子会话，带 `wait:true` 时工具调用一直不返回。
- `list` 里同一个 coworker 出现两条，多出来那条的 agentId 是子会话的 instanceId。
- task 模式不受影响；单测全绿。

## 根因

- Main 在每个 `child-ready`（metadata 为 agent-tool + coworker）上调 `agentService.adoptCoworker`，本意是 Main 重启后恢复持久 coworker。
- 活跃 spawn 时，`child-ready` 在 `await runtime.spawn()` 返回前就到了（hireCoworker 要等子会话就绪），AgentService 还没登记这个 agent，adopt 就按 `instanceId` 另建了一条记录。
- 生产里 `instanceId` 由 `reserveChild` 随机生成，与 AgentService 的 `agentId` 不同；spawn 随后以 agentId 登记真记录，同一子会话就有了两条。`observe()` 取第一条身份匹配的记录（先插入的那条），它没有 activeRunId，`turn-completed` 被吞，真 Run 永远不结束。
- 单测替身 `child(agentId)` 让 `instanceId === agentId`，adopt 与 spawn 写同一个键，问题被掩盖。

## 修法

- `AgentService.spawn` 落库前删掉同一子会话（`identity.sessionId`）的已有记录。
- `adoptCoworker` 先按 instanceId、再按同一子会话认领已有记录，只更新身份与状态，不重复登记。
- 不改 instanceId 的生成方式：重启恢复仍以 instanceId 作为 agentId。

## 回归防线

- `src/main/services/agentService.test.ts` 的两条用例：「spawn 途中 child-ready 先触发 adopt 时不留幽灵记录，首个 Run 能正常结束」「spawn 之后同一子会话再次 child-ready 只更新原记录，不重复登记」。替身里 instanceId 与 agentId 不同，adopt 发生在 `runtime.spawn` 返回前。
- 写这类用例时注意 `parseChildSessionIdentity` 要求 instanceId 是 UUID，身份不合法时 `observe()` 会静默忽略事件。
- 真机：coworker spawn 后 `wait` 立即 succeeded，`send` 带 `wait:true` 正常返回，`list` 无重复。

## 相关代码

- `src/main/ipc/agent.ts`：`child-ready` → `adoptCoworker`
- `src/main/services/agentService.ts`：`adoptCoworker` / `spawn` / `observe`
- `src/main/services/agentSessionIndex.ts`：`reserveChild` 随机生成 instanceId
- 同批修复：spawn / send 带 `wait:true` 时停止打不断（`src/agent/agentControl.ts` 对这两类请求只让 Main 打断等待、仍等回执）
