import type { SpeechDownloadProgressDto, SpeechStatusDto } from '@shared/types/speech';
import { useCallback, useEffect, useState } from 'react';

/** 语音模型状态：挂载时查一次，下载结束（任一窗口发起）再查 */
export function useSpeechStatus(active = true) {
  const [status, setStatus] = useState<SpeechStatusDto | null>(null);
  const [progress, setProgress] = useState<SpeechDownloadProgressDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    void window.electronAPI.speech
      .status()
      .then(setStatus)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!active) return;
    refresh();
    return window.electronAPI.speech.onProgress((next) => {
      if (next.done) {
        setProgress(null);
        setError(next.error ?? null);
        refresh();
      } else {
        setProgress(next);
        setError(null);
      }
    });
  }, [active, refresh]);
  return { status, progress, error, refresh };
}
