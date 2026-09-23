export interface ArchMismatch {
  file: string;
  archs: string[];
}

export function machOArchs(buffer: Buffer): string[] | null;

export function findArchMismatches(root: string, arch: string): ArchMismatch[];
