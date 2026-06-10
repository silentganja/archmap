/**
 * Python parser — extracts imports and exports from .py files.
 *
 * Uses line-based regex parsing. Handles:
 *   - import x, import x as y
 *   - from .module import name, from pkg.mod import a, b
 *   - Multi-line imports (parenthesized)
 *   - Top-level def and class as exports
 *
 * v0.3 — multi-language support
 */

import type { ImportSymbol, ExportSymbol } from '../types.js';
import type { LanguageParser } from './index.js';
import { registerParser } from './index.js';

/**
 * Strip Python comments from a line.
 * Handles # inside strings conservatively — only strips # outside quotes.
 */
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble && line[i - 1] !== '\\') inSingle = !inSingle;
    else if (ch === '"' && !inSingle && line[i - 1] !== '\\') inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      return line.substring(0, i).trimEnd();
    }
  }
  return line;
}

/**
 * Parse parenthesized multi-line import statements.
 * Given lines starting from an "import" or "from" line, collects
 * until the matching close paren is found.
 */
function collectParenLines(
  lines: string[],
  startIdx: number
): { text: string; endIdx: number } {
  let depth = 0;
  let started = false;
  let text = '';

  for (let i = startIdx; i < lines.length; i++) {
    const line = stripComment(lines[i]!);
    for (const ch of line) {
      if (ch === '(') { depth++; started = true; }
      else if (ch === ')') { depth--; }
    }
    text += line + ' ';
    if (started && depth === 0) {
      return { text: text.trim(), endIdx: i };
    }
  }

  return { text: text.trim(), endIdx: startIdx };
}

function parse(content: string, _filePath: string): {
  imports: ImportSymbol[];
  exports: ExportSymbol[];
} {
  const imports: ImportSymbol[] = [];
  const exports: ExportSymbol[] = [];
  const lines = content.split('\n');

  // Regex patterns
  const importRe = /^import\s+(.+)$/;
  const fromImportRe = /^from\s+(\S+)\s+import\s+(.+)$/;
  const defRe = /^def\s+(\w+)\s*\(/;
  const classRe = /^class\s+(\w+)\s*[(:]/;

  for (let i = 0; i < lines.length; i++) {
    let line = stripComment(lines[i]!);
    const trimmed = line.trim();

    if (!trimmed) continue;

    // Handle multi-line parenthesized imports
    if ((trimmed.startsWith('import ') || trimmed.startsWith('from ')) && trimmed.includes('(')) {
      const { text, endIdx } = collectParenLines(lines, i);
      line = text;
      i = endIdx;
    }

    // Match: import module1, module2
    const importMatch = line.match(importRe);
    if (importMatch) {
      const modules = importMatch[1]!.split(',').map((s) => s.trim());
      for (const mod of modules) {
        // Handle "module as alias"
        const parts = mod.split(/\s+as\s+/);
        const modulePath = parts[0]!.trim();
        imports.push({
          name: '*',
          modulePath,
          resolvedPath: null,
          isDefault: false,
          isRelative: modulePath.startsWith('.'),
          line: i + 1,
        });
      }
      continue;
    }

    // Match: from module import name1, name2
    const fromMatch = line.match(fromImportRe);
    if (fromMatch) {
      const modulePath = fromMatch[1]!.trim();
      const namesStr = fromMatch[2]!;
      // Handle "from module import (name1, name2)" — already normalized above
      const names = namesStr
        .replace(/[()]/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      for (const name of names) {
        // Handle "name as alias"
        const parts = name.split(/\s+as\s+/);
        imports.push({
          name: parts[0]!.trim(),
          modulePath,
          resolvedPath: null,
          isDefault: false,
          isRelative: modulePath.startsWith('.'),
          line: i + 1,
        });
      }
      continue;
    }

    // Match: def function_name(
    const defMatch = trimmed.match(defRe);
    if (defMatch) {
      exports.push({
        name: defMatch[1]!,
        kind: 'function',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Match: class ClassName
    const classMatch = trimmed.match(classRe);
    if (classMatch) {
      exports.push({
        name: classMatch[1]!,
        kind: 'class',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }
  }

  return { imports, exports };
}

const pythonParser: LanguageParser = {
  language: 'python',
  extensions: ['.py'],
  parse,
};

registerParser(pythonParser);
