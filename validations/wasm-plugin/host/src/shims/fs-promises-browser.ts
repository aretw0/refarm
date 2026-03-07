export async function readFile(_path: string): Promise<never> {
  throw new Error(
    [
      'Browser runtime attempted to use node:fs/promises.readFile().',
      'This path should be unreachable in browser mode.',
      'Check generated jco output and runtime guards (isNode).',
    ].join(' '),
  );
}
