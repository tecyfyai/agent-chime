import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { readNotice, type AgentNotice } from './events';
import { windowsDir } from './paths';

const MAX_BODY = 1024 * 1024;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Removes the files of windows that have closed without cleaning up after themselves. */
export function pruneClosedWindows(dir = windowsDir()): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const pid = Number(/^(\d+)-/.exec(name)?.[1]);
    if (name.endsWith('.window') && Number.isInteger(pid) && pid > 0 && !isRunning(pid)) {
      fs.rmSync(path.join(dir, name), { force: true });
    }
  }
}

function sameToken(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Listens on 127.0.0.1 for the hook script and registers this window in ~/.agent-chime/windows,
 * so the script can find it. Each report carries a token only processes able to read that folder know.
 */
export class Listener {
  private readonly token = crypto.randomBytes(24).toString('hex');
  private readonly server: http.Server;
  private windowFile: string | undefined;

  constructor(private readonly onNotice: (notice: AgentNotice) => Promise<void>) {
    this.server = http.createServer((request, response) => this.handle(request, response));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = this.server.address() as AddressInfo;
    const dir = windowsDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    pruneClosedWindows(dir);
    this.windowFile = path.join(dir, `${process.pid}-${port}.window`);
    fs.writeFileSync(this.windowFile, `${port} ${this.token}\n`, { mode: 0o600 });
  }

  dispose(): void {
    if (this.windowFile) fs.rmSync(this.windowFile, { force: true });
    this.windowFile = undefined;
    this.server.close();
  }

  private handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'POST' || url.pathname !== '/event') {
      response.writeHead(404).end();
      return;
    }
    if (!sameToken(request.headers['x-agent-chime-token'], this.token)) {
      response.writeHead(403).end();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        response.writeHead(413).end();
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (response.headersSent) return;
      const notice = readNotice(url.searchParams, Buffer.concat(chunks).toString('utf8'));
      if (!notice) {
        response.writeHead(400).end();
        return;
      }
      // Answer only once the window has looked at the report: the hook script's process id is how the
      // window finds the terminal, and that process has to be alive while it looks.
      this.onNotice(notice)
        .catch((error: unknown) => console.error('[agent-chime]', error))
        .finally(() => response.writeHead(204).end());
    });
  }
}
