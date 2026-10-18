// Bundles the extension with esbuild. `--production` minifies, `--watch` rebuilds on change,
// and `--tests` builds the VS Code integration tests into out/.
import * as esbuild from 'esbuild';

const args = new Set(process.argv.slice(2));
const production = args.has('--production');

const options = args.has('--tests')
  ? {
      entryPoints: ['test/vscode/*.test.ts'],
      outdir: 'out/test',
      bundle: true,
      external: ['vscode', 'mocha'],
    }
  : {
      entryPoints: ['src/extension.ts'],
      outfile: 'dist/extension.js',
      bundle: true,
      external: ['vscode'],
      minify: production,
      sourcemap: !production,
    };

const context = await esbuild.context({
  ...options,
  platform: 'node',
  format: 'cjs',
  // jsonc-parser's default build loads its parts at run time, which a bundle can't follow; its ES module build can be bundled.
  mainFields: ['module', 'main'],
  target: 'node20',
  logLevel: 'info',
});

if (args.has('--watch')) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
