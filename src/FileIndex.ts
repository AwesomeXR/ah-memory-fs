import { FlatTreeHelper, ITreeNode } from 'ah-tree-helper';
import { ExternalImpl } from './ExternalImpl';

export type IFileIndexNode = ITreeNode & {
  createdAt?: number;
  modifiedAt?: number;
} & ({ type: 'dir' } | { type: 'file'; size: number; blockRef: string });

export class FileIndex {
  private _nodeTree = new FlatTreeHelper<IFileIndexNode>([]);

  buildCache() {
    return this._nodeTree.buildCache();
  }

  get(id: string) {
    return this._nodeTree.getById(id);
  }

  add(node: IFileIndexNode) {
    this._nodeTree.add([node]);
  }

  remove(id: string) {
    this._nodeTree.remove(id);
  }

  getDescendants(id: string) {
    const list: IFileIndexNode[] = [];
    this._nodeTree.walk(id, t => list.push(t));
    return list;
  }

  getAll() {
    return this._nodeTree.list;
  }

  getFlatChildren(id: string) {
    return this._nodeTree.getFlatChildren(id);
  }

  toData() {
    return ExternalImpl.StringToArrayBuffer(JSON.stringify(this._nodeTree.list));
  }

  async restore(data: ArrayBuffer) {
    const nodes: IFileIndexNode[] = JSON.parse(ExternalImpl.ArrayBufferToString(data));
    this._nodeTree = new FlatTreeHelper<IFileIndexNode>(nodes);
  }
}
