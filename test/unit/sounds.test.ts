import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { soundFile } from '../../src/sounds';

describe('soundFile', () => {
  const media = '/ext/media';

  it('maps the built-in names to the files that ship with the extension', () => {
    expect(soundFile('chime', media)).toBe(path.join(media, 'chime.wav'));
    expect(soundFile(' knock ', media)).toBe(path.join(media, 'knock.wav'));
  });

  it('treats none and an empty value as silence', () => {
    expect(soundFile('none', media)).toBeUndefined();
    expect(soundFile('', media)).toBeUndefined();
  });

  it('accepts a path of the user’s own, including one in the home folder', () => {
    expect(soundFile('/System/Library/Sounds/Glass.aiff', media)).toBe('/System/Library/Sounds/Glass.aiff');
    expect(soundFile('~/Sounds/ding.wav', media)).toBe(path.join(os.homedir(), 'Sounds/ding.wav'));
  });
});
