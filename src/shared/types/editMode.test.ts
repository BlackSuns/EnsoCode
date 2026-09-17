import { describe, expect, it } from 'vitest';
import { isEditMode, resolveEditMode } from './editMode';

describe('edit mode', () => {
  it.each(['replace', 'apply_patch'] as const)('接受合法模式 %s', (mode) => {
    expect(isEditMode(mode)).toBe(true);
    expect(resolveEditMode(mode, true)).toBe(mode);
  });

  it.each([undefined, null, '', 'patch', 'hashline', true, 1, {}])('拒绝非法模式 %j', (value) => {
    expect(isEditMode(value)).toBe(false);
  });

  it('缺省与非法一律回落 apply_patch，合法 replace 仍保留', () => {
    expect(resolveEditMode('replace')).toBe('replace');
    expect(resolveEditMode('hashline')).toBe('apply_patch');
    expect(resolveEditMode(undefined, true)).toBe('apply_patch');
    expect(resolveEditMode(undefined, false)).toBe('apply_patch');
    expect(resolveEditMode('broken', true)).toBe('apply_patch');
  });
});
