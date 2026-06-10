# archmap

> **Discover the architecture your code actually has, not the one you think it has.**

Every codebase has a folder structure. But the **real** architecture is hidden in how your files actually depend on each other. `archmap` reveals it.

[![npm version](https://img.shields.io/npm/v/archmap.svg)](https://www.npmjs.com/package/archmap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## The Problem

Your folder structure is **fiction**. It reflects decisions made years ago by people who may have left the team. The **real** modules are the ones the code forms through coupling, and they rarely match your directories.

```
What you have:           What archmap sees:           What archmap suggests:

src/                     src/
├── components/          ┌─────────────────────────┐  Keep: Auth Cluster
├── services/   ←?→      │ AUTH CLUSTER (31 files) │  Move 18 files from
├── utils/      ←?→      │ 18 files in services/   │  services/ + 8 from
├── hooks/               │ 8 files in utils/       │  utils/ + 5 from hooks/
└── types/               │ 5 files in hooks/       │  into one directory
                         │ COHESION: 0.78 HIGH     │
Your folders are          └─────────────────────────┘  The import graph reveals
organized by role.        The import graph reveals    the true organization.
                          the true modules.
```

Files that sit in different directories but heavily import each other belong together. Files that never interact but share a folder are merely neighbors, not teammates.

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

## Features

### Module Discovery

`archmap` parses your source files, builds a dependency graph from imports, then runs the **Louvain community detection algorithm** to find natural module boundaries. These are the modules your code actually forms, regardless of folder layout.

```
┌─── DISCOVERED MODULES (by actual coupling, not folder structure) ───┐
│                                                                      │
│  Auth Cluster          31 files  HIGH ████████████░░  (21%)         │
│  Payment Engine        47 files  HIGH ██████████░░░░  (32%)         │
│  Notification Hub      22 files  HIGH ████████████░░  (15%)         │
│  Data Layer            58 files  MED  ██████░░░░░░░░  (39%)         │
│  API Gateway           34 files  HIGH ██████████████  (23%)         │
│  Admin Panel           28 files  MED  ███████░░░░░░░  (19%)         │
│  Shared Core           89 files  LOW  ██░░░░░░░░░░░░  (60%)         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Each module shows:
- **Name**: derived from the most common directory
- **Size**: how many files belong to it
- **Cohesion**: how tightly its files depend on each other (HIGH/MED/LOW)
- **Bar chart**: visual cohesion indicator
- **Percentage**: share of the total codebase

### Sprawl Detection

Some files do not cluster well. They are imported by everything or import from everywhere. These are your invisible "utils" folders, scattered across the codebase.

```
┌─── SPRAWL DETECTED ───────────────────────────────────────────────┐
│  12 files don't cluster - they're imported by everything:         │
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
```

### Boundary Violations

When files from one discovered module heavily import from another, that is a boundary violation. These are hidden dependencies that violate the natural module structure.

```
┌─── TANGLED MODULE BOUNDARIES ────────────────────────────────────┐
│                                                                    │
│  🔴 HIGH   Payment Engine ↔ Notification Hub (47 cross-imports)  │
│  🟡 MEDIUM Auth Cluster ↔ Admin Panel (23 cross-imports)          │
│  🟡 MEDIUM Data Layer ↔ Payment Engine (18 cross-imports)         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Restructure Suggestions

Based on the gap between your folder structure and the discovered modules, `archmap` generates concrete, actionable suggestions.

```
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
│  [EXTRACT] 14 files act as hubs. They have high imports and      │
│           high exports. Consider extracting stable interfaces.    │
│           ⚡ MEDIUM IMPACT  14 files affected                      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Git Co-Change Analysis (`--git`)

Static import analysis only captures explicit dependencies. But some files **change together in commits** without importing each other. This reveals hidden coupling: shared logic, implicit contracts, or conventions that the code structure does not capture.

```bash
archmap --git
```

```
┌─── GIT CO-CHANGE ANALYSIS ──────────────────────────────────────┐
│  500 commits analyzed - 18 co-change pairs found                  │
│                                                                   │
│  auth.ts + permissions.ts  14× together  Jaccard: 0.82 ⚡CROSS   │
│  payment.ts + invoice.ts   12× together  Jaccard: 0.71           │
│  users.ts + roles.ts        9× together  Jaccard: 0.64 ⚡CROSS   │
│                                                                   │
│  ⚠ 7 co-change pairs cross module boundaries                    │
│  → These files change together but belong to different modules.  │
│  → Hidden coupling - consider a shared contract or merging.      │
└───────────────────────────────────────────────────────────────────┘
```

When two files in **different modules** change together frequently, that is a hidden architectural dependency. They share logic, a contract, or an implicit convention that your folder structure does not capture.

**How co-change scoring works:**

| Metric | Meaning |
|--------|---------|
| **Together count** | How many commits touched both files |
| **Jaccard similarity** | `|A ∩ B| / |A ∪ B|` (how often they change together vs separately) |
| **Surprise score** | How many standard deviations above the expected co-change rate |
| **Cross-module flag** | Files belong to different discovered modules (architecture smell) |

---

## How It Works

```
 Source Files          Dependency Graph        Community Detection       Analysis
 ┌──────────┐         ┌──────────────┐         ┌──────────────┐         ┌──────────┐
 │ .ts .tsx │  ──►   │   import     │  ──►   │   Louvain    │  ──►   │ Boundaries│
 │ .js .jsx │  AST   │   graph      │ cluster│   algorithm   │ detect │  Sprawl  │
 │ .mjs     │  parse │              │        │              │        │ Suggest  │
 └──────────┘         └──────────────┘         └──────────────┘         └──────────┘
```

1. **Scan** - Discovers source files and parses them using the TypeScript Compiler API. Extracts all imports and exports with their symbols, line numbers, and resolution status.

2. **Graph** - Builds a directed dependency graph. Multiple imports between the same file pair are merged into a single edge with aggregated symbol lists. In-degree and out-degree are computed for every node.

3. **Cluster** - Runs the Louvain community detection algorithm on the undirected co-import graph. Two files are connected if they import each other, are imported by the same files, or share import targets. Uses a deterministic seeded PRNG so results are reproducible across runs.

4. **Analyze** - Detects boundary violations (cross-module import density), sprawling files (high in-degree and out-degree), and generates restructure suggestions by comparing discovered modules against the actual folder tree.

5. **Git** (optional) - Parses `git log` to find files that change together in commits. Computes Jaccard similarity and surprise scores. Flags cross-module co-change pairs as architecture smells and feeds them into restructure suggestions.

6. **Output** - Renders results as ANSI box-drawn terminal diagrams with color-coded severity indicators, or as structured JSON for CI pipelines.

---

## Command Reference

```bash
# Analyze the current directory
archmap

# Analyze a specific directory
archmap src/

# Only include files matching patterns
archmap --include 'src/server' 'src/shared'

# Exclude directories or patterns
archmap --exclude 'test' '__mocks__' '*.spec.ts'

# Enable git co-change analysis (analyzes up to 500 recent commits)
archmap --git

# Machine-readable JSON output (useful for CI or custom tooling)
archmap --json

# Verbose mode (shows progress and timing)
archmap -v
```

### JSON Output

When using `--json`, the result includes the full analysis. The raw graph object is replaced with a `graphSummary` to keep output manageable:

```json
{
  "fileCount": 147,
  "edgeCount": 1042,
  "discoveredModules": [...],
  "sprawlingFiles": [...],
  "boundaryViolations": [...],
  "restructureSuggestions": [...],
  "coChange": {
    "pairs": [...],
    "commitsAnalyzed": 500,
    "crossModulePairs": [...]
  }
}
```

---

## Supported Languages

| Language | Extensions | Parser | Status |
|----------|-----------|--------|--------|
| TypeScript | `.ts`, `.tsx` | TypeScript Compiler API | Supported |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | TypeScript Compiler API | Supported |
| Python | `.py` | tree-sitter | Planned (v0.3) |
| Go | `.go` | tree-sitter | Planned (v0.3) |
| Rust | `.rs` | tree-sitter | Planned (v0.3) |

---

## Common Use Cases

### Finding the real modules in a monolith

```bash
archmap src/

# Look at the DISCOVERED MODULES section.
# Compare each module's file list against your folder structure.
# Files from the same module that sit in different folders should be co-located.
```

### Detecting hidden coupling before a refactor

```bash
archmap src/ --git

# Cross-module co-change pairs are your highest risk items.
# These files will need to change together regardless of your refactor.
# Consider merging their modules or extracting a shared interface first.
```

### Auditing a new codebase

```bash
git clone <new-project>
cd <new-project>
npx archmap --git

# Instantly see the real module boundaries, sprawl hotspots,
# and hidden coupling, without reading a single line of code.
```

### CI integration

```bash
archmap src/ --json > archmap-report.json

# Compare against a baseline to detect architecture regressions.
# Full CI mode with threshold enforcement coming in v1.0.
```

---

## Project Architecture

```
src/
├── index.ts          # Entry point, loads CLI
├── cli.ts            # CLI argument parsing via Commander
├── scanner.ts        # File discovery and TS/JS AST parsing
├── graph.ts          # Dependency graph builder and Louvain clustering
├── analysis.ts       # Boundary violations, sprawl, restructure suggestions
├── git-analysis.ts   # Git co-change analysis
├── output.ts         # Terminal box-drawn diagrams and JSON output
└── types.ts          # Shared TypeScript type definitions
```

---

## Contributing

```bash
git clone https://github.com/silentganja/archmap.git
cd archmap
npm install
npm run build

# Dogfood: run archmap on itself
node bin/archmap.js src/

# Run the test suite (26 tests)
npm test

# Watch mode during development
npx vitest
```

We follow [Conventional Commits](https://www.conventionalcommits.org/). See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide including release process and code conventions.

---

## Roadmap

| Version | Feature | Status |
|---------|---------|--------|
| v0.1 | TypeScript/JavaScript support, Louvain clustering, terminal output | Released |
| v0.2 | Git co-change analysis | Released |
| v0.3 | Multi-language support via tree-sitter (Python, Go, Rust) | Planned |
| v0.4 | PR integration - annotate PRs with architecture impact | Planned |
| v0.5 | Interactive HTML report with zoomable dependency graph | Planned |
| v1.0 | CI mode - fail builds on architecture regressions | Planned |

---

## License

MIT © [silentganja](https://github.com/silentganja)

---

<p align="center">
  <b>Your folders tell a story. Your imports tell the truth.</b>
</p>
