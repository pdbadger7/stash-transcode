import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rootDir, '..');
const sourceRoot = path.join(repoRoot, 'plugin-source');
const packageDir = path.join(sourceRoot, 'packages');
const buildDir = path.join(sourceRoot, '.build');
const packageName = 'external-transcode-player';
const version = '0.1.1';
const packageFile = `${packageName}-${version}.zip`;
const stagingDir = path.join(buildDir, packageFile.replace(/\.zip$/, ''));

await rm(buildDir, { recursive: true, force: true });
await rm(packageDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });
await mkdir(packageDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, 'src/index.ts')],
  outfile: path.join(stagingDir, 'externalTranscodePlayer.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  logLevel: 'info',
});

await copyFile(
  path.join(rootDir, 'externalTranscodePlayer.yml'),
  path.join(stagingDir, 'externalTranscodePlayer.yml')
);

execFileSync('zip', ['-qr', path.join(packageDir, packageFile), '.'], {
  cwd: stagingDir,
});

const zipBuffer = await readFile(path.join(packageDir, packageFile));
const sha256 = createHash('sha256').update(zipBuffer).digest('hex');
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

await writeFile(
  path.join(sourceRoot, 'index.yml'),
  `- id: ${packageName}\n  name: External Transcode Player\n  version: ${version}\n  date: ${now}\n  path: packages/${packageFile}\n  sha256: ${sha256}\n  metadata:\n    manifest: externalTranscodePlayer.yml\n`
);
