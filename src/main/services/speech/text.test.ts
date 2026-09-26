import { describe, expect, it } from 'vitest';
import { normalizeTranscript } from './text';

describe('normalizeTranscript', () => {
  it('drops the space the transducer puts after CJK punctuation and trims', () => {
    expect(normalizeTranscript(' 部署以后， 用 pm2 重启。 然后看日志 ')).toBe(
      '部署以后，用 pm2 重启。然后看日志'
    );
  });

  it('strips replacement characters from broken byte decoding', () => {
    expect(normalizeTranscript('\uFFFD')).toBe('');
    expect(normalizeTranscript('你好\uFFFD世界')).toBe('你好世界');
  });
});
