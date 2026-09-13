/** 单条消息最多投影的实际物理文件操作数；引擎应保证单次结果不超过此值。 */
export const PROJECTED_FILE_CHANGE_LIMIT = 256;
/** 单份文件前/后文本的投影字符上限（截断标记本身另占两个字符）。 */
export const PROJECTED_FILE_TEXT_LIMIT = 32_768;
/** apply_patch 引擎的物理路径预算；outcome 四类路径合计不得超过此值。 */
export const PROJECTED_APPLY_PATCH_PATH_COUNT_LIMIT = 100;
/** 路径不可截半后误当实际路径；超过预算的结构化 outcome 整体拒绝。 */
export const PROJECTED_APPLY_PATCH_PATH_TEXT_LIMIT = 4_096;

/** Changes 会话基线；null 表示该路径首次只收到截断预览，基线已不可可靠恢复。 */
export type SessionChangeSnapshots = Record<string, string | null>;

/** apply_patch 已确实落盘的一次物理文件操作。move 由 delete + add 两项表达。 */
export interface AppliedFileChange {
  path: string;
  oldText: string;
  newText: string;
  type: 'add' | 'update' | 'delete';
}

/** 渲染投影中的文件操作；truncated 表示文本仅供预览，禁止作为完整 snapshot 聚合。 */
export interface ProjectedFileChange extends AppliedFileChange {
  truncated?: true;
}

/** apply_patch 的受控终态投影；路径清单不依赖普通正文的截断上限。 */
export interface ProjectedApplyPatchOutcome {
  status: 'success' | 'partial' | 'failed';
  applied: string[];
  failed: string[];
  unattempted: string[];
  uncertain: string[];
  error?: string;
  errorTruncated?: true;
}
