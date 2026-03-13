#!/usr/bin/env node

/**
 * ZRO Module Scaffolding — Node.js SDK
 *
 * Creates a new module file with boilerplate.
 *
 * Usage:
 *   node scripts/new-module.js <name> [--description "..."] [--deps dep1,dep2]
 *
 * Example:
 *   node scripts/new-module.js kv --description "Key-value storage module"
 *   node scripts/new-module.js auth --deps kv
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: node scripts/new-module.js <name> [options]

Options:
  --description "..."   Module description
  --deps dep1,dep2      Comma-separated dependencies
  --dir <path>          Output directory (default: src/modules/)

Example:
  node scripts/new-module.js kv --description "Key-value store"
  node scripts/new-module.js auth --deps kv,session
`);
    process.exit(0);
}

const name = args[0];
let description = '';
let deps = [];
let outDir = path.join(__dirname, '..', 'src', 'modules');

for (let i = 1; i < args.length; i++) {
    if (args[i] === '--description' && args[i + 1]) {
        description = args[++i];
    } else if (args[i] === '--deps' && args[i + 1]) {
        deps = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === '--dir' && args[i + 1]) {
        outDir = path.resolve(args[++i]);
    }
}

// Validate name
if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    console.error(`Error: Invalid module name "${name}". Use lowercase letters, numbers, hyphens, underscores.`);
    process.exit(1);
}

// Generate PascalCase name
const pascalName = name
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

const depsStr = deps.length > 0 ? `dependencies: [${deps.map((d) => `'${d}'`).join(', ')}]` : '';
const metaFields = [
    `name: '${name}'`,
    `version: '0.1.0'`,
    description ? `description: '${description}'` : '',
    depsStr,
].filter(Boolean).join(',\n        ');

const content = `import type { ZroModule } from '../module';
import { ModuleRegistrar } from '../module';

/**
 * ${description || `${pascalName} module for ZRO.`}
 */
export const ${name.replace(/[-]/g, '_')}Module: ZroModule = {
    meta: {
        ${metaFields},
    },

    register(r: ModuleRegistrar) {
        // Register commands
        // r.command('${name}_example', async (ctx, params) => {
        //     return { ok: true };
        // });

        // Register WS event handlers
        // r.onEvent('${name}:event', async (ctx, data) => {
        //     // handle event
        // });

        // Register lifecycle hooks
        // r.on('client:connected', async (ctx) => {
        //     // handle connection
        // });

        // Register init/destroy hooks
        // r.onInit(async (ctx) => {
        //     // initialize resources
        // });
        // r.onDestroy(async () => {
        //     // cleanup resources
        // });
    },
};
`;

// Write file
fs.mkdirSync(outDir, { recursive: true });
const filePath = path.join(outDir, `${name}.ts`);

if (fs.existsSync(filePath)) {
    console.error(`Error: File already exists: ${filePath}`);
    process.exit(1);
}

fs.writeFileSync(filePath, content);
console.log(`✓ Created module: ${filePath}`);
console.log(`\nUsage in your app:\n`);
console.log(`  import { ${name.replace(/[-]/g, '_')}Module } from './modules/${name}';`);
console.log(`  app.module(${name.replace(/[-]/g, '_')}Module);`);
