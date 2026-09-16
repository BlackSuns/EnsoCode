import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('node-datachannel installer packaging', () => {
  it('copies pnpm-nested platform binaries where Node can require them', () => {
    const { version } = JSON.parse(
      readFileSync(
        path.resolve(__dirname, '../../../node_modules/node-datachannel/package.json'),
        'utf8'
      )
    ) as { version: string };
    const yml = readFileSync(path.resolve(__dirname, '../../../electron-builder.yml'), 'utf8');
    expect(yml).toContain(
      `from: node_modules/.pnpm/node-datachannel@${version}/node_modules/@node-datachannel`
    );
    expect(yml).toContain('to: node_modules/@node-datachannel');
    expect(yml).toContain('node_modules/@node-datachannel/**/*.node');
  });
});
