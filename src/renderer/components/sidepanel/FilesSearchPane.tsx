import type { FilesSearchContentHit, FilesSearchMode, FilesSearchResult } from '@shared/types';
import { Files, FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { fileTypeIcon, fileTypeIconClass } from './fileIcons';

interface FilesSearchPaneProps {
  conversationId: string;
  projectId: string;
  onOpenFile: (rel: string) => void;
  onClose: () => void;
}

export function FilesSearchPane({
  conversationId,
  projectId,
  onOpenFile,
  onClose,
}: FilesSearchPaneProps) {
  const { t } = useI18n();
  const seqRef = useRef(0);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FilesSearchMode>('names');
  const [result, setResult] = useState<FilesSearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      seqRef.current += 1;
      setResult(null);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void window.electronAPI.workspaceFiles
        .search({ conversationId, projectId, query, mode })
        .then((next) => {
          if (seq !== seqRef.current) return;
          setResult(next);
          setLoading(false);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [conversationId, mode, projectId, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1 px-1 pb-1">
        <Input
          size="sm"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
          placeholder={mode === 'names' ? t('Search file names') : t('Search file contents')}
          aria-label={t('Search')}
        />
        <div className="flex gap-0.5">
          <ModeButton
            active={mode === 'names'}
            onClick={() => setMode('names')}
            label={t('File name')}
            icon={Files}
          />
          <ModeButton
            active={mode === 'content'}
            onClick={() => setMode('content')}
            label={t('Content')}
            icon={FileText}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 pb-1">
        {!query.trim() ? (
          <p className="px-1 py-2 text-muted-foreground text-xs">
            {t('Type to search this workspace.')}
          </p>
        ) : loading && !result ? (
          <p className="px-1 py-2 text-muted-foreground text-xs">{t('Searching…')}</p>
        ) : result && !result.ok ? (
          <p className="px-1 py-2 text-muted-foreground text-xs">
            {t(
              result.error === 'unsupported'
                ? 'Search is not available for SSH workspaces.'
                : 'Could not complete the file action.'
            )}
          </p>
        ) : result?.ok && result.hits.length === 0 ? (
          <p className="px-1 py-2 text-muted-foreground text-xs">{t('No results')}</p>
        ) : result?.ok && result.mode === 'names' ? (
          result.hits.map((hit) => {
            const Icon = fileTypeIcon(hit.name, false);
            return (
              <button
                key={hit.relativePath}
                type="button"
                className="flex w-full items-start gap-1 rounded-sm px-1 py-0.5 text-left hover:bg-muted"
                onClick={() => onOpenFile(hit.relativePath)}
              >
                <Icon
                  className={cn('mt-0.5 size-3.5 shrink-0', fileTypeIconClass(hit.name, false))}
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs">{hit.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {hit.relativePath}
                  </span>
                </span>
              </button>
            );
          })
        ) : result?.ok && result.mode === 'content' ? (
          result.hits.map((hit) => (
            <ContentHitRow key={contentKey(hit)} hit={hit} onOpenFile={onOpenFile} />
          ))
        ) : null}
      </div>
    </div>
  );
}

function contentKey(hit: FilesSearchContentHit): string {
  return `${hit.relativePath}:${hit.line}:${hit.column}`;
}

function ContentHitRow({
  hit,
  onOpenFile,
}: {
  hit: FilesSearchContentHit;
  onOpenFile: (rel: string) => void;
}) {
  const name = hit.relativePath.split('/').pop() || hit.relativePath;
  const Icon = fileTypeIcon(name, false);
  return (
    <button
      type="button"
      className="flex w-full items-start gap-1 rounded-sm px-1 py-0.5 text-left hover:bg-muted"
      onClick={() => onOpenFile(hit.relativePath)}
    >
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', fileTypeIconClass(name, false))} />
      <span className="min-w-0">
        <span className="block truncate text-xs">
          {name}
          <span className="text-muted-foreground">:{hit.line}</span>
        </span>
        <span className="block truncate font-mono text-[10px] text-muted-foreground">
          {hit.content.trim()}
        </span>
      </span>
    </button>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: typeof Files;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-6 flex-1 px-1 text-xs', active && 'bg-muted')}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      {label}
    </Button>
  );
}
