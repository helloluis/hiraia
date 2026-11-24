/**
 * Pictures of an uploaded deck's slides.
 *
 * The web app does NOT draw them and cannot: there is no code here that starts LibreOffice or any other program.
 * An uploaded file is untrusted input and LibreOffice's importers are a large attack surface, so drawing happens in
 * a separate sandboxed job (packages/tala-server/deploy/render): one job per file, started by systemd for one
 * connection to a socket file, with no network, no access to the database, the settings or anybody's files, and
 * ceilings on memory, processes and time. This module is the web app's end of that socket.
 *
 * OFF unless `TALA_DECKS_PREVIEW_SOCKET` names the socket. With it off, or with the service missing, stopped,
 * slow, killed or not the sandbox it must be, the editor still works on the words; it just shows no picture.
 * There is no fallback that draws any other way.
 *
 * What is believed here: nothing the job sends. Its answer is read with hard limits, must end with an explicit
 * "done", must carry the job's own report that its sandbox held, and every picture must be a JPEG of a sane size.
 * The teacher's file is never changed by drawing.
 */
import net from 'node:net';

export interface DeckRenderer {
  /** One JPEG per slide, in slide order (hidden slides included). Rejects with a RenderError when the deck cannot be drawn. */
  render(pptx: Uint8Array, slides: number): Promise<Uint8Array[]>;
}

/**
 * `unavailable`: there is no usable drawing service (not installed, stopped, or it refused because its sandbox is
 * not what it must be). Asking again soon will not help. `busy`: it is drawing another file; ask again shortly.
 * `failed`: this file could not be drawn, or not in time.
 */
export type RenderFailure = 'unavailable' | 'busy' | 'failed';

export class RenderError extends Error {
  constructor(
    readonly kind: RenderFailure,
    /** A short fixed phrase for the server log. Never text from the file. */
    readonly reason: string
  ) {
    super(`slides not drawn: ${reason}`);
    this.name = 'RenderError';
  }
}

/** What a drawing job says about the box it ran in (deploy/render/render-job.mjs, selfCheck). */
export interface SandboxReport {
  v: number;
  ok: boolean;
  failed: string[];
  uid: number;
  isolation: string;
  [fact: string]: unknown;
}

export interface SocketRendererOptions {
  /** The socket file of the drawing service. */
  socketPath: string;
  /**
   * The job must run as a user of its own: not this process's user, and with no process of anyone else in sight.
   * True everywhere but a developer's machine, where the job can only run as the developer.
   */
  requireOwnUser: boolean;
  /** Width of each picture in pixels. */
  width?: number;
  /** How long one drawing may take here. The job gives up by itself earlier and is killed by systemd before this. */
  timeoutMs?: number;
  connectTimeoutMs?: number;
  maxPictureBytes?: number;
  maxTotalBytes?: number;
  /**
   * The service draws one file at a time and turns a second caller away without a word. The job before may just be
   * on its way out, so the door is tried again a few times, a moment apart, before the answer is "busy".
   */
  turnTries?: number;
  turnWaitMs?: number;
  /** This process's user id (for tests). */
  ownUid?: number;
}

export interface SocketRenderer extends DeckRenderer {
  /** Asks the service for its report without drawing anything. */
  probe(): Promise<SandboxReport>;
}

const MAGIC = Buffer.from('TALARND1', 'latin1');
const OP_DRAW = 1;
const OP_PROBE = 2;
const FRAME = { report: 0x01, picture: 0x02, stats: 0x03, failed: 0x7e, done: 0x7f } as const;
/** The job's reasons for ending without pictures, by number (render-job.mjs STATUS). */
const STATUS_NAMES = ['ok', 'bad request', 'file too large', 'sandbox check failed', 'programs missing', 'archive refused', 'could not convert', 'out of time', 'page count', 'bad picture', 'job error'];
const SERVICE_PROBLEMS = new Set([3, 4]);
export const RENDER_LIMITS = { slides: 400, width: 2048, height: 4096, reportBytes: 64 * 1024, pictureBytes: 2 * 1024 * 1024, totalBytes: 128 * 1024 * 1024 } as const;

/** Width and height of a JPEG from its frame header, or null when the bytes are not a whole JPEG. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  const n = bytes.length;
  if (n < 64 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) return null;
  let i = 2;
  for (let guard = 0; guard < 512 && i + 4 <= n; guard++) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // the picture's data began before any frame header
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2 || i + 2 + length > n) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (length < 8) return null;
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}

/** Words of the job's report that may go to the log: its own short names only. */
const safeNames = (list: unknown): string => (Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && /^[a-z0-9:-]{1,48}$/.test(s)).slice(0, 12).join(',') : '') || 'unnamed';

