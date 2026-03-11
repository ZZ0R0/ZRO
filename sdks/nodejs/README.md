# ZRO SDK for Node.js

Build ZRO application backends in JavaScript/TypeScript.

## Installation

```bash
npm install @zro/sdk
```

## Quick Start

```javascript
const { ZroApp } = require('@zro/sdk');

const app = new ZroApp();

app.command('greet', async (ctx, { name }) => {
    return `Hello, ${name}!`;
});

app.command('add', async (ctx, { a, b }) => {
    return { sum: a + b };
});

app.run();
```

## TypeScript

```typescript
import { ZroApp, AppContext } from '@zro/sdk';

const app = new ZroApp();

app.command<{ name: string }>('greet', async (ctx: AppContext, { name }) => {
    return `Hello, ${name}!`;
});

app.run();
```

## Features

- Zero runtime dependencies
- TypeScript types included
- Async/await
- Auto parameter extraction
- Session/context access
- Event emission (targeted + broadcast)
- Client lifecycle hooks

## License

MIT
