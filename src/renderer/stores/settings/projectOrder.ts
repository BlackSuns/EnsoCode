/**
 * 项目自定义排序的纯函数。顺序存渲染侧 localStorage(enso-project-order),
 * 是投影(authority projection)之上的展示层偏好:savedIds 命中的按其顺序,
 * 新项目按投影原序追加末尾,已删除项目的 id 自动失效。
 */

interface HasId {
  id: string;
}

/** 按已存 id 顺序重排项目;savedIds 之外的追加末尾,失效 id 忽略。不修改入参。 */
export function applyProjectOrder<T extends HasId>(
  projects: readonly T[],
  savedIds: readonly string[]
): T[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const ordered: T[] = [];
  for (const id of savedIds) {
    const project = byId.get(id);
    if (project) {
      ordered.push(project);
      byId.delete(id);
    }
  }
  for (const project of projects) {
    if (byId.has(project.id)) ordered.push(project);
  }
  return ordered;
}

/** 把 activeId 移动到 overId 当前的位置,返回移动后的完整 id 顺序(供落盘)。 */
export function moveProject<T extends HasId>(
  projects: readonly T[],
  savedIds: readonly string[],
  activeId: string,
  overId: string
): string[] {
  const ids = applyProjectOrder(projects, savedIds).map((project) => project.id);
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return ids;
  ids.splice(from, 1);
  ids.splice(to, 0, activeId);
  return ids;
}

/** 置顶项目按 pinnedIds 顺序排前，其余保持原相对顺序。失效 id 忽略。不修改入参。 */
export function partitionPinnedProjects<T extends HasId>(
  projects: readonly T[],
  pinnedIds: readonly string[]
): { pinned: T[]; rest: T[] } {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const pinned: T[] = [];
  const used = new Set<string>();
  for (const id of pinnedIds) {
    const project = byId.get(id);
    if (!project) continue;
    pinned.push(project);
    used.add(id);
  }
  return { pinned, rest: projects.filter((project) => !used.has(project.id)) };
}

/** 未置顶则插到最前，已置顶则移除。 */
export function togglePinnedProjectId(pinnedIds: readonly string[], id: string): string[] {
  return pinnedIds.includes(id) ? pinnedIds.filter((entry) => entry !== id) : [id, ...pinnedIds];
}

/** 两边都置顶则重排置顶序；两边都未置顶则重排项目序；跨越边界不排。 */
export function projectReorderScope(
  activeId: string,
  overId: string,
  pinnedIds: readonly string[]
): 'pinned' | 'order' | null {
  const activePinned = pinnedIds.includes(activeId);
  const overPinned = pinnedIds.includes(overId);
  if (activePinned && overPinned) return 'pinned';
  if (!activePinned && !overPinned) return 'order';
  return null;
}
