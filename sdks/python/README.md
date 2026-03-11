# ZRO SDK for Python

Build ZRO application backends in Python.

## Installation

```bash
pip install zro-sdk
```

## Quick Start

```python
from zro_sdk import ZroApp, AppContext

app = ZroApp()

@app.command("greet")
async def greet(ctx: AppContext, name: str) -> str:
    return f"Hello, {name}!"

@app.command("add")
async def add(ctx: AppContext, a: int, b: int) -> dict:
    return {"sum": a + b}

if __name__ == "__main__":
    app.run()
```

## Manifest

```toml
[app]
name = "My Python App"
slug = "myapp"
version = "0.1.0"

[app.backend]
command = "python3"
args = ["main.py"]
working_dir = "."
```

## Features

- Zero external dependencies (stdlib only)
- Async/await (asyncio)
- Auto parameter extraction from JSON
- Session/context access
- Event emission (targeted + broadcast)
- Client lifecycle hooks (connected/disconnected/reconnected)

## License

MIT
