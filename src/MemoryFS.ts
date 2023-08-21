import minimatch from 'minimatch';
import { BaseAdapter } from './Adapter';
import { FileIndex, IFileIndexNode } from './FileIndex';
import { EventBus } from 'ah-event-bus';
import Path from 'path-browserify';
import { uuid } from './uuid';
import { Logger } from 'ah-logger';
import { ExternalImpl } from './ExternalImpl';

export type IFileStat = {
  size: number;
  isDir?: boolean;
  createdAt?: number;
  modifiedAd?: number;
  _blockRef?: string;
};

export const FILE_INDEX_BLOCK_ID = '.index';

export type IMemoryFSEvent = {
  MODIFY: { path: string };
  CREATE: { path: string };
  DELETE: { path: string };
  ACCESS: { path: string };
  MOVE: { fromPath: string; toPath: string };
};

let _glUid = 1;

export class MemoryFS {
  static preDeflatedExts: string[] = ['jpg', 'jpeg', 'png', 'zip', 'vol'];

  static normalizePath(path: string) {
    if (path.length === 0) throw new Error('Empty path');

    if (path.startsWith('http://') || path.startsWith('https://')) {
      throw new Error('invalid filepath: ' + path);
    }

    path = path
      .replace(/^file\:\/\//, '') // -s `file://`
      .replace(/^[\/]+/, '') // -s 开头任意数量的 /
      .replace(/[\/]+$/, ''); // -s 结尾任意数量的 /

    path = Path.normalize(path);
    return path;
  }

  static async create(getAdapter: () => Promise<BaseAdapter>) {
    const mfs = new MemoryFS();
    const adapter = await getAdapter();
    await mfs.mount(adapter);
    return mfs;
  }

  readonly uid = _glUid++;
  readonly event = new EventBus<IMemoryFSEvent>();

  protected logger = new Logger('MFS_' + this.uid);

  private _adapter!: BaseAdapter;
  private _fileIndex!: FileIndex;

  async mount(adapter: BaseAdapter) {
    this._adapter = adapter;

    this._fileIndex = new FileIndex();

    try {
      await this._fileIndex.restore(await adapter.read(FILE_INDEX_BLOCK_ID));
    } catch (err) {
      this.logger.warn('%s', err);
      this.logger.info('creating root dir `.`');
      await this.mkdir('.'); // 创建根目录
    }
  }

  get adapter() {
    return this._adapter;
  }

  async readFile(path: string): Promise<ArrayBuffer>;
  async readFile(path: string, encoding: 'utf-8'): Promise<string>;
  async readFile(path: string, encoding?: string): Promise<any> {
    path = MemoryFS.normalizePath(path);

    const fi = this._fileIndex.get(path);
    if (!fi) throw new Error('Not found: ' + path);
    if (fi.type !== 'file') throw new Error('cannot read ' + path);

    const data = await this._adapter.read(fi.blockRef);
    this.event.emit('ACCESS', { path });

    if (encoding === 'utf-8') return ExternalImpl.ArrayBufferToString(data);
    return data;
  }

  async writeFile(path: string, data: ArrayBuffer): Promise<void>;
  async writeFile(path: string, data: string, encoding: 'utf-8' | 'base64'): Promise<void>;
  async writeFile(path: string, data: string | ArrayBuffer, encoding?: string) {
    const _st = new Date();
    path = MemoryFS.normalizePath(path);

    const buf = typeof data === 'string' ? ExternalImpl.StringToArrayBuffer(data) : data;

    const fi = this._fileIndex.get(path);
    const modifiedAt = new Date().valueOf();

    let node: IFileIndexNode;

    if (!fi) {
      const dirname = Path.dirname(path);
      const parentIndex = this._fileIndex.get(dirname);
      if (!parentIndex || parentIndex.type !== 'dir') {
        throw new Error(`cannot write ${path}: ${dirname} is not dir`);
      }

      node = {
        id: path,
        parentId: dirname,
        type: 'file',
        size: buf.byteLength,
        blockRef: uuid(),
        createdAt: modifiedAt,
        modifiedAt: modifiedAt,
      };
      this._fileIndex.add(node);
    }
    //
    else {
      if (fi.type === 'dir') throw new Error('cannot write to dir: ' + path);
      fi.size = buf.byteLength;
      fi.modifiedAt = modifiedAt;

      node = fi;
    }

    this.logger.debug(
      '(%s) write %s @ %s',
      (new Date().valueOf() - _st.valueOf()).toFixed(0) + 'ms',
      path,
      node.blockRef
    );

    await this._adapter.write(node.blockRef, buf);
    await this._adapter.write(FILE_INDEX_BLOCK_ID, this._fileIndex.toData());

    this.event.emit(fi ? 'MODIFY' : 'CREATE', { path });
  }

  async readFileAsJSON<T>(path: string): Promise<T> {
    return JSON.parse(await this.readFile(path, 'utf-8'));
  }

  async writeFileAsJSON<T>(path: string, data: T) {
    return this.writeFile(path, JSON.stringify(data), 'utf-8');
  }

  async exists(path: string): Promise<boolean> {
    return !!(await this.stats(path));
  }

  async clear(pattern = '**') {
    const paths = await this.glob(pattern);
    await Promise.all(paths.map(async p => this.unlink(p)));
  }

  async unlink(path: string): Promise<void> {
    path = MemoryFS.normalizePath(path);

    const descendants = this._fileIndex.getDescendants(path);
    for (const node of descendants) {
      if (node.type === 'file') {
        this.logger.debug('unlink %s @ %s', path, node.blockRef);
        await this._adapter.del(node.blockRef);
      }
    }

    this._fileIndex.remove(path);
    await this._adapter.write(FILE_INDEX_BLOCK_ID, this._fileIndex.toData());

    this.event.emit('DELETE', { path });
  }

  async mkdir(path: string): Promise<void> {
    path = MemoryFS.normalizePath(path);

    const modifiedAd = new Date().valueOf();
    const fi = this._fileIndex.get(path);

    if (fi && fi.parentId !== Path.dirname(path)) throw new Error('parentId is not equal');

    if (path !== '.') {
      const dirname = Path.dirname(path);
      const parentIndex = this._fileIndex.get(dirname);
      if (!parentIndex || parentIndex.type !== 'dir') {
        throw new Error(`cannot mkdir ${path}: ${dirname} is not dir`);
      }
    }

    this._fileIndex.add({
      id: path,
      parentId: path === '.' ? undefined : Path.dirname(path),
      type: 'dir',
      createdAt: modifiedAd,
      modifiedAt: modifiedAd,
    });

    this.logger.debug('mkdir %s', path);
    await this._adapter.write(FILE_INDEX_BLOCK_ID, this._fileIndex.toData());

    this.event.emit('CREATE', { path });
  }

  async mkdirp(path: string): Promise<void> {
    path = MemoryFS.normalizePath(path);
    if (path === '.') return; // 递归终止

    const pPath = Path.dirname(path);
    const pStats = await this.stats(pPath);

    if (!pStats) {
      await this.mkdirp(pPath);
    } else {
      if (!pStats.isDir) throw new Error(`${pPath} is not a dictionary`);
    }

    await this.mkdir(path);
  }

  async stats(path: string): Promise<IFileStat | undefined> {
    path = MemoryFS.normalizePath(path);

    const fi = this._fileIndex.get(path);
    if (!fi) return;

    const stat: IFileStat = { size: 0, createdAt: fi.createdAt, modifiedAd: fi.modifiedAt };

    if (fi.type === 'dir') {
      stat.isDir = true;
    }
    //
    else {
      stat.size = fi.size;
      stat._blockRef = fi.blockRef;
    }

    return stat;
  }

  async readdir(path: string): Promise<string[]> {
    path = MemoryFS.normalizePath(path);

    const fi = this._fileIndex.get(path);
    if (!fi) return [];
    if (fi.type === 'file') throw new Error('path is a file: ' + path);

    const paths = this._fileIndex.getFlatChildren(path).map(node => {
      return Path.basename(node.id);
    });

    return paths;
  }

  async move(fromPath: string, toPath: string) {
    fromPath = MemoryFS.normalizePath(fromPath);
    toPath = MemoryFS.normalizePath(toPath);

    const fromIndex = this._fileIndex.get(fromPath);
    if (!fromIndex) throw new Error('Not found: ' + fromPath);

    const toIndex = this._fileIndex.get(toPath);
    if (toIndex) throw new Error('to path exist: ' + toPath); // 不能覆盖目标路径

    let toParentPath: string | undefined = Path.dirname(toPath);
    if (toParentPath === '.') toParentPath = undefined;

    // 执行移动
    if (fromIndex.type === 'file') {
      fromIndex.id = toPath;
    } else {
      fromIndex.id = toPath;
      this._fileIndex.getFlatChildren(fromPath).forEach(child => {
        child.id = toPath + '/' + Path.basename(child.id);
        child.parentId = toPath;
      });
    }

    this._fileIndex.buildCache();

    await this._adapter.write(FILE_INDEX_BLOCK_ID, this._fileIndex.toData());
    this.event.emit('MOVE', { fromPath, toPath });
  }

  async glob(pattern: string, opt: { includeDir?: boolean } = {}): Promise<string[]> {
    pattern = MemoryFS.normalizePath(pattern);
    const nodes = this._fileIndex.getAll();
    const paths = (opt.includeDir ? nodes : nodes.filter(n => n.type === 'file')).map(n => n.id);

    // glob
    const matchedPaths = paths.filter(minimatch.filter(pattern, { nocase: true }));
    return matchedPaths;
  }
}
