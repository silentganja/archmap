/**
 * TypeScript/JavaScript parser — uses the TypeScript Compiler API
 * to extract imports and exports from .ts, .tsx, .js, .jsx, .mjs, .cjs files.
 *
 * Extracted from scanner.ts as part of the multi-language refactor (v0.3).
 */

import * as ts from 'typescript';
import type { ImportSymbol, ExportSymbol } from '../types.js';
import type { LanguageParser } from './index.js';
import { registerParser } from './index.js';

const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/**
 * Parse a TypeScript/JavaScript source file and extract imports and exports.
 */
function parse(content: string, _filePath: string): {
  imports: ImportSymbol[];
  exports: ExportSymbol[];
} {
  const sourceFile = ts.createSourceFile(
    _filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true
  );

  const imports: ImportSymbol[] = [];
  const exports: ExportSymbol[] = [];

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

  return { imports, exports };
}

/**
 * Check if a node has the `export` keyword modifier.
 */
function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  if (!modifiers) return false;
  return modifiers.some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );
}

// ── Parser registration ──────────────────────────────────────────

const typescriptParser: LanguageParser = {
  language: 'typescript',
  extensions: ['.ts', '.tsx'],
  parse,
};

const javascriptParser: LanguageParser = {
  language: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  parse,
};

registerParser(typescriptParser);
registerParser(javascriptParser);
