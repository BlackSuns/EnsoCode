import { PROJECTED_FILE_TEXT_LIMIT } from './types/fileChanges';

const TRUNCATED_TAIL = '\n…';

/** worker 投影把超长 text 截成「前 PROJECTED_FILE_TEXT_LIMIT 字 + '\n…'」；是则返回前缀，否则 null */
export function truncatedProjectionHead(projected: string): string | null {
  return projected.length >= PROJECTED_FILE_TEXT_LIMIT && projected.endsWith(TRUNCATED_TAIL)
    ? projected.slice(0, -TRUNCATED_TAIL.length)
    : null;
}
