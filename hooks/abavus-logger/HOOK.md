---
name: abavus-logger
description: "Log conversations to Abavus chronicle and optionally rate Q&A quality"
homepage: https://github.com/toschdev/abavus
metadata:
  openclaw:
    emoji: "📜"
    events: ["command:new"]
    requires:
      bins: ["node"]
      config: ["workspace.dir"]
---

# Abavus Logger

Automatically logs conversations to your Abavus chronicle when you start a new session (`/new`).

## What It Does

1. **Imports the session** into Abavus SQLite database
2. **Optionally asks for quality rating** (answer relevance & question clarity)
3. **Generates embeddings** for semantic search (if enabled)

## Features

- Hash-chained, cryptographically signed entries
- Full-text and semantic search across all conversations
- Quality tracking for continuous improvement

## Configuration

Set in your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "abavus-logger": {
          "enabled": true,
          "options": {
            "askRating": true,
            "autoEmbed": false,
            "ollamaUrl": "http://localhost:11434"
          }
        }
      }
    }
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `askRating` | `true` | Prompt for quality rating after session |
| `autoEmbed` | `false` | Generate embeddings automatically |
| `ollamaUrl` | `localhost:11434` | Ollama URL for embeddings/rating |

## Installation

```bash
openclaw hooks install ~/abavus/hooks/abavus-logger
openclaw hooks enable abavus-logger
```

## Requirements

- Node.js
- Abavus (`~/abavus`)
- Ollama (for embeddings/rating, optional)
