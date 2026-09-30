import { desktop } from './bridge';

function join(parts: Array<string | { uri: string }>): string {
  return parts.map(p => typeof p === 'string' ? p : p.uri).filter(Boolean)
    .map((p, i) => i === 0 ? p.replace(/\/$/, '') : p.replace(/^\/+|\/+$/g, '')).join('/');
}

export const Paths = {
  get document() { return new Directory(desktop().info.paths.document); },
  get cache() { return new Directory(desktop().info.paths.cache); },
  get availableDiskSpace(): number { return desktop().sync('memory').freeStorageBytes; },
};

export class File {
  uri: string;
  constructor(...parts: Array<string | { uri: string }>) { this.uri = join(parts); }
  get name() { return decodeURIComponent(this.uri.split('/').pop() ?? ''); }
  get exists(): boolean { return desktop().sync('fs.stat', this.uri).exists; }
  get size(): number { return desktop().sync('fs.stat', this.uri).size; }
  get parentDirectory() { return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/'))); }
  create(options: { overwrite?: boolean } = {}) {
    if (this.exists && !options.overwrite) throw new Error('File already exists');
    desktop().sync('fs.write', this.uri, '');
  }
  write(value: string | Uint8Array) { desktop().sync('fs.write', this.uri, value); }
  textSync(): string { return desktop().sync('fs.read', this.uri, 'utf8'); }
  async text(): Promise<string> { return desktop().invoke('fs.read', this.uri, 'utf8'); }
  async bytes(): Promise<Uint8Array> { return new Uint8Array(await desktop().invoke('fs.read', this.uri)); }
  delete() { desktop().sync('fs.remove', this.uri); }
  copy(target: File | Directory) {
    const to = target instanceof Directory ? new File(target, this.name) : target;
    desktop().sync('fs.copy', this.uri, to.uri);
  }
  move(target: File) { desktop().sync('fs.move', this.uri, target.uri); this.uri = target.uri; }
  open() {
    const id = desktop().sync<number>('fs.open', this.uri);
    let offset = 0;
    return {
      get offset() { return offset; },
      set offset(value: number) { offset = value; },
      readBytes(length: number) {
        const bytes = new Uint8Array(desktop().sync('fs.readRange', id, offset, length));
        offset += bytes.length;
        return bytes;
      },
      close() { desktop().sync('fs.close', id); },
    };
  }
}
export class Directory {
  uri: string;
  constructor(...parts: Array<string | { uri: string }>) { this.uri = join(parts); }
  get name() { return decodeURIComponent(this.uri.split('/').pop() ?? ''); }
  get exists(): boolean { return desktop().sync('fs.stat', this.uri).exists; }
  create(options = {}) { desktop().sync('fs.mkdir', this.uri, options); }
  delete() { desktop().sync('fs.remove', this.uri); }
  move(target: Directory) { desktop().sync('fs.move', this.uri, target.uri); this.uri = target.uri; }
  list(): Array<Directory | File> {
    return desktop().sync<Array<{ name: string; isDirectory: boolean }>>('fs.list', this.uri)
      .map(entry => entry.isDirectory ? new Directory(this, entry.name) : new File(this, entry.name));
  }
}
