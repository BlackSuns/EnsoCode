export const EDIT_MODES = ['replace', 'apply_patch'] as const;

export type EditMode = (typeof EDIT_MODES)[number];

export function isEditMode(value: unknown): value is EditMode {
  return typeof value === 'string' && EDIT_MODES.includes(value as EditMode);
}

export function resolveEditMode(editMode: unknown, _legacyHashlineEnabled?: unknown): EditMode {
  if (isEditMode(editMode)) return editMode;
  return 'apply_patch';
}
