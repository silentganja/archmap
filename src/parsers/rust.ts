/**
 * Rust parser — extracts imports and exports from .rs files.
 *
 * Uses line-based regex parsing. Handles:
 *   - use crate::foo::bar;
 *   - use super::baz;
 *   - use self::qux;
 *   - use std::collections::HashMap;
 *   - Multi-path imports: use foo::{bar, baz};
 *   - Exports: pub fn, pub struct, pub enum, pub trait, pub mod, pub use, etc.
 *
 * Rust visibility: items prefixed with `pub` are exported.
 *
 * v0.3 — multi-language support
 */

import type { ImportSymbol, ExportSymbol } from '../types.js';
import type { LanguageParser } from './index.js';
import { registerParser } from './index.js';

/**
 * Strip Rust comments from a line.
 * Handles // line comments. Block comments are handled separately.
 */
function stripComment(line: string): string {
  // Strip // comments (outside strings)
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') inString = !inString;
    else if (ch === '/' && line[i + 1] === '/' && !inString) {
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

  // Matches: use path::to::item;
  const useRe = /^use\s+(.+);$/;
  // Matches: pub (fn|struct|enum|trait|mod|use|type|static|const) Name
  const pubFnRe = /^pub\s+fn\s+(\w+)/;
  const pubStructRe = /^pub\s+struct\s+(\w+)/;
  const pubEnumRe = /^pub\s+enum\s+(\w+)/;
  const pubTraitRe = /^pub\s+trait\s+(\w+)/;
  const pubModRe = /^pub\s+mod\s+(\w+)/;
  const pubUseRe = /^pub\s+use\s+/;
  const pubTypeRe = /^pub\s+type\s+(\w+)/;
  const pubStaticRe = /^pub\s+static\s+(\w+)/;
  const pubConstRe = /^pub\s+const\s+(\w+)/;

  let inBlockComment = false;

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

    // Check for block comment start (handle same-line close)
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

    // Match: use crate::foo::bar::{Baz, Qux};
    const useMatch = trimmed.match(useRe);
    if (useMatch) {
      const usePath = useMatch[1]!.trim();

      // Expand multi-path: foo::{bar, baz}
      const expandMatch = usePath.match(/^(.+?)::\{([^}]+)\}$/);
      if (expandMatch) {
        const base = expandMatch[1]!;
        const items = expandMatch[2]!.split(',').map((s) => s.trim()).filter(Boolean);
        for (const item of items) {
          imports.push(makeRustImport(`${base}::${item}`, i + 1));
        }
      } else {
        imports.push(makeRustImport(usePath, i + 1));
      }
      continue;
    }

    // Match: pub use ... — re-export
    if (pubUseRe.test(trimmed)) {
      exports.push({
        name: '*',
        kind: 'unknown',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Match: pub fn name
    const fnMatch = trimmed.match(pubFnRe);
    if (fnMatch) {
      exports.push({
        name: fnMatch[1]!,
        kind: 'function',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Match: pub struct Name
    const structMatch = trimmed.match(pubStructRe);
    if (structMatch) {
      exports.push({
        name: structMatch[1]!,
        kind: 'class', // closest analog in our type system
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Match: pub enum Name
    const enumMatch = trimmed.match(pubEnumRe);
    if (enumMatch) {
      exports.push({
        name: enumMatch[1]!,
        kind: 'enum',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Match: pub trait Name
    const traitMatch = trimmed.match(pubTraitRe);
    if (traitMatch) {
      exports.push({
        name: traitMatch[1]!,
        kind: 'interface', // trait ≈ interface
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Match: pub mod name
    const modMatch = trimmed.match(pubModRe);
    if (modMatch) {
      exports.push({
        name: modMatch[1]!,
        kind: 'variable', // module export
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Match: pub type Name
    const typeMatch = trimmed.match(pubTypeRe);
    if (typeMatch) {
      exports.push({
        name: typeMatch[1]!,
        kind: 'type',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Match: pub static Name
    const staticMatch = trimmed.match(pubStaticRe);
    if (staticMatch) {
      exports.push({
        name: staticMatch[1]!,
        kind: 'variable',
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // Match: pub const Name
    const constMatch = trimmed.match(pubConstRe);
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

function makeRustImport(modulePath: string, line: number): ImportSymbol {
  return {
    name: '*',
    modulePath,
    resolvedPath: null,
    isDefault: false,
    isRelative:
      modulePath.startsWith('crate::') ||
      modulePath.startsWith('super::') ||
      modulePath.startsWith('self::'),
    line,
  };
}

const rustParser: LanguageParser = {
  language: 'rust',
  extensions: ['.rs'],
  parse,
};

registerParser(rustParser);
