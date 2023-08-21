export type IBlockRef = { key: string; size: number };
export type IBlock = IBlockRef & { data: ArrayBuffer };

export abstract class BaseAdapter {
  abstract setup(): Promise<void>;
  abstract dispose(): Promise<void>;
  abstract read(id: string): Promise<ArrayBuffer>;
  abstract write(id: string, data: ArrayBuffer): Promise<void>;
  abstract del(id: string): Promise<void>;
  abstract getBlockRefs(): Promise<IBlockRef[]>;

  async dumpAllBlocks(onProgress?: (pg: number) => any): Promise<IBlock[]> {
    const refs = await this.getBlockRefs();

    let completeCnt = 0;

    const blocks = await Promise.all(
      refs.map(async r => {
        const data = await this.read(r.key);

        completeCnt += 1;
        onProgress?.(completeCnt / refs.length);

        return { ...r, data };
      })
    );

    return blocks;
  }
}
