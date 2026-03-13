/**
 * ZRO Frontend SDK — Module Scaffolding Script
 *
 * Creates a new module with the correct structure and registers it
 * in the module barrel (src/modules/index.ts).
 *
 * Usage:
 *   node scripts/new-module.js <name> [--category <cat>] [--deps <dep1,dep2>]
 *
 * Examples:
 *   node scripts/new-module.js clipboard --category ux
 *   node scripts/new-module.js dnd --category ux --deps shell
 *   node scripts/new-module.js router --category util
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'src', 'modules');
const BARREL_FILE = path.join(MODULES_DIR, 'index.ts');

// ── Parse args ──────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
  ZRO Module Scaffolding
  ──────────────────────

  Usage:
    node scripts/new-module.js <name> [options]

  Options:
    --category <cat>    Module category: core, shell, data, ux, util, dev
                        (default: util)
    --deps <dep1,dep2>  Comma-separated dependency module names
                        (default: none)

  Examples:
    node scripts/new-module.js clipboard --category ux
    node scripts/new-module.js router --category util
    node scripts/new-module.js dnd --category ux --deps shell
`);
    process.exit(0);
  }

  const name = args[0];
  let category = 'util';
  let deps = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--category' && args[i + 1]) {
      category = args[++i];
    } else if (args[i] === '--deps' && args[i + 1]) {
      deps = args[++i].split(',').map(d => d.trim());
    }
  }

  return { name, category, deps };
}

// ── Helpers ─────────────────────────────────────────────

function toCamelCase(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function toPascalCase(str) {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

// ── Generate module file ────────────────────────────────

function generateModule({ name, category, deps }) {
  const factoryName = `${toCamelCase(name)}Module`;
  const apiInterface = `${toPascalCase(name)}API`;
  const depsArray = deps.length > 0
    ? `[${deps.map(d => `'${d}'`).join(', ')}]`
    : '[]';
  const depsImports = deps.length > 0
    ? deps.map(d => {
      const typeName = `${toPascalCase(d)}API`;
      return `      const _${toCamelCase(d)} = ctx.getModule<${typeName}>('${d}');`;
    }).join('\n')
    : '';

  return `/**
 * @zro/${name} — ${toPascalCase(name)} module.
 *
 * TODO: Add description.
 */

import type {
  ZroModule,
  ZroModuleFactory,
  ZroModuleContext,
} from '../core/types.js';

// ── Public API type ──────────────────────────────────────

export interface ${apiInterface} {
  // TODO: Define the module's public API
}

// ── Module factory ───────────────────────────────────────

export const ${factoryName}: ZroModuleFactory = () => {
  const mod: ZroModule = {
    meta: {
      name: '${name}',
      version: '0.1.0',
      description: 'TODO: Add description',
      category: '${category}',
      dependencies: ${depsArray},
    },

    init(ctx: ZroModuleContext): ${apiInterface} {
${depsImports ? depsImports + '\n' : ''}      ctx.log('${name} module initialized');

      const api: ${apiInterface} = {
        // TODO: Implement the module's public API
      };

      return api;
    },

    destroy(): void {
      // TODO: Clean up resources if needed
    },
  };

  return mod;
};
`;
}

// ── Update barrel (index.ts) ────────────────────────────

function updateBarrel(name) {
  const factoryName = `${toCamelCase(name)}Module`;
  const exportLine = `export { ${factoryName} } from './${name}.js';`;

  let barrel = fs.readFileSync(BARREL_FILE, 'utf-8');

  if (barrel.includes(exportLine)) {
    console.log(`  ⚠  Module '${name}' already in barrel — skipping update.`);
    return;
  }

  // Add export before the last line or at the end
  barrel = barrel.trimEnd() + '\n' + exportLine + '\n';
  fs.writeFileSync(BARREL_FILE, barrel);
}

// ── Main ────────────────────────────────────────────────

const opts = parseArgs();

// Validate
const validCategories = ['core', 'shell', 'data', 'ux', 'util', 'dev'];
if (!validCategories.includes(opts.category)) {
  console.error(`  ✗ Invalid category '${opts.category}'. Valid: ${validCategories.join(', ')}`);
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]*$/.test(opts.name)) {
  console.error(`  ✗ Invalid module name '${opts.name}'. Use lowercase, alphanumeric, dashes.`);
  process.exit(1);
}

const modulePath = path.join(MODULES_DIR, `${opts.name}.ts`);
if (fs.existsSync(modulePath)) {
  console.error(`  ✗ Module file already exists: src/modules/${opts.name}.ts`);
  process.exit(1);
}

// Generate
const content = generateModule(opts);
fs.writeFileSync(modulePath, content);

// Update barrel
updateBarrel(opts.name);

const factoryName = `${toCamelCase(opts.name)}Module`;

console.log(`
  ✅ Module '${opts.name}' created!

  Files:
    · src/modules/${opts.name}.ts    — Module implementation
    · src/modules/index.ts           — Updated with export

  Next steps:
    1. Define the API interface in src/modules/${opts.name}.ts
    2. Implement init() logic
    3. If needed, add the type to src/core/types.ts
    4. Import in src/client.ts for typed convenience accessor
    5. Run: npm run build
`);
