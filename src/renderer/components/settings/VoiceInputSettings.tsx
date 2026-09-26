import type { SpeechModelDto, SpeechModelId } from '@shared/types/speech';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSpeechStatus } from '@/hooks/useSpeechStatus';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { formatBytes } from './MemorySettings';

const MODEL_TEXT: Record<SpeechModelId, { name: string; description: string }> = {
  'x-asr-streaming': {
    name: 'X-ASR Streaming',
    description: 'Text appears while you speak. Chinese and English.',
  },
  'x-asr': {
    name: 'X-ASR',
    description: 'Most accurate on everyday speech. Chinese and English.',
  },
  'qwen3-asr': {
    name: 'Qwen3-ASR 0.6B',
    description: 'Best with mixed Chinese-English and code terms. Slower and uses more memory.',
  },
  'sense-voice': {
    name: 'SenseVoice',
    description: 'Chinese, English, Japanese, Korean and Cantonese.',
  },
};

function DownloadActions({
  state,
  onDownload,
  onCancel,
  onRemove,
}: {
  state: 'missing' | 'downloading' | 'ready';
  onDownload: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  if (state === 'downloading') {
    return (
      <Button variant="outline" size="sm" onClick={onCancel}>
        {t('Cancel')}
      </Button>
    );
  }
  if (state === 'ready') {
    return (
      <Button variant="ghost" size="sm" onClick={onRemove}>
        {t('Remove')}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={onDownload}>
      {t('Download')}
    </Button>
  );
}

/** 识别模型单选；每项标出是否流式、下载体积与内存，并各自下载/删除 */
export function VoiceModelList() {
  const { t } = useI18n();
  const selected = useSettingsStore((state) => state.voiceModel);
  const setSelected = useSettingsStore((state) => state.setVoiceModel);
  const { status, progress, error, refresh } = useSpeechStatus();
  if (!status) return null;
  if (status.state === 'unsupported') {
    return (
      <p className="text-muted-foreground text-xs">
        {t('Voice input is not available on this platform.')}
      </p>
    );
  }
  const api = window.electronAPI.speech;
  const detail = (model: SpeechModelDto) => {
    const current = progress[model.id];
    if (current) {
      return `${current.file} · ${formatBytes(current.received)}${
        current.total ? ` / ${formatBytes(current.total)}` : ''
      } (${current.fileIndex + 1}/${current.fileCount})`;
    }
    if (error?.modelId === model.id) return `${t('Download failed')}: ${error.message}`;
    return t('Download {{size}} · Memory about {{memory}}', {
      size: formatBytes(model.approxBytes),
      memory: formatBytes(model.memoryBytes),
    });
  };
  return (
    <div className="space-y-1.5" data-settings-row="tools.voiceModel">
      <p className="text-sm">{t('Speech model')}</p>
      <div role="radiogroup" className="divide-y rounded-md border">
        {status.models.map((model) => {
          const active = model.id === selected;
          return (
            <div
              key={model.id}
              className={cn('flex items-center gap-3 px-3 py-2', active && 'bg-accent/40')}
            >
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(model.id)}
                className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
              >
                <span
                  className={cn(
                    'mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                    active && 'border-primary'
                  )}
                >
                  {active ? <span className="size-2 rounded-full bg-primary" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm">
                    {t(MODEL_TEXT[model.id].name)}
                    <Badge variant={model.streaming ? 'info' : 'secondary'} size="sm">
                      {model.streaming ? t('Streaming') : t('After you stop')}
                    </Badge>
                    {model.state === 'ready' ? (
                      <Badge variant="success" size="sm">
                        {t('Downloaded')}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-muted-foreground text-xs">
                    {t(MODEL_TEXT[model.id].description)}
                  </span>
                  <span
                    className={cn(
                      'block text-xs',
                      error?.modelId === model.id ? 'text-destructive' : 'text-muted-foreground'
                    )}
                  >
                    {detail(model)}
                  </span>
                </span>
              </button>
              <DownloadActions
                state={model.state}
                onDownload={() => {
                  setSelected(model.id);
                  void api.download(model.id).then(refresh);
                }}
                onCancel={() => void api.cancelDownload(model.id).then(refresh)}
                onRemove={() => void api.remove(model.id).then(refresh)}
              />
            </div>
          );
        })}
      </div>
      {status.state !== 'ready' && status.state !== 'downloading' ? (
        <p className="text-muted-foreground text-xs">
          {t('Download the selected model to start using voice input.')}
        </p>
      ) : null}
    </div>
  );
}
