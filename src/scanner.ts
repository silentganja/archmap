/**
 * Scanner - discovers and parses source files using the TypeScript Compiler API.
 *
 * For v0.1 we handle .ts, .tsx, .js, .jsx, .mjs, .cjs.
 * Future: tree-sitter for .py, .go, .rs, etc.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { SourceFile, ExportSymbol, ImportSymbol } from './types.js';

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

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
];

function shouldExclude(filePath: string, excludePatterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return excludePatterns.some((pattern) => normalized.includes(pattern));
}

/**
 * Recursively discover all source files under `root`.
 */
export function discoverFiles(
  root: string,
  include: string[] = [],
  exclude: string[] = DEFAULT_EXCLUDE
): string[] {
  const results: string[] = [];
  const allExclude = [...DEFAULT_EXCLUDE, ...exclude];

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
        if (SUPPORTED_EXTENSIONS.has(ext)) {
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
 * Parse a single source file and extract imports/exports.
 */
export function parseFile(filePath: string): SourceFile {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true
  );

  const imports: ImportSymbol[] = [];
  const exports: ExportSymbol[] = [];

  // Walk the AST
  function visit(node: ts.Node): void {
    // ── Import declarations ──────────────────────────────
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const modulePath = moduleSpecifier.text;
        const importClause = node.importClause;

        if (importClause) {
          // Default import
          if (importClause.name) {
            imports.push({
              name: importClause.name.text,
              modulePath,
              resolvedPath: null, // resolved later
              isDefault: true,
              isRelative: modulePath.startsWith('.'),
              line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
            });
          }

          // Named imports
          if (importClause.namedBindings) {
            if (ts.isNamedImports(importClause.namedBindings)) {
              for (const element of importClause.namedBindings.elements) {
                imports.push({
                  name: element.name.text,
                  modulePath,
                  resolvedPath: null,
                  isDefault: false,
                  isRelative: modulePath.startsWith('.'),
                  line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
                });
              }
            } else if (ts.isNamespaceImport(importClause.namedBindings)) {
              imports.push({
                name: importClause.namedBindings.name.text,
                modulePath,
                resolvedPath: null,
                isDefault: false,
                isRelative: modulePath.startsWith('.'),
                line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
              });
            }
          }
        } else {
          // Side-effect import: import './foo'
          imports.push({
            name: '*',
            modulePath,
            resolvedPath: null,
            isDefault: false,
            isRelative: modulePath.startsWith('.'),
            line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
          });
        }
      }
    }

    // ── Export declarations ──────────────────────────────
    if (ts.isExportDeclaration(node)) {
      // export { x } from './foo' - re-exports
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          exports.push({
            name: element.name.text,
            kind: 'unknown',
            isDefault: false,
            line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
          });
        }
      }
      // export * from './foo' - star re-export
      if (!node.exportClause) {
        exports.push({
          name: '*',
          kind: 'unknown',
          isDefault: false,
          line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
        });
      }
    }

    // ── Named exports (function, class, variable) ────────
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isVariableStatement(node)) &&
      hasExportModifier(node)
    ) {
      // export function foo() {}
      if (ts.isFunctionDeclaration(node) && node.name) {
        exports.push({
          name: node.name.text,
          kind: 'function',
          isDefault: false,
          line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
        });
      }
      // export class Foo {}
      if (ts.isClassDeclaration(node) && node.name) {
        exports.push({
          name: node.name.text,
          kind: 'class',
          isDefault: false,
          line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
        });
      }
      // export const x = ...
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            exports.push({
              name: decl.name.text,
              kind: 'variable',
              isDefault: false,
              line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
            });
          }
        }
      }
    }

    // ── Export default ──────────────────────────────────
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      exports.push({
        name: 'default',
        kind: 'unknown',
        isDefault: true,
        line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
      });
    }

    // ── Type/Interface exports ──────────────────────────
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      hasExportModifier(node)
    ) {
      exports.push({
        name: node.name.text,
        kind: ts.isInterfaceDeclaration(node) ? 'interface' : 'type',
        isDefault: false,
        line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
      });
    }

    // ── Enum exports ────────────────────────────────────
    if (ts.isEnumDeclaration(node) && hasExportModifier(node)) {
      exports.push({
        name: node.name.text,
        kind: 'enum',
        isDefault: false,
        line: ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
  };

  return {
    path: filePath,
    relativePath: '', // set by caller
    language: langMap[ext] || 'unknown',
    exports,
    imports,
  };
}

/**
 * Check if a node has the `export` keyword modifier.
 */
function hasExportModifier(
  node: ts.Node
): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  if (!modifiers) return false;
  return modifiers.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );
}

/**
 * Resolve relative imports to absolute file paths.
 */
export function resolveImport(
  importPath: string,
  fromFile: string
): string | null {
  if (!importPath.startsWith('.')) {
    // External package - skip for now
    return null;
  }

  const dir = path.dirname(fromFile);

  // Build candidates: try the path as-is, with extensions swapped,
  // and with extensions appended. This handles all TS/JS module
  // resolution styles (NodeNext .js→.ts, extensionless, etc.)
  const candidates: string[] = [];

  // 1. The exact path (works if import already has correct extension)
  candidates.push(importPath);

  // 2. If import ends with .js or .jsx, also try .ts/.tsx equivalents
  //    (TypeScript NodeNext resolution: imports say .js but files are .ts)
  const jsExts = ['.js', '.jsx', '.mjs', '.cjs'];
  const tsExts = ['.ts', '.tsx'];
  for (const jsExt of jsExts) {
    if (importPath.endsWith(jsExt)) {
      const base = importPath.slice(0, -jsExt.length);
      // Try matching .ts file (e.g., import './foo.js' → './foo.ts')
      for (const tsExt of tsExts) {
        candidates.push(base + tsExt);
      }
      // Also try the base as a directory with index files
      for (const ext of [...tsExts, ...jsExts]) {
        candidates.push(path.join(base, `index${ext}`));
      }
    }
  }

  // 3. Extensionless import - try all extensions
  for (const ext of [...tsExts, ...jsExts]) {
    candidates.push(importPath + ext);
  }

  // 4. Directory imports - try index files
  for (const ext of [...tsExts, ...jsExts]) {
    candidates.push(path.join(importPath, `index${ext}`));
  }

  // 5. If import has an extension, also try stripping it and treating as dir
  const ext = path.extname(importPath);
  if (ext && [...tsExts, ...jsExts].includes(ext)) {
    const base = importPath.slice(0, -ext.length);
    // Already tried as base + other extensions above via loop
    // Just treat base as directory
    for (const e of [...tsExts, ...jsExts]) {
      candidates.push(path.join(base, `index${e}`));
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const resolved = path.resolve(dir, candidate);
    try {
      if (fs.existsSync(resolved)) {
        const stat = fs.statSync(resolved);
        if (stat.isFile()) return resolved;
      }
    } catch {
      // permission errors, broken symlinks, etc.
    }
  }

  return null;
}

/**
 * Count lines in a file (fast approximation).
 */
export function countLines(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').length;
}