interface Answer {
  report: SandboxReport | null;
  pictures: Uint8Array[];
  /** null: the answer stopped before the job said how it ended (it was killed). */
  ended: { ok: true; count: number } | { ok: false; status: number } | null;
  bytes: number;
}

export function socketRenderer(o: SocketRendererOptions): SocketRenderer {
  const width = Math.min(o.width ?? 1280, RENDER_LIMITS.width);
  const timeoutMs = o.timeoutMs ?? 130_000;
  const connectTimeoutMs = o.connectTimeoutMs ?? 3_000;
  const maxPictureBytes = Math.min(o.maxPictureBytes ?? RENDER_LIMITS.pictureBytes, RENDER_LIMITS.pictureBytes);
  const maxTotalBytes = Math.min(o.maxTotalBytes ?? RENDER_LIMITS.totalBytes, RENDER_LIMITS.totalBytes);
  const ownUid = o.ownUid ?? process.getuid?.() ?? -1;
  const turnTries = o.turnTries ?? 4;
  const turnWaitMs = o.turnWaitMs ?? 300;
  /** Requests in a row that were turned away without a word: one is "busy", several are a service that does not start. */
  let silentInARow = 0;

  /** One request, waiting a moment for its turn when the door is closed. */
  async function exchange(op: number, payload: Uint8Array, slides: number): Promise<Answer> {
    for (let attempt = 1; ; attempt++) {
      const answer = await exchangeOnce(op, payload, slides);
      if (answer.bytes || attempt >= turnTries) return answer;
      await new Promise((resolve) => setTimeout(resolve, turnWaitMs));
    }
  }

  function exchangeOnce(op: number, payload: Uint8Array, slides: number): Promise<Answer> {
    return new Promise((resolve, reject) => {
      const answer: Answer = { report: null, pictures: [], ended: null, bytes: 0 };
      let buffered: Buffer = Buffer.alloc(0);
      let sawMagic = false;
      let connected = false;
      let settled = false;
      const sock = net.connect({ path: o.socketPath });
      const finish = (err?: RenderError) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(timer);
        sock.destroy();
        if (err) reject(err);
        else resolve(answer);
      };
      const connectTimer = setTimeout(() => finish(new RenderError('unavailable', 'no answer from the drawing service')), connectTimeoutMs);
      const timer = setTimeout(() => finish(new RenderError('failed', 'out of time')), timeoutMs);
      const protocol = (why: string) => finish(new RenderError('failed', `unexpected answer (${why})`));

      sock.once('connect', () => {
        connected = true;
        clearTimeout(connectTimer);
        const head = Buffer.alloc(20);
        MAGIC.copy(head, 0);
        head.writeUInt8(op, 8);
        if (op === OP_DRAW) {
          head.writeUInt16BE(width, 10);
          head.writeUInt16BE(slides, 12);
          head.writeUInt32BE(payload.length, 16);
        }
        sock.write(head);
        if (payload.length) sock.write(payload);
      });
      sock.on('error', (err: NodeJS.ErrnoException) => {
        // Not there, not listening, or not ours to open: there is no drawing service for this server.
        if (!connected) return finish(new RenderError('unavailable', `socket ${err.code ?? 'error'}`));
        // The job hung up while the file was still being sent (it had already answered why): read what it said.
        if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return;
        finish(new RenderError('failed', `connection ${err.code ?? 'error'}`));
      });
      sock.on('data', (chunk: Buffer) => {
        answer.bytes += chunk.length;
        if (answer.bytes > maxTotalBytes + RENDER_LIMITS.reportBytes * 4) return protocol('too long');
        buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
        if (!sawMagic) {
          if (buffered.length < MAGIC.length) return;
          if (!buffered.subarray(0, MAGIC.length).equals(MAGIC)) return protocol('not the drawing service');
          sawMagic = true;
          buffered = buffered.subarray(MAGIC.length);
        }
        while (!answer.ended && buffered.length >= 5) {
          const type = buffered.readUInt8(0);
          const length = buffered.readUInt32BE(1);
          const most = type === FRAME.picture ? maxPictureBytes : type === FRAME.report || type === FRAME.stats ? RENDER_LIMITS.reportBytes : type === FRAME.done ? 4 : type === FRAME.failed ? 1 : -1;
          if (most < 0) return protocol('unknown part');
          if (length > most) return protocol('part too large');
          if (buffered.length < 5 + length) return;
          const body = buffered.subarray(5, 5 + length);
          buffered = buffered.subarray(5 + length);
          if (type === FRAME.report) {
            if (answer.report || answer.pictures.length) return protocol('report out of place');
            try {
              const parsed: unknown = JSON.parse(body.toString('utf8'));
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return protocol('report');
              answer.report = parsed as SandboxReport;
            } catch {
              return protocol('report');
            }
          } else if (type === FRAME.picture) {
            if (!answer.report || op !== OP_DRAW || answer.pictures.length >= slides) return protocol('picture out of place');
            answer.pictures.push(new Uint8Array(body)); // a copy: the buffer it was read into is let go
          } else if (type === FRAME.done) {
            if (length !== 4) return protocol('end');
            answer.ended = { ok: true, count: body.readUInt32BE(0) };
          } else if (type === FRAME.failed) {
            if (length !== 1) return protocol('end');
            answer.ended = { ok: false, status: body.readUInt8(0) };
          }
        }
        if (answer.ended) finish();
      });
      sock.on('close', () => {
        if (settled) return;
        if (!connected) return finish(new RenderError('unavailable', 'socket closed'));
        finish();
      });
    });
  }

  /** The answer's report, held to what this server requires of a sandbox. Throws when it does not hold. */
  function trusted(answer: Answer): SandboxReport {
    if (!answer.bytes) {
      silentInARow += 1;
      // The door lets one job in at a time and turns the next one away without a word.
      throw new RenderError(silentInARow >= 3 ? 'unavailable' : 'busy', silentInARow >= 3 ? 'the drawing service does not start' : 'the drawing service is busy');
    }
    silentInARow = 0;
    if (!answer.ended) throw new RenderError('failed', 'the drawing job was stopped before it finished');
    const report = answer.report;
    if (!answer.ended.ok) {
      const status = answer.ended.status;
      if (status === 3) throw new RenderError('unavailable', `the job refused to draw: sandbox check failed (${safeNames(report?.failed)})`);
      throw new RenderError(SERVICE_PROBLEMS.has(status) ? 'unavailable' : 'failed', STATUS_NAMES[status] ?? `status ${status}`);
    }
    if (!report || report.v !== 1 || report.ok !== true || !Array.isArray(report.failed) || report.failed.length) throw new RenderError('unavailable', 'no sandbox report');
    if (!Number.isInteger(report.uid) || report.uid === 0) throw new RenderError('unavailable', 'sandbox: the job runs as root');
    if (o.requireOwnUser && (report.isolation !== 'own-user' || report.uid === ownUid)) throw new RenderError('unavailable', 'sandbox: the job does not run as a user of its own');
    return report;
  }

  return {
    async probe() {
      return trusted(await exchange(OP_PROBE, new Uint8Array(0), 0));
    },
    async render(pptx, slides) {
      if (!Number.isInteger(slides) || slides < 1 || slides > RENDER_LIMITS.slides) throw new RenderError('failed', 'slide count');
      const answer = await exchange(OP_DRAW, pptx, slides);
      trusted(answer);
      if (!answer.ended?.ok || answer.ended.count !== answer.pictures.length || answer.pictures.length !== slides) throw new RenderError('failed', 'page count');
      for (const picture of answer.pictures) {
        const size = jpegSize(picture);
        if (!size || size.width > width || size.height > RENDER_LIMITS.height || size.width < 16 || size.height < 16) throw new RenderError('failed', 'a picture is not a usable JPEG');
      }
      return answer.pictures;
    },
  };
}

