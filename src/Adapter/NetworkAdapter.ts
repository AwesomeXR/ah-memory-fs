import { BaseAdapter } from './BaseAdapter';
import { LRUMap } from 'lru_map';

export type INetworkRewriteFun = (url: string, path: string, baseURL: string) => string;

export class NetworkAdapter extends BaseAdapter {
  static async create(
    baseURL: string,
    customFetch: (url: string) => Promise<ArrayBuffer>,
    opt: {
      rewrite?: INetworkRewriteFun;
    } = {}
  ) {
    const nd = new NetworkAdapter(baseURL, customFetch);

    nd.rewrite = opt.rewrite;
    await nd.setup();

    return nd;
  }

  static joinURL(baseURL: string, path: string) {
    return [baseURL.replace(/[\/]+$/, ''), path.replace(/^[\/]+/, '')].join('/');
  }

  rewrite?: INetworkRewriteFun;

  private _cache = new LRUMap<string, Promise<ArrayBuffer>>(32);

  constructor(readonly baseURL: string, private customFetch: (url: string) => Promise<ArrayBuffer>) {
    super();
    this._cache.limit = 32;
  }

  async setup(): Promise<void> {}
  async dispose(): Promise<void> {
    this._cache.clear();
  }

  set cacheLimit(n: number) {
    this._cache.limit = n;
  }

  toURL(id: string) {
    let url = NetworkAdapter.joinURL(this.baseURL, id);
    if (this.rewrite) url = this.rewrite(url, id, this.baseURL);
    return url;
  }

  async read(id: string): Promise<ArrayBuffer> {
    if (!this._cache.has(id)) {
      const url = this.toURL(id);
      const dataPromise = this.customFetch(url);
      this._cache.set(id, dataPromise);
    }

    return this._cache.get(id)!;
  }

  async write(id: string, data: ArrayBuffer): Promise<void> {
    throw new Error('Method not allowed.');
  }

  async del(id: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async getBlockRefs(): Promise<{ key: string; size: number }[]> {
    // TODO
    return [];
  }
}
