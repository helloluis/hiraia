'use client';
/**
 * "My own slides": typed calls to the owner-only `decks.uploads.*` routes, sending a file in pieces (so a dropped
 * connection carries on instead of starting again), and small hooks for the screens. An upload lives on the server
 * under the teacher's account; nothing here can reach another teacher's.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, TalaApiError, UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import type { UploadedDeck, UploadedDeckList, UploadRenderResult, UploadSaveResult, UploadSlideEdit } from '@hiraia/tala-core/contracts';
import { getClient } from './client';
import { useSession } from './session';

const enc = encodeURIComponent;
export const uploadPptxUrl = (uploadId: string) => `${API_BASE}/deck-uploads/${enc(uploadId)}/pptx`;
export const uploadOriginalUrl = (uploadId: string) => `${API_BASE}/deck-uploads/${enc(uploadId)}/original`;
/** `rev` only keeps the browser from showing a picture of an older version. */
export const uploadPreviewUrl = (uploadId: string, slideId: string, rev: number | null) => `${API_BASE}/deck-uploads/${enc(uploadId)}/previews/${enc(slideId)}?v=${rev ?? 0}`;

export const listUploads = (): Promise<UploadedDeckList> => getClient().call('decks.uploads.list');
export const getUpload = (uploadId: string): Promise<UploadedDeck> => getClient().call('decks.uploads.get', { params: { uploadId } });
export const saveUpload = (uploadId: string, body: { baseRev: number; title?: string; slides: UploadSlideEdit[]; force?: boolean }): Promise<UploadSaveResult> =>
  getClient().call('decks.uploads.save', { params: { uploadId }, body });
export const deleteUpload = async (uploadId: string): Promise<void> => {
  await getClient().call('decks.uploads.delete', { params: { uploadId } });
};
export const renderUpload = (uploadId: string): Promise<UploadRenderResult> => getClient().call('decks.uploads.render', { params: { uploadId } });

export type UploadFailure = 'offline' | 'signedOut' | 'gone' | 'conflict' | 'refused' | 'server';
export function uploadFailure(err: unknown): UploadFailure {
  if (err instanceof TalaApiError) {
    if (err.code === 'network' || err.code === 'timeout') return 'offline';
    if (err.code === 'unauthenticated') return 'signedOut';
    if (err.code === 'not_found') return 'gone';
    if (err.code === 'conflict') return 'conflict';
    if (err.code === 'invalid_input' || err.code === 'forbidden' || err.code === 'quota_exceeded' || err.code === 'rate_limited') return 'refused';
  }
  return 'server';
}
/** The stable reason of a refused upload or save (`details.reason`), if the server gave one. */
export const refusalReason = (err: unknown): string | null => (err instanceof TalaApiError ? ((err.details as { reason?: string } | undefined)?.reason ?? (err.code === 'rate_limited' ? 'rate_limited' : null)) : null);

/* ---------------- sending a file ---------------- */

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface SendProgress {
  /** 'reading' = computing the file's checksum on the device; 'sending'; 'checking' = the server is reading the file. */
  phase: 'reading' | 'sending' | 'checking';
  sent: number;
  total: number;
}

export class UploadStopped extends Error {
  constructor() {
    super('stopped');
    this.name = 'UploadStopped';
  }
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new UploadStopped());
    });
  });

/**
 * Send a file and have the server read it. Pieces already on the server are not sent again; a piece that fails
 * for lack of connection is retried a few times with growing pauses (RES-4) before the whole thing gives up with
 * the error, leaving the pieces sent so far in place for the next try.
 */
export async function sendUpload(file: File, onProgress: (p: SendProgress) => void, signal?: AbortSignal): Promise<UploadedDeck> {
  const client = getClient();
  const stop = () => {
    if (signal?.aborted) throw new UploadStopped();
  };
  onProgress({ phase: 'reading', sent: 0, total: file.size });
  const bytes = new Uint8Array(await file.arrayBuffer());
  stop();
  const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
  stop();
  const session = await client.call('decks.uploads.begin', { body: { fileName: file.name.slice(0, UPLOAD_LIMITS.fileName), bytes: bytes.length, sha256 } });
  const have = new Set(session.received);
  let sent = [...have].reduce((n, i) => n + Math.min(session.chunkBytes, bytes.length - i * session.chunkBytes), 0);
  onProgress({ phase: 'sending', sent, total: bytes.length });
  for (let i = 0; i < session.chunkCount; i++) {
    if (have.has(i)) continue;
    const piece = bytes.subarray(i * session.chunkBytes, (i + 1) * session.chunkBytes);
    const data = base64(piece);
    for (let attempt = 0; ; attempt++) {
      stop();
      try {
        await client.call('decks.uploads.chunk', { params: { sessionId: session.sessionId, index: String(i) }, body: { data }, signal });
        break;
      } catch (err) {
        if (signal?.aborted) throw new UploadStopped();
        if (uploadFailure(err) !== 'offline' || attempt >= 4) throw err;
        await wait(Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() / 2), signal);
      }
    }
    sent += piece.length;
    onProgress({ phase: 'sending', sent, total: bytes.length });
  }
  onProgress({ phase: 'checking', sent: bytes.length, total: bytes.length });
  return client.call('decks.uploads.finish', { params: { sessionId: session.sessionId }, signal });
}

/* ---------------- hooks ---------------- */

/** My uploads and what I may still add. `null` list while loading or signed out. */
export function useUploads() {
  const { status } = useSession();
  const [list, setList] = useState<UploadedDeckList | null>(null);
  const [failed, setFailed] = useState<UploadFailure | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (status !== 'signedIn') return;
    const mine = ++seq.current;
    try {
      const l = await listUploads();
      if (mine !== seq.current) return;
      setList(l);
      setFailed(null);
    } catch (e) {
      if (mine === seq.current) setFailed(uploadFailure(e));
    }
  }, [status]);
  useEffect(() => {
    setList(null);
    void load();
  }, [load]);
  return { list, failed, loading: status === 'signedIn' && list === null && !failed, reload: load };
}

/** One of my uploads, whole. */
export function useUpload(uploadId: string | null) {
  const { status } = useSession();
  const [deck, setDeck] = useState<UploadedDeck | null>(null);
  const [failed, setFailed] = useState<UploadFailure | null>(null);
  const [loading, setLoading] = useState(Boolean(uploadId));
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!uploadId || status !== 'signedIn') return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await getUpload(uploadId);
      if (mine !== seq.current) return;
      setDeck(d);
      setFailed(null);
    } catch (e) {
      if (mine === seq.current) setFailed(uploadFailure(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [uploadId, status]);
  useEffect(() => {
    setDeck(null);
    setFailed(null);
    void load();
  }, [load]);
  return { deck, failed, loading, reload: load };
}
