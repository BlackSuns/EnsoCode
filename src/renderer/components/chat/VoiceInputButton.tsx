import type { StartVoiceSession } from '@shared/types/speech';
import { Mic, Square, X } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/i18n';
import { Z_INDEX } from '@/lib/z-index';
import { useVoiceInput } from './useVoiceInput';
import { voiceNotePlacement } from './voiceNotePlacement';

/** 预览只留最近的一段，长句不撑满屏幕 */
const PREVIEW_CHARS = 120;

type Placement = ReturnType<typeof voiceNotePlacement>;

function measure(anchor: HTMLElement): Placement {
  const rect = anchor.getBoundingClientRect();
  return voiceNotePlacement(rect, { width: window.innerWidth, height: window.innerHeight });
}

/**
 * 输入框工具栏 overflow-hidden 会裁掉绝对定位的气泡，portal 到 body 按按钮位置固定定位。
 * 录音中窗口缩放、侧栏开合都会挪动按钮，逐帧跟随（只在位置变了才重渲染）。
 */
function VoiceNote({
  anchor,
  status,
  children,
}: {
  anchor: HTMLElement;
  status: boolean;
  children: ReactNode;
}) {
  const [placement, setPlacement] = useState(() => measure(anchor));
  useLayoutEffect(() => {
    let frame = 0;
    const follow = () => {
      const next = measure(anchor);
      setPlacement((prev) =>
        prev.left === next.left && prev.bottom === next.bottom && prev.maxWidth === next.maxWidth
          ? prev
          : next
      );
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [anchor]);
  return createPortal(
    <p
      role={status ? 'status' : undefined}
      aria-live="polite"
      data-testid={status ? undefined : 'voice-partial'}
      style={{ position: 'fixed', ...placement, zIndex: Z_INDEX.TOOLTIP }}
      className="w-max rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md"
    >
      {children}
    </p>,
    document.body
  );
}

export const ICON_BUTTON =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40';

export function VoiceInputButton({
  startSession,
  requestMicAccess,
  disabled,
  onText,
}: {
  startSession: StartVoiceSession;
  requestMicAccess?: () => Promise<boolean>;
  disabled?: boolean;
  onText: (text: string) => void;
}) {
  const { t } = useI18n();
  const { phase, elapsed, error, partial, correcting, start, finish, cancel } = useVoiceInput({
    startSession,
    requestMicAccess,
    onText,
  });
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== 'recording') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cancel, phase]);

  const preview = partial.length > PREVIEW_CHARS ? `…${partial.slice(-PREVIEW_CHARS)}` : partial;
  const busyLabel =
    phase === 'transcribing' ? t(correcting ? 'Correcting…' : 'Transcribing…') : null;

  return (
    <div ref={anchorRef} className="relative flex shrink-0 items-center">
      {phase === 'recording' ? (
        <>
          <button
            type="button"
            onClick={() => void finish()}
            aria-label={t('Stop recording')}
            title={t('Stop recording')}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-destructive transition-colors hover:bg-destructive/10"
          >
            <span className="relative flex size-2">
              <span className="absolute size-2 animate-ping rounded-full bg-destructive/60" />
              <span className="relative size-2 rounded-full bg-destructive" />
            </span>
            <span className="text-xs tabular-nums">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </span>
            <Square className="h-3 w-3 fill-current" />
          </button>
          <button
            type="button"
            onClick={cancel}
            aria-label={t('Cancel recording')}
            title={`${t('Cancel recording')} (Esc)`}
            className={ICON_BUTTON}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled || phase !== 'idle'}
          onClick={() => void start()}
          aria-label={busyLabel ?? t('Voice input')}
          title={busyLabel ?? t('Voice input')}
          className={ICON_BUTTON}
        >
          {phase === 'idle' ? <Mic className="h-3.5 w-3.5" /> : <Spinner className="h-3.5 w-3.5" />}
        </button>
      )}
      {anchorRef.current && (error || partial) ? (
        <VoiceNote anchor={anchorRef.current} status={Boolean(error)}>
          {error ??
            (correcting ? (
              <span className="flex items-start gap-1.5">
                <Spinner aria-hidden className="mt-0.5 size-3 shrink-0" />
                <span>
                  <span className="text-muted-foreground">{t('Correcting…')} </span>
                  {preview}
                </span>
              </span>
            ) : (
              preview
            ))}
        </VoiceNote>
      ) : null}
    </div>
  );
}
