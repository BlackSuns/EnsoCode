import { describe, expect, it } from 'vitest';
import { isEditMode, resolveEditMode } from './editMode';

describe('edit mode', () => {
  it.each(['replace', 'hashline', 'apply_patch'] as const)('接受合法模式 %s', (mode) => {
    expect(isEditMode(mode)).toBe(true);
    expect(resolveEditMode(mode, mode !== 'hashline')).toBe(mode);
  });

  it.each([undefined, null, '', 'patch', true, 1, {}])('拒绝非法模式 %j', (value) => {
    expect(isEditMode(value)).toBe(false);
  });

  it('新枚举缺失或非法时兼容旧 hashline 开关，其余回落 replace', () => {
    expect(resolveEditMode(undefined, true)).toBe('hashline');
    expect(resolveEditMode(undefined, false)).toBe('replace');
    expect(resolveEditMode(undefined)).toBe('replace');
    expect(resolveEditMode('broken', true)).toBe('hashline');
    expect(resolveEditMode('broken', 'true')).toBe('replace');
  });
});
