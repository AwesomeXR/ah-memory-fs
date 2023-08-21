export function walkInDeep(data: any, tap: (item: any, path: string) => any, _pathPrefix = '$'): void {
  // tap self
  tap(data, _pathPrefix);

  if (
    typeof data === 'boolean' ||
    typeof data === 'function' ||
    typeof data === 'number' ||
    typeof data === 'string' ||
    typeof data === 'symbol' ||
    typeof data === 'undefined' ||
    data === null
  ) {
    return;
  }

  // 开始深度优先递归
  const keys = Array.isArray(data) ? [...data.keys()] : Object.keys(data);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const path = `${_pathPrefix}.${key}`;
    const item = data[key];

    // 递归向下
    walkInDeep(item, tap, path);
  }
}
