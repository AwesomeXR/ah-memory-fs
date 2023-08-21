import { BaseAdapter, IBlockRef } from './BaseAdapter';

export class MemoryAdapter extends BaseAdapter {
  static async empty() {
    const d = new MemoryAdapter();
    await d.setup();
    return d;
  }

  private _store = new Map<string, ArrayBuffer>();

  async setup(): Promise<void> {}

  async dispose(): Promise<void> {
    this._store.clear();
  }

  async read(id: string): Promise<ArrayBuffer> {
    const data = this._store.get(id);
    if (!data) throw new Error('Not found: ' + id);
    return data;
  }

  async write(id: string, data: ArrayBuffer): Promise<void> {
    this._store.set(id, data);
  }

  async del(id: string): Promise<void> {
    this._store.delete(id);
  }

  async getBlockRefs(): Promise<IBlockRef[]> {
    return [...this._store.entries()].map(([key, data]) => {
      return { key, size: data.byteLength };
    });
  }
}
