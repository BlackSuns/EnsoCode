import type {
  WorkflowPresetArg,
  WorkflowPresetDraft,
  WorkflowPresetSummary,
} from '@shared/types/workflow';
import { CircleAlert, Loader2, Pencil, Plus, Trash2, Workflow, X } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';

const NEW_DRAFT: WorkflowPresetDraft = {
  name: '',
  description: '',
  args: [{ key: 'topic', label: 'Topic', required: true }],
  script: `await phase('investigate');
const notes = await parallel([
  () => agent('Investigate ' + args.topic + ' in the source code.', { label: 'code', agentType: 'scout' }),
  () => agent('Investigate ' + args.topic + ' in the tests.', { label: 'tests', agentType: 'scout' }),
]);
return notes;
`,
};

/** 表单里空默认值/空标签不落盘，标签缺省用 key。 */
function normalizeArgs(args: WorkflowPresetArg[]): WorkflowPresetArg[] {
  return args.map(({ key, label, default: value, required }) => ({
    key: key.trim(),
    label: label.trim() || key.trim(),
    ...(value?.trim() ? { default: value } : {}),
    ...(required ? { required: true } : {}),
  }));
}

function WorkflowPresetDialog({
  target,
  onClose,
  onSaved,
}: {
  target: string | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState<WorkflowPresetDraft>(NEW_DRAFT);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setError(null);
    if (target === null) return;
    if (target === 'new') {
      setDraft(NEW_DRAFT);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void window.electronAPI.workflowPresets
      .read(target)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          const { id: _id, ...rest } = loaded;
          setDraft(rest);
        } else setError(t('Failed to read content'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target, t]);

  const patch = (next: Partial<WorkflowPresetDraft>) => setDraft((d) => ({ ...d, ...next }));
  const patchArg = (index: number, next: Partial<WorkflowPresetArg>) =>
    patch({ args: draft.args.map((arg, i) => (i === index ? { ...arg, ...next } : arg)) });
  const canSave =
    !loading &&
    !saving &&
    draft.name.trim() !== '' &&
    draft.description.trim() !== '' &&
    draft.script.trim() !== '';

  const handleSave = async () => {
    if (!canSave || target === null) return;
    setSaving(true);
    const result = await window.electronAPI.workflowPresets.save(
      { ...draft, args: normalizeArgs(draft.args) },
      target === 'new' ? undefined : target
    );
    setSaving(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {target === 'new' ? t('Add workflow preset') : t('Edit workflow preset')}
          </DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Field>
            <FieldLabel>{t('Name')}</FieldLabel>
            <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel>{t('Description')}</FieldLabel>
            <Input
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>{t('Arguments')}</FieldLabel>
            <div className="w-full space-y-1.5">
              {draft.args.map((arg, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 行无稳定 id，key 可编辑
                <div key={index} className="flex items-center gap-1.5">
                  <Input
                    size="sm"
                    className="w-28 font-mono"
                    placeholder="key"
                    value={arg.key}
                    onChange={(e) => patchArg(index, { key: e.target.value })}
                  />
                  <Input
                    size="sm"
                    className="flex-1"
                    placeholder={t('Label')}
                    value={arg.label}
                    onChange={(e) => patchArg(index, { label: e.target.value })}
                  />
                  <Input
                    size="sm"
                    className="flex-1"
                    placeholder={t('Default value')}
                    value={arg.default ?? ''}
                    onChange={(e) => patchArg(index, { default: e.target.value })}
                  />
                  <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                    <Checkbox
                      checked={arg.required === true}
                      onCheckedChange={(checked) => patchArg(index, { required: checked === true })}
                    />
                    {t('Required')}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('Remove')}
                    onClick={() => patch({ args: draft.args.filter((_, i) => i !== index) })}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="xs"
                disabled={draft.args.length >= 8}
                onClick={() => patch({ args: [...draft.args, { key: '', label: '' }] })}
              >
                <Plus />
                {t('Add argument')}
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel>{t('Script')}</FieldLabel>
            {loading ? (
              <div className="flex w-full items-center justify-center rounded-md border py-12">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Textarea
                value={draft.script}
                onChange={(e) => patch({ script: e.target.value })}
                rows={14}
                className="font-mono text-xs"
              />
            )}
            <p className="text-muted-foreground text-xs">
              {t(
                'Plain JavaScript with top-level await; end with return. Available: agent(prompt, opts), parallel, pipeline, phase, log, args.'
              )}
            </p>
          </Field>
          {error && (
            <p className="flex items-center gap-1.5 text-destructive text-xs">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={!canSave} onClick={handleSave}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowsSettings() {
  const { t } = useI18n();
  const [all, setAll] = React.useState<WorkflowPresetSummary[]>([]);
  const [editing, setEditing] = React.useState<string | 'new' | null>(null);
  const disabled = useSettingsStore((state) => state.disabledWorkflowPresets);
  const toggleWorkflowPreset = useSettingsStore((state) => state.toggleWorkflowPreset);
  const reload = React.useCallback(() => {
    void window.electronAPI.workflowPresets.list().then(setAll);
  }, []);
  React.useEffect(reload, [reload]);
  const presets = all.filter((preset) => preset.source !== 'builtin');
  const builtins = all.filter((preset) => preset.source === 'builtin');

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4" data-settings-row="workflows.root">
        <div>
          <h3 className="font-medium text-lg">{t('Workflows')}</h3>
          <p className="text-muted-foreground text-sm">
            {t('Preset workflows you can run from the Workflow side panel')}
          </p>
          <p className="text-muted-foreground text-xs">
            {t(
              'Project .agents/workflows files take precedence over these; ~/.agents/workflows and built-in presets come after.'
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('Add workflow preset')}
        </Button>
      </div>

      <div className="space-y-2">
        <h4 className="font-medium text-muted-foreground text-xs">{t('Custom presets')}</h4>
        {presets.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-8 text-center">
            <Workflow className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-3 font-medium text-sm">{t('No custom workflow presets yet')}</p>
          </div>
        ) : (
          <div className="space-y-1">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className="group flex items-center justify-between gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent/50"
                data-settings-row={`workflows.${preset.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{preset.name}</span>
                    <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">
                      {preset.id}
                    </Badge>
                  </div>
                  <p className="truncate text-muted-foreground text-xs">{preset.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={t('Edit')}
                    onClick={() => setEditing(preset.id)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    aria-label={t('Delete')}
                    onClick={() =>
                      void window.electronAPI.workflowPresets.delete(preset.id).then(reload)
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {builtins.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-muted-foreground text-xs">{t('Built-in presets')}</h4>
          <div className="space-y-1">
            {builtins.map((preset) => (
              <div
                key={preset.id}
                className="flex items-center justify-between gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent/50"
                data-settings-row={`workflows.builtin.${preset.id}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{t(preset.name)}</span>
                    <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">
                      {preset.id}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">{t(preset.description)}</p>
                  {preset.args.length > 0 && (
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {t('Arguments')}:{' '}
                      {preset.args
                        .map((arg) => `${t(arg.label)}${arg.required ? ' *' : ''}`)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <Switch
                  aria-label={t(preset.name)}
                  checked={!disabled.includes(preset.id)}
                  onCheckedChange={(checked) => toggleWorkflowPreset(preset.id, checked)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <WorkflowPresetDialog target={editing} onClose={() => setEditing(null)} onSaved={reload} />
    </div>
  );
}
