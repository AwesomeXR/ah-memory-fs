import _ from 'lodash';
import { walkInDeep } from './walkInDeep';
import { IFileIndexNode } from './FileIndex';
import { FILE_INDEX_BLOCK_ID, MemoryFS } from './MemoryFS';
import Path from 'path-browserify';
import { IBlock, MemoryAdapter } from './Adapter';
import { md5 } from 'ah-pure-md5';
import { ExternalImpl } from './ExternalImpl';

export const FSUtil = {
  async quickWriteFiles(
    mfs: MemoryFS,
    list: { data: ArrayBuffer; path: string }[],
    onProgress?: (pg: number, item: { data: ArrayBuffer; path?: string }) => any
  ): Promise<void> {
    const dirSet = new Set<string>();

    for (const d of list) {
      dirSet.add(Path.dirname(d.path));
    }

    for (const dir of dirSet) {
      if (!(await mfs.exists(dir))) await mfs.mkdirp(dir);
    }

    for (let i = 0; i < list.length; i++) {
      const d = list[i];

      onProgress?.((i + 1) / list.length, d);
      await mfs.writeFile(d.path, d.data);
    }
  },

  async copyTo(
    fromMfs: MemoryFS,
    toMfs: MemoryFS,
    pattern: string | string[] = '**',
    onProgress?: (pg: number) => any
  ) {
    const toWritePaths = typeof pattern === 'string' ? await fromMfs.glob(pattern) : pattern;
    const toWriteList: { data: ArrayBuffer; path: string }[] = [];

    for (const path of toWritePaths) {
      const data = await fromMfs.readFile(path);
      toWriteList.push({ data, path });
    }

    await this.quickWriteFiles(toMfs, toWriteList, onProgress);
  },

  async ensureDir(mfs: MemoryFS, dirname: string) {
    if (!(await mfs.exists(dirname))) await mfs.mkdirp(dirname);
  },

  /** 收集引用文件(不带 protocol) */
  async collectReferFilePaths(mfs: MemoryFS, data: any): Promise<string[]> {
    const fpSet = new Set<string>();

    // 收集引用的文件
    walkInDeep(data, item => {
      if (typeof item === 'string') {
        if (item.startsWith('file://')) fpSet.add(item.replace('file://', ''));
        // 字符串查找
        else {
          const matchRst = item.match(/file:\/\/[^"'\\]+/g);
          if (matchRst) {
            for (let i = 0; i < matchRst.length; i++) {
              const element = matchRst[i];
              fpSet.add(element.replace('file://', ''));
            }
          }
        }
      }
    });

    return [...fpSet.values()];
  },

  async dumpAndReduceDriverBlocks(mfs: MemoryFS, paths: string[], onProgress?: (pg: number) => any) {
    const contentMap = new Map<string, ArrayBuffer>();
    const sourcemap: { blockKey: string; path: string }[] = [];

    // 创建一个临时 mfs，辅助计算 blocks
    const _tempMfs = await MemoryFS.create(() => MemoryAdapter.empty());

    // 创建所有需要的目录和空文件
    for (const p of paths) {
      const dirname = Path.dirname(p);
      await this.ensureDir(_tempMfs, dirname);
      await _tempMfs.writeFile(p, '', 'utf-8');
    }

    const nodes: IFileIndexNode[] = JSON.parse(
      ExternalImpl.ArrayBufferToString(await _tempMfs.adapter.read(FILE_INDEX_BLOCK_ID))
    );

    let completeCnt = 0;

    // morph index
    for (const chunk of _.chunk(nodes, 6)) {
      await Promise.all(
        chunk.map(async node => {
          // 去掉元信息
          node.createdAt = undefined;
          node.modifiedAt = undefined;

          if (node.type === 'file') {
            const data = await mfs.readFile(node.id);
            const md5Str = md5(ExternalImpl.ArrayBufferToString(data));

            contentMap.set(md5Str, data);
            node.blockRef = md5Str;

            // 记录 md5 和原文件路径关联关系
            sourcemap.push({ blockKey: md5Str, path: node.id });

            completeCnt += 1;
            onProgress?.(completeCnt / nodes.length);
          }
        })
      );
    }

    const ret: { blocks: IBlock[]; fileIndexKey: string; sourcemap: { blockKey: string; path: string }[] } = {
      blocks: [],
      fileIndexKey: '',
      sourcemap,
    };

    const indexNodesJson = JSON.stringify(nodes);

    // 重建文件索引数据块
    ret.fileIndexKey = md5(indexNodesJson);
    const indexData = ExternalImpl.StringToArrayBuffer(indexNodesJson);
    ret.blocks.push({ data: indexData, size: indexData.byteLength, key: ret.fileIndexKey });

    // 重建文件内容数据块
    contentMap.forEach((data, key) => ret.blocks.push({ data, size: data.byteLength, key }));

    return ret;
  },
};
