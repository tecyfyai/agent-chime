import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

/** Sounds that ship with the extension, by the name used in settings. */
export const BUILT_IN_SOUNDS = ['chime', 'knock'] as const;

/** The file to play for a sound setting, or undefined for silence. */
export function soundFile(setting: string, mediaDir: string): string | undefined {
  const value = setting.trim();
  if (value === '' || value === 'none') return undefined;
  if ((BUILT_IN_SOUNDS as readonly string[]).includes(value)) return path.join(mediaDir, `${value}.wav`);
  if (value === '~' || value.startsWith('~/')) return path.join(os.homedir(), value.slice(1));
  return value;
}

interface Player {
  command: string;
  args: (file: string, volume: number) => string[];
}

function players(platform: NodeJS.Platform): Player[] {
  switch (platform) {
    case 'darwin':
      return [{ command: 'afplay', args: (file, volume) => ['-v', volume.toFixed(2), file] }];
    case 'win32':
      return [
        {
          command: 'powershell.exe',
          args: (file) => [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`,
          ],
        },
      ];
    default:
      // Tried in order; the first one installed plays the sound.
      return [
        { command: 'pw-play', args: (file, volume) => ['--volume', volume.toFixed(2), file] },
        { command: 'paplay', args: (file, volume) => [`--volume=${Math.round(volume * 65536)}`, file] },
        { command: 'aplay', args: (file) => ['-q', file] },
      ];
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15_000, windowsHide: true }, (error) => (error ? reject(error) : resolve()));
  });
}

/** Plays a sound file at a volume from 0 to 100. Rejects if no player could play it. */
export async function playSound(file: string, volume: number, platform = process.platform): Promise<void> {
  const level = Math.min(100, Math.max(0, volume)) / 100;
  if (level === 0) return;
  let lastError: unknown;
  for (const player of players(platform)) {
    try {
      await run(player.command, player.args(file, level));
      return;
    } catch (error) {
      lastError = error;
      // Only move on to the next player when this one isn't installed.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') break;
    }
  }
  throw lastError;
}
