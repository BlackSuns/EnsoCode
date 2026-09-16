const SEG_SEP = /[\\/]/;

function segmentsOf(path: string): string[] {
  return path.split(SEG_SEP).filter((part) => part.length > 0);
}

function firstDiffIndex(segmentLists: readonly string[][]): number {
  const max = Math.max(0, ...segmentLists.map((segments) => segments.length));
  for (let i = 0; i < max; i++) {
    const part = segmentLists[0]?.[i];
    if (part === undefined || segmentLists.some((segments) => segments[i] !== part)) return i;
  }
  return max;
}

/** 多条候选共享长目录前缀时收成 …/，从最后一层共同父目录起露出分叉段。 */
export function distinguishingPathLabels(paths: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>();
  if (paths.length === 0) return labels;

  const segmentLists = paths.map(segmentsOf);
  let start = 0;
  if (paths.length > 1) {
    const diff = firstDiffIndex(segmentLists);
    start = Math.max(0, diff - 1);
    while (start > 0 && segmentLists.some((segments) => segments.length <= start)) start--;
    if (start < 2) start = 0;
  }

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const segments = segmentLists[i] ?? [];
    const rest = segments.slice(start).join('/');
    labels.set(path, start > 0 ? `…/${rest}` : rest);
  }
  return labels;
}
