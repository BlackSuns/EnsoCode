import {
  SPEECH_MAX_SECONDS,
  type SpeechErrorCode,
  type StartVoiceSession,
  type VoiceSession,
} from '@shared/types/speech';
import { Mic, Square, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/i18n';
import { SilentRecordingError, startVoiceRecording, type VoiceRecording } from '@/lib/voiceCapture';
import { Z_INDEX } from '@/lib/z-index';
import { voiceNotePlacement } from './voiceNotePlacement';

type Phase = 'idle' | 'starting' | 'recording' | 'transcribing';

const MIC_DENIED = 'Microphone access denied. Allow it in system settings.';

const TRANSCRIBE_ERROR: Record<SpeechErrorCode, string> = {
  disabled: 'Voice input is turned off.',
  'not-ready': 'The speech model is not downloaded yet.',
  'invalid-audio': 'The recording was empty or too long.',
  failed: 'Voice input failed.',
};

function micErrorKey(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return MIC_DENIED;
  return 'Voice input failed.';
}

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

const ICON_BUTTON =
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
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState('');
  const recordingRef = useRef<VoiceRecording | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      recordingRef.current?.cancel();
      sessionRef.current?.cancel();
    },
    []
  );

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const cancel = useCallback(() => {
    recordingRef.current?.cancel();
    sessionRef.current?.cancel();
    recordingRef.current = null;
    sessionRef.current = null;
    setPartial('');
    setPhase('idle');
  }, []);

  const finish = useCallback(async () => {
    const recording = recordingRef.current;
    const session = sessionRef.current;
    if (!recording || !session) return;
    recordingRef.current = null;
    setPhase('transcribing');
    try {
      await recording.stop();
      const result = await session.finish();
      if (!result.ok) setError(t(TRANSCRIBE_ERROR[result.error]));
      else if (!result.text) setError(t('No speech detected.'));
      else onText(result.text);
    } catch (cause) {
      session.cancel();
      setError(t(cause instanceof SilentRecordingError ? MIC_DENIED : 'Voice input failed.'));
    } finally {
      sessionRef.current = null;
      setPartial('');
      setPhase('idle');
    }
  }, [onText, t]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [cancel, phase]);

  useEffect(() => {
    if (phase === 'recording' && elapsed >= SPEECH_MAX_SECONDS) void finish();
  }, [elapsed, finish, phase]);

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('Voice input needs a secure (HTTPS) connection.'));
      return;
    }
    setPhase('starting');
    try {
      if (requestMicAccess && !(await requestMicAccess())) {
        throw new DOMException('microphone denied', 'NotAllowedError');
      }
      const session = startSession((text) => {
        if (sessionRef.current === session) setPartial(text);
      });
      sessionRef.current = session;
      try {
        recordingRef.current = await startVoiceRecording((samples) => session.push(samples));
      } catch (cause) {
        session.cancel();
        sessionRef.current = null;
        throw cause;
      }
      setPartial('');
      setElapsed(0);
      setPhase('recording');
    } catch (cause) {
      setPhase('idle');
      setError(t(micErrorKey(cause)));
    }
  };

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
          aria-label={phase === 'transcribing' ? t('Transcribing…') : t('Voice input')}
          title={phase === 'transcribing' ? t('Transcribing…') : t('Voice input')}
          className={ICON_BUTTON}
        >
          {phase === 'idle' ? <Mic className="h-3.5 w-3.5" /> : <Spinner className="h-3.5 w-3.5" />}
        </button>
      )}
      {anchorRef.current && (error || partial) ? (
        <VoiceNote anchor={anchorRef.current} status={Boolean(error)}>
          {error ??
            (partial.length > PREVIEW_CHARS ? `…${partial.slice(-PREVIEW_CHARS)}` : partial)}
        </VoiceNote>
      ) : null}
    </div>
  );
}
