/**
 * Parser registry — maps file extensions to language parsers.
 *
 * Each parser implements the LanguageParser interface for
 * extracting imports and exports from source files.
 */

import type { ImportSymbol, ExportSymbol } from '../types.js';

export interface LanguageParser {
  /** Human-readable language name (e.g., "typescript", "python") */
  readonly language: string;
  /** File extensions this parser handles (including dot prefix) */
  readonly extensions: readonly string[];
  /** Parse source content and extract imports + exports */
  parse(content: string, filePath: string): {
    imports: ImportSymbol[];
    exports: ExportSymbol[];
  };
}

/**
 * Registry: maps lowercase file extension → parser instance.
 * Populated by each parser module via registerParser().
 */
const registry = new Map<string, LanguageParser>();

/**
 * Register a parser for one or more file extensions.
 */
export function registerParser(
  parser: LanguageParser
): void {
  for (const ext of parser.extensions) {
    registry.set(ext.toLowerCase(), parser);
  }
}

/**
 * Look up the parser for a given file extension.
 * Returns undefined if no parser is registered.
 */
export function getParser(ext: string): LanguageParser | undefined {
  return registry.get(ext.toLowerCase());
}

/**
 * Get all registered file extensions (for file discovery).
 */
export function getAllExtensions(): string[] {
  return Array.from(registry.keys());
}

/**
 * Build a lookup map from extension to language name.
 */
export function getLanguageMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [ext, parser] of registry) {
    map[ext] = parser.language;
  }
  return map;
}

/**
 * Get all registered parsers (for iteration / debugging).
 */
export function getAllParsers(): LanguageParser[] {
  return Array.from(new Set(registry.values()));
}
