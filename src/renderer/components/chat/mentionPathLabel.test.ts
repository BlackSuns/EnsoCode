import { describe, expect, it } from 'vitest';
import { distinguishingPathLabels } from './mentionPathLabel';

function labels(...paths: string[]): string[] {
  return [...distinguishingPathLabels(paths).values()];
}

describe('distinguishingPathLabels', () => {
  it('returns an empty map for no paths', () => {
    expect(distinguishingPathLabels([]).size).toBe(0);
  });

  it('keeps a single path unchanged', () => {
    expect(labels('app/src/main/java/Foo.kt')).toEqual(['app/src/main/java/Foo.kt']);
  });

  it('keeps short shared parents so src/a.ts stays readable', () => {
    expect(labels('src/a.ts', 'src/b.ts')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('collapses a long shared prefix and keeps the last common parent', () => {
    expect(
      labels(
        'app/src/main/java/com/foo/featureA/ui/Page.kt',
        'app/src/main/java/com/foo/featureB/ui/Page.kt'
      )
    ).toEqual(['…/foo/featureA/ui/Page.kt', '…/foo/featureB/ui/Page.kt']);
  });

  it('does not collapse when the first segment already differs', () => {
    expect(labels('android/Page.kt', 'ios/Page.kt')).toEqual(['android/Page.kt', 'ios/Page.kt']);
  });

  it('does not eat a shorter path that is a prefix of another', () => {
    expect(labels('src/foo', 'src/foo/bar.ts')).toEqual(['src/foo', 'src/foo/bar.ts']);
  });

  it('normalizes backslashes and keys by the original path', () => {
    const map = distinguishingPathLabels([
      'app\\src\\main\\java\\foo\\A.kt',
      'app\\src\\main\\java\\bar\\B.kt',
    ]);
    expect(map.get('app\\src\\main\\java\\foo\\A.kt')).toBe('…/java/foo/A.kt');
    expect(map.get('app\\src\\main\\java\\bar\\B.kt')).toBe('…/java/bar/B.kt');
  });
});
