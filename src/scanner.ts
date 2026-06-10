/**
 * Scanner - discovers source files and routes to language-specific parsers.
 *
 * File discovery works across all registered languages (TS/JS, Python, Go, Rust).
 * Parsing delegates to the appropriate LanguageParser based on file extension.
 *
 * v0.3 — multi-language support
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SourceFile } from './types.js';
import {
  getParser,
  getAllExtensions,
  getLanguageMap,
} from './parsers/index.js';

// Import parser modules to trigger registration
import './parsers/typescript.js';
import './parsers/python.js';
import './parsers/go.js';
import './parsers/rust.js';

const DEFAULT_EXCLUDE = [
  'node_modules',
  'dist',
  'build',
  '.git',
  '__pycache__',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
  'target',         // Rust build output
  'vendor',         // Go vendor
  '.venv',          // Python virtualenv
  'venv',
  '__pypackages__',
];

function shouldExclude(filePath: string, excludePatterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return excludePatterns.some((pattern) => normalized.includes(pattern));
}

/**
 * Recursively discover all source files under `root`.
 * Supports all registered language extensions.
 */
export function discoverFiles(
  root: string,
  include: string[] = [],
  exclude: string[] = DEFAULT_EXCLUDE
): string[] {
  const results: string[] = [];
  const allExclude = [...DEFAULT_EXCLUDE, ...exclude];
  const supportedExtensions = new Set(getAllExtensions());

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // skip unreadable directories
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (shouldExclude(fullPath, allExclude)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExtensions.has(ext)) {
          if (include.length === 0 || include.some((p) => fullPath.includes(p))) {
            results.push(fullPath);
          }
        }
      }
    }
  }

  walk(root);
  return results.sort();
}

/**
 * Parse a single source file by delegating to the appropriate language parser.
 */
export function parseFile(filePath: string): SourceFile {
  const ext = path.extname(filePath).toLowerCase();
  const parser = getParser(ext);

  if (!parser) {
    // Fallback: return empty file with unknown language
    const langMap = getLanguageMap();
    return {
      path: filePath,
      relativePath: '',
      language: langMap[ext] || 'unknown',
      exports: [],
      imports: [],
    };
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const { imports, exports } = parser.parse(content, filePath);

  const langMap = getLanguageMap();

  return {
    path: filePath,
    relativePath: '',
    language: parser.language,
    exports,
    imports,
  };
}

/**
 * Resolve relative imports to absolute file paths.
 *
 * Handles resolution for all supported languages:
 *   - TS/JS: .ts/.tsx/.js/.jsx/.mjs/.cjs + index files
 *   - Python: .py (dot-prefixed imports like from .foo)
 *   - Go: .go
 *   - Rust: .rs + mod.rs convention, crate:: → src/ resolution
 */
export function resolveImport(
  importPath: string,
  fromFile: string
): string | null {
  const ext = path.extname(fromFile).toLowerCase();

  // Route to language-specific resolver
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    return resolveTsImport(importPath, fromFile);
  }

  if (ext === '.py') {
    return resolvePyImport(importPath, fromFile);
  }

  if (ext === '.go') {
    return resolveGoImport(importPath, fromFile);
  }

  if (ext === '.rs') {
    return resolveRsImport(importPath, fromFile);
  }

  return null;
}

// ── TypeScript/JS resolver ───────────────────────────────────────

function resolveTsImport(importPath: string, fromFile: string): string | null {
  if (!importPath.startsWith('.')) {
    return null; // external package
  }

  const dir = path.dirname(fromFile);
  const tsExts = ['.ts', '.tsx'];
  const jsExts = ['.js', '.jsx', '.mjs', '.cjs'];
  const allExts = [...tsExts, ...jsExts];
  const candidates: string[] = [];

  // 1. The exact path
  candidates.push(importPath);

  // 2. If import ends with .js or .jsx, also try .ts/.tsx equivalents
  for (const jsExt of jsExts) {
    if (importPath.endsWith(jsExt)) {
      const base = importPath.slice(0, -jsExt.length);
      for (const tsExt of tsExts) {
        candidates.push(base + tsExt);
      }
      for (const e of allExts) {
        candidates.push(path.join(base, `index${e}`));
      }
    }
  }

  // 3. Extensionless import - try all extensions
  for (const e of allExts) {
    candidates.push(importPath + e);
  }

  // 4. Directory imports - try index files
  for (const e of allExts) {
    candidates.push(path.join(importPath, `index${e}`));
  }

  // 5. If import has an extension, also try stripping it and treating as dir
  const ext = path.extname(importPath);
  if (ext && allExts.includes(ext)) {
    const base = importPath.slice(0, -ext.length);
    for (const e of allExts) {
      candidates.push(path.join(base, `index${e}`));
    }
  }

  return tryCandidates(candidates, dir);
}

