import { describe, expect, it } from 'vitest';
import { isKnownRef, parseSnapshotEntries, renderSnapshot } from './snapshot';

describe('parseSnapshotEntries', () => {
  it('accepts the in-page script output shape', () => {
    const entries = parseSnapshotEntries([
      { role: 'heading', name: 'Hello', depth: 0 },
      { role: 'button', name: 'Go', depth: 1, ref: 'e1' },
      { role: 'textbox', name: 'Email', depth: 1, ref: 'e2', value: 'a@b' },
    ]);
    expect(entries).toHaveLength(3);
    expect(entries?.[1]?.ref).toBe('e1');
  });

  it('accepts click/fill/select kind on interactive entries', () => {
    const entries = parseSnapshotEntries([
      { role: 'button', name: 'Go', depth: 0, ref: 'e1', kind: 'click' },
      { role: 'textbox', name: 'Email', depth: 0, ref: 'e2', kind: 'fill', value: 'a@b' },
      { role: 'combobox', name: 'Country', depth: 0, ref: 'e3', kind: 'select', value: 'US' },
    ]);
    expect(entries?.map((entry) => entry.kind)).toEqual(['click', 'fill', 'select']);
  });

  it('rejects non-array, bad ref format, missing role and oversized depth', () => {
    expect(parseSnapshotEntries(null)).toBeNull();
    expect(parseSnapshotEntries({})).toBeNull();
    expect(parseSnapshotEntries([{ role: 'button', name: 'x', depth: 0, ref: 'x1' }])).toBeNull();
    expect(parseSnapshotEntries([{ name: 'x', depth: 0 }])).toBeNull();
    expect(parseSnapshotEntries([{ role: 'button', name: 'x', depth: -1 }])).toBeNull();
    expect(parseSnapshotEntries([{ role: 'button', name: 'x', depth: 0, extra: 1 }])).toBeNull();
    expect(
      parseSnapshotEntries([{ role: 'button', name: 'x', depth: 0, ref: 'e1', kind: 'hover' }])
    ).toBeNull();
  });
});

describe('renderSnapshot', () => {
  it('renders an indented tree with refs and collects the ref list', () => {
    const snap = renderSnapshot({ url: 'http://127.0.0.1:1/', title: 'T' }, [
      { role: 'heading', name: 'Hello', depth: 0 },
      { role: 'button', name: 'Go', depth: 1, ref: 'e1' },
      { role: 'textbox', name: 'Email', depth: 1, ref: 'e2', value: 'a@b' },
    ]);
    expect(snap.refs).toEqual(['e1', 'e2']);
    expect(snap.text).toBe(
      [
        '- Page URL: http://127.0.0.1:1/',
        '- Page Title: T',
        '- Page Snapshot:',
        '- heading "Hello"',
        '  - button "Go" [ref=e1]',
        '  - textbox "Email" [ref=e2]: a@b',
      ].join('\n')
    );
  });

  it('escapes newlines and quotes inside names', () => {
    const snap = renderSnapshot({ url: 'u', title: 't' }, [
      { role: 'link', name: 'a"b\nc', depth: 0, ref: 'e1' },
    ]);
    expect(snap.text.endsWith('- link "a\\"b c" [ref=e1]')).toBe(true);
  });
});

describe('renderSnapshot kinds', () => {
  it('prints kind next to ref so the model can pick click vs fill vs select', () => {
    const snap = renderSnapshot({ url: 'u', title: 't' }, [
      { role: 'textbox', name: 'Email', depth: 0, ref: 'e2', kind: 'fill', value: 'a@b' },
    ]);
    expect(snap.text).toContain('- textbox "Email" [ref=e2] [kind=fill]: a@b');
  });
});

describe('isKnownRef', () => {
  it('only accepts refs from the given snapshot', () => {
    const snap = renderSnapshot({ url: 'u', title: 't' }, [
      { role: 'button', name: 'x', depth: 0, ref: 'e7' },
    ]);
    expect(isKnownRef(snap, 'e7')).toBe(true);
    expect(isKnownRef(snap, 'e1')).toBe(false);
    expect(isKnownRef(undefined, 'e7')).toBe(false);
  });
});
