import { execFile } from 'node:child_process';

/** Reads `ps -A -o pid=,ppid=` output into a map from each process to its parent. */
export function parseProcessList(output: string): Map<number, number> {
  const parents = new Map<number, number>();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (match) parents.set(Number(match[1]), Number(match[2]));
  }
  return parents;
}

/** The process itself and every process above it, nearest first. */
export function ancestors(pid: number, parents: Map<number, number>): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let current: number | undefined = pid;
  while (current !== undefined && current > 0 && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = parents.get(current);
  }
  return chain;
}

export function listProcesses(): Promise<Map<number, number>> {
  return new Promise((resolve, reject) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid='], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(parseProcessList(stdout));
    });
  });
}