// ── Python resolver ──────────────────────────────────────────────

function resolvePyImport(importPath: string, fromFile: string): string | null {
  // Python relative imports: from .module import x, from ..parent import x
  if (importPath.startsWith('.')) {
    // Count dots for parent traversal
    let dots = 0;
    while (importPath[dots] === '.') dots++;

    const modulePart = importPath.slice(dots);
    let dir = path.dirname(fromFile);

    // Go up for each extra dot beyond the first
    for (let i = 1; i < dots; i++) {
      dir = path.dirname(dir);
    }

    const modulePath = modulePart.replace(/\./g, '/');
    const candidates = [
      modulePath + '.py',
      path.join(modulePath, '__init__.py'),
    ];

    return tryCandidates(candidates, dir);
  }

  // Absolute import: from pkg.sub import thing
  // Try resolving as relative to project root (best effort)
  return null;
}

// ── Go resolver ──────────────────────────────────────────────────

function resolveGoImport(importPath: string, fromFile: string): string | null {
  if (!importPath.startsWith('.')) {
    return null; // external package
  }

  const dir = path.dirname(fromFile);

  // Try as a file: ./models → ./models.go
  const fileResult = tryCandidates([importPath + '.go'], dir);
  if (fileResult) return fileResult;

  // Try as a package directory: ./models → ./models/*.go (pick first)
  const pkgDir = path.resolve(dir, importPath);
  try {
    if (fs.existsSync(pkgDir) && fs.statSync(pkgDir).isDirectory()) {
      const entries = fs.readdirSync(pkgDir);
      for (const entry of entries) {
        if (entry.endsWith('.go')) {
          return path.join(pkgDir, entry);
        }
      }
    }
  } catch { /* skip */ }

  return null;
}

// ── Rust resolver ────────────────────────────────────────────────

function resolveRsImport(importPath: string, fromFile: string): string | null {
  const dir = path.dirname(fromFile);

  // crate::foo::bar → src/foo/bar.rs or src/foo/bar/mod.rs
  if (importPath.startsWith('crate::')) {
    // Find the project root (directory containing Cargo.toml or src/)
    const projectRoot = findRustProjectRoot(fromFile);
    if (!projectRoot) return null;

    const modulePath = importPath
      .replace('crate::', '')
      .replace(/::/g, '/');
    const candidates = [
      path.join(projectRoot, 'src', modulePath + '.rs'),
      path.join(projectRoot, 'src', modulePath, 'mod.rs'),
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch { /* skip */ }
    }
    return null;
  }

  // super::foo → ../foo.rs or ../foo/mod.rs
  if (importPath.startsWith('super::')) {
    const parentDir = path.dirname(dir);
    const modulePath = importPath.replace('super::', '').replace(/::/g, '/');
    const candidates = [
      path.join(parentDir, modulePath + '.rs'),
      path.join(parentDir, modulePath, 'mod.rs'),
    ];
    return tryCandidates(candidates, '.');
  }

  // self::foo → ./foo.rs
  if (importPath.startsWith('self::')) {
    const modulePath = importPath.replace('self::', '').replace(/::/g, '/');
    const candidates = [
      path.join(dir, modulePath + '.rs'),
      path.join(dir, modulePath, 'mod.rs'),
    ];
    return tryCandidates(candidates, '.');
  }

  // External crate (std::, regex::, etc.)
  return null;
}

function findRustProjectRoot(fromFile: string): string | null {
  let dir = path.dirname(fromFile);
  for (let i = 0; i < 10; i++) {
    try {
      const cargoPath = path.join(dir, 'Cargo.toml');
      if (fs.existsSync(cargoPath)) return dir;
      const srcPath = path.join(dir, 'src');
      if (fs.existsSync(srcPath)) return dir;
    } catch { /* skip */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────

function tryCandidates(candidates: string[], dir: string): string | null {
  for (const candidate of candidates) {
    const resolved = path.resolve(dir, candidate);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Count lines in a file (fast approximation).
 */
export function countLines(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}
