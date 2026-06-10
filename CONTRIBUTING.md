# Contributing to archmap

Thanks for wanting to help! Here's how to get started.

## Setup

```bash
git clone https://github.com/silentganja/archmap.git
cd archmap
npm install
npm run build
```

## Development workflow

```bash
# Run archmap on itself (dogfooding)
node bin/archmap.js src/

# Run tests
npm test

# Watch mode
npx vitest

# Build after changes
npm run build
```

## Commit conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - new feature
- `fix:` - bug fix
- `docs:` - documentation only
- `refactor:` - code change that neither fixes a bug nor adds a feature
- `test:` - adding or updating tests
- `chore:` - maintenance tasks

## Release process

```bash
# Patch release (0.1.0 → 0.1.1)
npm run release

# Minor release (0.1.0 → 0.2.0)
npm run release:minor

# Major release (0.1.0 → 1.0.0)
npm run release:major
```

This will:
1. Bump the version in `package.json`
2. Update `CHANGELOG.md` from commit history
3. Create a git tag
4. Commit everything

Then push with tags:

```bash
git push --follow-tags origin master
```

## Architecture

```
src/
├── index.ts      # Entry point
├── cli.ts         # CLI argument parsing (commander)
├── scanner.ts     # File discovery + TS/JS AST parsing
├── graph.ts       # Dependency graph + Louvain community detection
├── analysis.ts    # Boundary violations, sprawl, suggestions
├── output.ts      # Terminal + JSON output rendering
└── types.ts       # Shared TypeScript types
```

## Adding language support

1. Add extension to `SUPPORTED_EXTENSIONS` in `scanner.ts`
2. Implement a parser function (or integrate tree-sitter)
3. Map AST nodes to `ImportSymbol` / `ExportSymbol`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
