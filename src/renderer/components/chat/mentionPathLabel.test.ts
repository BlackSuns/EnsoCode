import { describe, expect, it } from 'vitest';
import { distinguishingPathLabels } from './mentionPathLabel';

function labels(...paths: string[]): string[] {
  return [...distinguishingPathLabels(paths).values()];
}

describe('distinguishingPathLabels', () => {
  it('returns an empty map for no paths', () => {
    expect(distinguishingPathLabels([]).size).toBe(0);
  });

  it('shows the last two parents even for a single long path', () => {
    expect(labels('app/src/main/java/Foo.kt')).toEqual(['…/main/java/Foo.kt']);
  });

  it('keeps short shared parents so src/a.ts stays readable', () => {
    expect(labels('src/a.ts', 'src/b.ts')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('keeps the distinguishing suffix of paths with a long shared prefix', () => {
    expect(
      labels(
        'app/src/main/java/com/foo/featureA/ui/Page.kt',
        'app/src/main/java/com/foo/featureB/ui/Page.kt'
      )
    ).toEqual(['…/featureA/ui/Page.kt', '…/featureB/ui/Page.kt']);
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

  it('shortens Java paths even when assets and other modules are included', () => {
    expect(
      labels(
        'app/src/main/assets/screensaver/',
        'app/src/main/java/com/example/feature/screensaver/',
        'app/src/main/java/com/example/ui/feature/screensaver/',
        'shared/data/core/src/main/java/com/ivy/data/local/migration/',
        'shared/data/core/src/main/java/com/ivy/data/remote/migration/',
        'app/src/main/java/com/ivy/wallet/migrations/'
      )
    ).toEqual([
      '…/main/assets/screensaver',
      '…/example/feature/screensaver',
      '…/ui/feature/screensaver',
      '…/data/local/migration',
      '…/data/remote/migration',
      '…/ivy/wallet/migrations',
    ]);
  });

  it('expands beyond two parents when needed to distinguish matching suffixes', () => {
    expect(
      labels(
        'app/src/main/java/com/example/data/migration/Migration.kt',
        'shared/src/main/java/com/example/data/migration/Migration.kt'
      )
    ).toEqual([
      'app/src/main/java/com/example/data/migration/Migration.kt',
      'shared/src/main/java/com/example/data/migration/Migration.kt',
    ]);
  });

  it('does not let duplicate normalized paths force full prefixes', () => {
    expect(labels('app/src/main/java/Foo.kt', 'app\\src\\main\\java\\Foo.kt')).toEqual([
      '…/main/java/Foo.kt',
      '…/main/java/Foo.kt',
    ]);
  });

  it('distinguishes a complete path from a longer path ending with it', () => {
    expect(labels('src/ui/Page.kt', 'app/src/ui/Page.kt')).toEqual([
      'src/ui/Page.kt',
      'app/src/ui/Page.kt',
    ]);
  });
});
