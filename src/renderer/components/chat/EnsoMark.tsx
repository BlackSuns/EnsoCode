import { cn } from '@/lib/utils';

/** 应用标识（ensō 圆弧），随 currentColor 着色 */
export function EnsoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={cn('size-4', className)}>
      <path
        d="M 38.96 48.86 A 18.24 18.24 0 1 1 48.19 40.4"
        stroke="currentColor"
        strokeWidth="8.32"
        strokeLinecap="round"
      />
    </svg>
  );
}
