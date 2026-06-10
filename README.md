# 🗺️ archmap

> **Discover the architecture your code actually has — not the one you think it has.**

Every codebase has a folder structure. But the **real** architecture is hidden in how your files actually depend on each other. `archmap` finds it.

[![npm version](https://img.shields.io/npm/v/archmap.svg)](https://www.npmjs.com/package/archmap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Why?

Your folder structure is **fiction**. It reflects decisions made years ago by people who've left the team. The **real** modules are the ones the code forms through coupling — and they rarely match your directories.

```
What you have:           What you actually have:        What archmap finds:
                         
src/                     src/                           ┌──────────────────────┐
├── components/          ├── components/                │ AUTH CLUSTER (31 files)│
├── services/   ←───?───→├── services/                  │ → 18 files in services/│
├── utils/      ←───?───→├── utils/                     │ → 8 files in utils/    │
├── hooks/               ├── hooks/                     │ → 5 files in hooks/    │
└── types/               └── types/                     │ COHESION: 0.78 HIGH   │
                                                        └──────────────────────┘
Your folder structure      The invisible coupling        archmap's discovered modules
is organized by role.      creates hidden modules.       reflect actual behavior.
```

---

## Quick Start

```bash
# No install needed
npx archmap

# Or install globally
npm install -g archmap
archmap src/
```

---

## What It Does

Run it on any project:

```bash
$ archmap src/
```

```
╔══════════════════════════════════════════════════════════════╗
║  ARCHMAP — Architecture Discovery                           ║
╠══════════════════════════════════════════════════════════════╣
║  Project: my-app                                            ║
║  Files:   312 source files                                  ║
║  Edges:   2,847 import relationships                        ║
║  Modules: 7 natural modules discovered                      ║
║  Languages: typescript, javascript                          ║
╚══════════════════════════════════════════════════════════════╝

┌─── DISCOVERED MODULES (by actual coupling, not folder structure) ───┐
│                                                                      │
│  Auth Cluster          31 files  HIGH ████████████░░                 │
│  Payment Engine        47 files  HIGH ██████████░░░░                 │
│  Notification Hub      22 files  HIGH ████████████░░                 │
│  Data Layer            58 files  MED  ██████░░░░░░░░                 │
│  API Gateway           34 files  HIGH ██████████████                 │
│  Admin Panel           28 files  MED  ███████░░░░░░░                 │
│  Shared Core           89 files  LOW  ██░░░░░░░░░░░░                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌─── SPRAWL DETECTED ───────────────────────────────────────────────┐
│  12 files don't cluster — they're imported by everything:         │
│                                                                    │
│    src/utils/formatters.ts                                        │
│    src/utils/validators.ts                                        │
│    src/hooks/useAuth.ts                                           │
│    src/components/Button.tsx                                      │
│    ... and 8 more sprawling files                                 │
│                                                                    │
│  → These files are invisible "utils" folders. Consider:           │
│    1. Split large utils into domain-specific modules              │
│    2. Move shared code to a dedicated core/ package               │
└────────────────────────────────────────────────────────────────────┘

┌─── TANGLED MODULE BOUNDARIES ────────────────────────────────────┐
│                                                                    │
│  🔴 HIGH   Payment Engine ↔ Notification Hub (47 cross-imports)  │
│  🟡 MEDIUM Auth Cluster ↔ Admin Panel (23 cross-imports)          │
│  🟡 MEDIUM Data Layer ↔ Payment Engine (18 cross-imports)         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

┌─── SUGGESTED RESTRUCTURE ────────────────────────────────────────┐
│                                                                    │
│  [SPLIT]  Directory "src/utils/" (89 files) contains 4 natural   │
│           modules. Consider splitting into separate directories.  │
│           ⚡ MEDIUM IMPACT  89 files affected                      │
│                                                                    │
│  [MERGE]  Module "Payment Engine" (47 files) is spread across     │
│           8 directories. Consider consolidating.                  │
│           ⚠ HIGH IMPACT  47 files affected                         │
│                                                                    │
│  [EXTRACT] 14 files act as hubs (high imports + high exports).    │
│           Consider extracting stable interfaces.                  │
│           ⚡ MEDIUM IMPACT  14 files affected                      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

───────────────────────────────────────────────────────────────────

  Current structure:  42 directories  (by folder layout)
  Optimal structure:  7 modules       (by actual coupling)

  → 35 directories are artifacts of history, not architecture.
  → 12 files show signs of sprawl — unclustered, high-coupling files.
  → 3 high-severity boundary violations found. Fix these first.
```

---

## How It Works

```
 Source Files          Dependency Graph        Community Detection       Analysis
 ┌──────────┐         ┌──────────────┐         ┌──────────────┐         ┌──────────┐
 │ .ts .tsx │ ──►    │   import     │  ──►   │   Louvain    │  ──►   │ Boundaries│
 │ .js .jsx │  AST   │   graph      │ cluster│   algorithm   │ detect │  Sprawl  │
 │ .mjs     │  parse │              │        │              │        │ Suggest  │
 └──────────┘         └──────────────┘         └──────────────┘         └──────────┘
```

1. **Scans** your source files and parses ASTs using the TypeScript Compiler API
2. **Builds** a directed dependency graph from imports
3. **Discovers** natural module boundaries using the Louvain community detection algorithm
4. **Analyzes** boundary violations, sprawl, and coupling hotspots
5. **Outputs** actionable restructure suggestions

---

## Commands

```bash
# Analyze current directory
archmap

# Analyze specific directory
archmap src/

# Include only certain patterns
archmap --include 'src/server' 'src/shared'

# Exclude patterns
archmap --exclude 'test' '__mocks__'

# Machine-readable output (for CI)
archmap --json

# Verbose mode
archmap -v
```

---

## Roadmap

| Version | Feature |
|---------|---------|
| v0.1 | TypeScript/JavaScript support, Louvain clustering, terminal output |
| v0.2 | Git co-change analysis — find files that change together |
| v0.3 | Multi-language support via tree-sitter (Python, Go, Rust) |
| v0.4 | PR integration — annotate PRs with architecture impact |
| v0.5 | Interactive HTML report with zoomable graph |
| v1.0 | CI mode — fail builds on architecture regressions |

---

## Contributing

```bash
git clone https://github.com/silentganja/archmap.git
cd archmap
npm install
npm run build
npm start -- src/
```

---

## License

MIT © [silentganja](https://github.com/silentganja)

---

<p align="center">
  <b>Your folders tell a story. Your imports tell the truth.</b>
</p>
