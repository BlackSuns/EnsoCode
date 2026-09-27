export interface MemorySearchHit {
  id: string;
  title: string;
  content: string;
  unitType: string | null;
  space: 'global' | 'project' | null;
  score: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** memory_search 输出（Main bridge 投影的 JSON）→ 命中列表；形状不符返回 null，由调用方回退原文 */
export function parseMemorySearchHits(output: string | null): MemorySearchHit[] | null {
  if (!output) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) return null;
  const hits: MemorySearchHit[] = [];
  for (const raw of parsed.results) {
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      !raw.id ||
      typeof raw.title !== 'string' ||
      typeof raw.content !== 'string'
    ) {
      return null;
    }
    const { spaceId, score } = raw;
    hits.push({
      id: raw.id,
      title: raw.title,
      content: raw.content,
      unitType: typeof raw.unitType === 'string' && raw.unitType ? raw.unitType : null,
      space:
        spaceId === 'global'
          ? 'global'
          : typeof spaceId === 'string' && spaceId.startsWith('proj:')
            ? 'project'
            : null,
      score: typeof score === 'number' && Number.isFinite(score) ? score : null,
    });
  }
  return hits;
}
