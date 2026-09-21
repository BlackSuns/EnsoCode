/**
 * Type declarations for the plain-JS electron-builder afterPack hook.
 * The runtime lives in `stripPackagedNatives.mjs`; this file only gives
 * TypeScript (and the test) real signatures instead of an implicit `any`.
 */

/** Subset of electron-builder's `AfterPackContext` this hook actually reads. */
export interface AfterPackContext {
  appOutDir: string;
  electronPlatformName: string;
  /** electron-builder `Arch` enum ordinal, or a platform arch string. */
  arch: number | string;
  packager: { appInfo: { productFilename: string } };
}

export function hostPrebuildName(platform: string, arch: string): string;

export function unpackedAppDir(
  appOutDir: string,
  platform: string,
  productFilename: string
): string;

export function stripForeignSqlitePrebuilds(
  prebuildsDir: string,
  platform: string,
  arch: string
): string[];

export function afterPack(context: AfterPackContext): Promise<void>;

export default afterPack;
