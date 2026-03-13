/**
 * ZRO Frontend SDK — Build Script
 *
 * Compiles the modular TypeScript source into browser-ready bundles:
 *   - static/zro-client.js      — IIFE bundle (backward-compatible global)
 *   - static/zro-shared-worker.js — SharedWorker bundle
 *   - dist/zro-sdk.esm.js       — ES module bundle (for advanced usage)
 *
 * Usage:
 *   node scripts/build.js           # One-shot build
 *   node scripts/build.js --watch   # Watch mode (rebuilds on changes)
 *
 * The build auto-discovers all modules in src/modules/ and bundles them.
 */

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(ROOT, '..', '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const STATIC = path.join(PROJECT_ROOT, 'static');

const isWatch = process.argv.includes('--watch');
const isMinify = process.argv.includes('--minify');

// ── Module discovery ────────────────────────────────────

function discoverModules() {
  const modulesDir = path.join(SRC, 'modules');
  const files = fs.readdirSync(modulesDir);
  const modules = [];

  for (const file of files) {
    if (file === 'index.ts') continue;
    if (!file.endsWith('.ts')) continue;

    const name = file.replace('.ts', '');
    const fullPath = path.join(modulesDir, file);
    const content = fs.readFileSync(fullPath, 'utf-8');

    // Extract module metadata from the meta block
    // Use a targeted regex that matches inside the meta: { ... } block
    const metaBlock = content.match(/meta:\s*\{[^}]*\}/s);
    const metaStr = metaBlock ? metaBlock[0] : '';
    const nameMatch = metaStr.match(/name:\s*['"]([^'"]+)['"]/);
    const versionMatch = metaStr.match(/version:\s*['"]([^'"]+)['"]/);
    const categoryMatch = metaStr.match(/category:\s*['"]([^'"]+)['"]/);
    if (!nameMatch) continue; // Skip files without a proper meta block

    modules.push({
      file: name,
      name: nameMatch ? nameMatch[1] : name,
      version: versionMatch ? versionMatch[1] : '0.0.0',
      category: categoryMatch ? categoryMatch[1] : 'unknown',
      path: fullPath,
    });
  }

  return modules;
}

// ── Build configs ───────────────────────────────────────

async function build() {
  // Ensure output dirs exist
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(STATIC, { recursive: true });

  const discovered = discoverModules();
  console.log(`\n  📦 ZRO Frontend SDK Build`);
  console.log(`  ─────────────────────────`);
  console.log(`  Modules discovered: ${discovered.length}`);
  for (const m of discovered) {
    console.log(`    · ${m.name} v${m.version} [${m.category}]`);
  }
  console.log('');

  // Shared esbuild options
  const commonOptions = {
    bundle: true,
    target: 'es2020',
    sourcemap: true,
    minify: isMinify,
    logLevel: /** @type {const} */ ('info'),
  };

  // ── 1. Browser IIFE bundle → static/zro-client.js ────

  const browserConfig = {
    ...commonOptions,
    entryPoints: [path.join(SRC, 'browser.ts')],
    outfile: path.join(STATIC, 'zro-client.js'),
    format: /** @type {const} */ ('iife'),
    globalName: '_ZroSDK',
    banner: {
      js: `/**\n * zro-client.js — ZRO Frontend SDK v0.1.0\n * Built: ${new Date().toISOString()}\n * Modules: ${discovered.map(m => m.name).join(', ')}\n */`,
    },
  };

  // ── 2. SharedWorker bundle → static/zro-shared-worker.js

  const workerConfig = {
    ...commonOptions,
    entryPoints: [path.join(SRC, 'worker.ts')],
    outfile: path.join(STATIC, 'zro-shared-worker.js'),
    format: /** @type {const} */ ('iife'),
    banner: {
      js: `/**\n * zro-shared-worker.js — ZRO SharedWorker v0.1.0\n * Built: ${new Date().toISOString()}\n */`,
    },
  };

  // ── 3. ES module bundle → dist/zro-sdk.esm.js ────────

  const esmConfig = {
    ...commonOptions,
    entryPoints: [path.join(SRC, 'index.ts')],
    outfile: path.join(DIST, 'zro-sdk.esm.js'),
    format: /** @type {const} */ ('esm'),
    banner: {
      js: `/**\n * @zro/frontend-sdk — ES Module Bundle v0.1.0\n * Built: ${new Date().toISOString()}\n */`,
    },
  };

  if (isWatch) {
    console.log('  👁  Watch mode — rebuilding on changes...\n');

    const contexts = await Promise.all([
      esbuild.context(browserConfig),
      esbuild.context(workerConfig),
      esbuild.context(esmConfig),
    ]);

    await Promise.all(contexts.map(ctx => ctx.watch()));

    // Initial build
    console.log('  ✓ Initial build complete. Watching for changes...\n');
  } else {
    await Promise.all([
      esbuild.build(browserConfig),
      esbuild.build(workerConfig),
      esbuild.build(esmConfig),
    ]);

    // Report sizes
    const files = [
      ['static/zro-client.js', path.join(STATIC, 'zro-client.js')],
      ['static/zro-shared-worker.js', path.join(STATIC, 'zro-shared-worker.js')],
      ['dist/zro-sdk.esm.js', path.join(DIST, 'zro-sdk.esm.js')],
    ];

    console.log('  Output:');
    for (const [label, filePath] of files) {
      const stat = fs.statSync(filePath);
      const kb = (stat.size / 1024).toFixed(1);
      console.log(`    ✓ ${label}  (${kb} KB)`);
    }
    console.log('\n  ✅ Build complete!\n');
  }
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