/**
 * The renderer a server is configured with, or null (the default) when it draws no pictures. Only a socket of the
 * sandboxed drawing service can be configured, and the job must run as a user of its own. The one exception is a
 * developer's machine (deploy/render/dev-units.mjs), where the job can only run as the developer: it has to be
 * asked for by name and is ignored when TALA_ENV is staging or production.
 */
export function rendererFromEnv(env: NodeJS.ProcessEnv = process.env): SocketRenderer | null {
  const socketPath = env.TALA_DECKS_PREVIEW_SOCKET;
  if (!socketPath || !socketPath.startsWith('/')) return null;
  const developerMachine = (env.TALA_ENV ?? 'local') === 'local' && env.TALA_DECKS_PREVIEW_SHARED_USER === '1';
  return socketRenderer({ socketPath, requireOwnUser: !developerMachine });
}

/** Settings of the earlier, unsandboxed drawing that are set on this server and now do nothing (names only). */
export function retiredRenderSettings(env: NodeJS.ProcessEnv = process.env): string[] {
  return ['TALA_DECKS_PREVIEW_SOFFICE', 'TALA_DECKS_PREVIEW_PDFTOPPM', 'TALA_DECKS_PREVIEW_FONTCONFIG', 'TALA_DECKS_PREVIEW_ALLOW_NETWORK'].filter((name) => env[name]);
}
