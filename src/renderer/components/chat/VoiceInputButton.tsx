import {
  SPEECH_MAX_SECONDS,
  type SpeechErrorCode,
  type SpeechTranscribeResult,
} from '@shared/types/speech';
import { Mic, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/i18n';
import { SilentRecordingError, startVoiceRecording, type VoiceRecording } from '@/lib/voiceCapture';

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

const ICON_BUTTON =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40';

export function VoiceInputButton({
  transcribe,
  requestMicAccess,
  disabled,
  onText,
}: {
  transcribe: (audio: Float32Array) => Promise<SpeechTranscribeResult>;
  requestMicAccess?: () => Promise<boolean>;
  disabled?: boolean;
  onText: (text: string) => void;
}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<VoiceRecording | null>(null);

  useEffect(() => () => recordingRef.current?.cancel(), []);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const cancel = useCallback(() => {
    recordingRef.current?.cancel();
    recordingRef.current = null;
    setPhase('idle');
  }, []);

  const finish = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    recordingRef.current = null;
    setPhase('transcribing');
    try {
      const result = await transcribe(await recording.stop());
      if (!result.ok) setError(t(TRANSCRIBE_ERROR[result.error]));
      else if (!result.text) setError(t('No speech detected.'));
      else onText(result.text);
    } catch (cause) {
      setError(t(cause instanceof SilentRecordingError ? MIC_DENIED : 'Voice input failed.'));
    } finally {
      setPhase('idle');
    }
  }, [onText, t, transcribe]);

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
      recordingRef.current = await startVoiceRecording();
      setElapsed(0);
      setPhase('recording');
    } catch (cause) {
      setPhase('idle');
      setError(t(micErrorKey(cause)));
    }
  };

  return (
    <div className="relative flex shrink-0 items-center">
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
      {error ? (
        <p
          role="status"
          className="absolute bottom-full left-0 z-10 mb-1.5 w-max max-w-64 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
