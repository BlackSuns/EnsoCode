const SEG_SEP = /[\\/]/;

function segmentsOf(path: string): string[] {
  return path.split(SEG_SEP).filter((part) => part.length > 0);
}

/** 优先显示末两层父目录；后缀相同时向前展开，直到能区分候选。 */
export function distinguishingPathLabels(paths: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>();
  const segmentLists = paths.map(segmentsOf);
  const normalizedPaths = segmentLists.map((segments) => segments.join('/'));

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const segments = segmentLists[i] ?? [];
    let start = Math.max(0, segments.length - 3);
    while (start > 0) {
      const suffix = segments.slice(start).join('/');
      const ambiguous = normalizedPaths.some(
        (other) =>
          other !== normalizedPaths[i] && (other === suffix || other.endsWith(`/${suffix}`))
      );
      if (!ambiguous) break;
      start--;
    }
    const rest = segments.slice(start).join('/');
    labels.set(path, start > 0 ? `…/${rest}` : rest);
  }
  return labels;
}
