/**
 * Go parser — extracts imports and exports from .go files.
 *
 * Uses line-based regex parsing. Handles:
 *   - Single imports: import "path"
 *   - Grouped imports: import ( "path1"; "path2" )
 *   - Exports: capitalized func, type, var, const at top level
 *
 * Go export convention: identifiers starting with uppercase are exported.
 *
 * v0.3 — multi-language support
 */

import type { ImportSymbol, ExportSymbol } from '../types.js';
import type { LanguageParser } from './index.js';
import { registerParser } from './index.js';

/**
 * Strip Go comments from a line.
 * Handles // line comments and block comments (simplified).
 */
function stripComment(line: string): string {
  // Strip // comments
  let inString = false;
  let inRune = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') inString = !inString;
    else if (ch === '`') inRune = !inRune;
    else if (ch === '/' && line[i + 1] === '/' && !inString && !inRune) {
      return line.substring(0, i).trimEnd();
    }
  }
  return line;
}

function parse(content: string, _filePath: string): {
  imports: ImportSymbol[];
  exports: ExportSymbol[];
} {
  const imports: ImportSymbol[] = [];
  const exports: ExportSymbol[] = [];
  const lines = content.split('\n');

  let inBlockComment = false;
  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;

    // Handle block comments
    if (inBlockComment) {
      const endIdx = line.indexOf('*/');
      if (endIdx !== -1) {
        line = line.substring(endIdx + 2);
        inBlockComment = false;
      } else {
        continue;
      }
    }

    // Check for block comment start
    const bcStart = line.indexOf('/*');
    if (bcStart !== -1) {
      const bcEnd = line.indexOf('*/', bcStart + 2);
      if (bcEnd !== -1) {
        line = line.substring(0, bcStart) + line.substring(bcEnd + 2);
      } else {
        line = line.substring(0, bcStart);
        inBlockComment = true;
      }
    }

    line = stripComment(line);
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Handle import block start: import (
    if (trimmed === 'import (' || trimmed.startsWith('import (')) {
      inImportBlock = true;

      // Check for inline path on the same line: import ("fmt"
      const inlineMatch = trimmed.match(/import\s*\(\s*"([^"]+)"/);
      if (inlineMatch) {
        imports.push(makeGoImport(inlineMatch[1]!, i + 1));
      }
      continue;
    }

    // Handle import block end
    if (inImportBlock && trimmed === ')') {
      inImportBlock = false;
      continue;
    }

    // Handle path inside import block
    if (inImportBlock) {
      const pathMatch = trimmed.match(/"([^"]+)"/);
      if (pathMatch) {
        imports.push(makeGoImport(pathMatch[1]!, i + 1));
      }
      continue;
    }

    // Single-line import: import "path"
    const singleImportMatch = trimmed.match(/^import\s+"([^"]+)"/);
    if (singleImportMatch) {
      imports.push(makeGoImport(singleImportMatch[1]!, i + 1));
      continue;
    }

    // Exports: capitalized identifiers at top level (not indented)
    // func Name(
    const funcMatch = trimmed.match(/^func\s+([A-Z]\w*)\s*[<(]/);
    if (funcMatch) {
      exports.push({
        name: funcMatch[1]!,
        kind: 'function',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // type Name struct/interface/...
    const typeMatch = trimmed.match(/^type\s+([A-Z]\w*)\s/);
    if (typeMatch) {
      exports.push({
        name: typeMatch[1]!,
        kind: 'type',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // var Name ...
    const varMatch = trimmed.match(/^var\s+([A-Z]\w*)\s/);
    if (varMatch) {
      exports.push({
        name: varMatch[1]!,
        kind: 'variable',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // const Name ...
    const constMatch = trimmed.match(/^const\s+([A-Z]\w*)\s/);
    if (constMatch) {
      exports.push({
        name: constMatch[1]!,
        kind: 'variable',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }
  }

  return { imports, exports };
}

function makeGoImport(modulePath: string, line: number): ImportSymbol {
  return {
    name: '*',
    modulePath,
    resolvedPath: null,
    isDefault: false,
    isRelative: modulePath.startsWith('.'),
    line,
  };
}

const goParser: LanguageParser = {
  language: 'go',
  extensions: ['.go'],
  parse,
};

registerParser(goParser);
