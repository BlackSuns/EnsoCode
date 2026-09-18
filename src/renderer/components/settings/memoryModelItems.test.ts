import type { EmbeddingModelDto } from '@shared/memory/dto';
import { describe, expect, it } from 'vitest';
import {
  embeddingBackendSelectValue,
  embeddingModelLabel,
  isRemoteEmbeddingId,
  nextEmbeddingBackend,
  REMOTE_EMBEDDING_BACKEND_ID,
  remoteEmbeddingModelId,
  toRemoteEmbeddingId,
} from './memoryModelItems';

const model = (id: string) => ({ id }) as EmbeddingModelDto;

describe('embeddingModelLabel', () => {
  it('strips the local/remote prefix', () => {
    expect(embeddingModelLabel(model('local:bge-m3-gguf'))).toBe('bge-m3-gguf');
    expect(embeddingModelLabel(model('remote:text-embedding-3-small'))).toBe(
      'text-embedding-3-small'
    );
  });

  it('spells out what "none" actually means', () => {
    // 直接显示 "none" 会让人以为坏了，而不是「只用全文检索」
    expect(embeddingModelLabel(model('none'))).toBe('None (full-text only)');
  });
});

describe('remote embedding ids', () => {
  it('treats any remote:<model> as the remote backend in the first dropdown', () => {
    expect(isRemoteEmbeddingId('remote:openai-compatible')).toBe(true);
    expect(isRemoteEmbeddingId('remote:text-embedding-3-small')).toBe(true);
    expect(isRemoteEmbeddingId('remote:openai/text-embedding-3-small')).toBe(true);
    expect(isRemoteEmbeddingId('local:potion-multilingual-128M')).toBe(false);
    expect(isRemoteEmbeddingId('none')).toBe(false);
    expect(isRemoteEmbeddingId('remote:')).toBe(false);

    expect(embeddingBackendSelectValue('remote:text-embedding-3-small')).toBe(
      REMOTE_EMBEDDING_BACKEND_ID
    );
    expect(embeddingBackendSelectValue('local:bge-m3-gguf')).toBe('local:bge-m3-gguf');
  });

  it('stores the picker model as remote:<id> and does not treat the sentinel as a real model', () => {
    expect(toRemoteEmbeddingId('text-embedding-3-small')).toBe('remote:text-embedding-3-small');
    expect(toRemoteEmbeddingId('openai/text-embedding-3-small')).toBe(
      'remote:openai/text-embedding-3-small'
    );
    expect(remoteEmbeddingModelId('remote:text-embedding-3-small')).toBe('text-embedding-3-small');
    expect(remoteEmbeddingModelId(REMOTE_EMBEDDING_BACKEND_ID)).toBeNull();
    expect(remoteEmbeddingModelId('local:bge-m3-gguf')).toBeNull();
  });

  it('keeps an already-chosen remote model when the backend dropdown stays on Remote', () => {
    expect(nextEmbeddingBackend('remote:text-embedding-3-small', REMOTE_EMBEDDING_BACKEND_ID)).toBe(
      'remote:text-embedding-3-small'
    );
    expect(nextEmbeddingBackend('local:bge-m3-gguf', REMOTE_EMBEDDING_BACKEND_ID)).toBe(
      REMOTE_EMBEDDING_BACKEND_ID
    );
    expect(nextEmbeddingBackend('remote:text-embedding-3-small', 'none')).toBe('none');
  });
});
