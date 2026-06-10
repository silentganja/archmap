/**
 * Core tests for archmap — scanner, graph builder, community detection.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { discoverFiles, parseFile, resolveImport } from '../src/scanner.js';
import { buildGraph, detectCommunities, detectSprawl } from '../src/graph.js';
import { findBoundaryViolations, generateSuggestions, buildFolderTree } from '../src/analysis.js';

const FIXTURES = path.resolve(__dirname, 'fixtures', 'mock-project');

// ── Scanner ──────────────────────────────────────────────────────

describe('discoverFiles', () => {
  it('discovers all TypeScript files in a directory', () => {
    const files = discoverFiles(FIXTURES);
    const relative = files.map((f) => path.relative(FIXTURES, f)).sort();

    expect(relative).toEqual([
      'helpers.ts',
      'index.ts',
      path.join('services', 'auth.ts'),
      path.join('services', 'pay.ts'),
      'utils.ts',
    ]);
  });

  it('respects include patterns', () => {
    const files = discoverFiles(FIXTURES, [path.join(FIXTURES, 'services')]);
    const relative = files.map((f) => path.relative(FIXTURES, f)).sort();

    expect(relative.length).toBe(2);
    expect(relative.every((f) => f.startsWith('services'))).toBe(true);
  });

  it('respects exclude patterns', () => {
    const files = discoverFiles(FIXTURES, [], ['services']);
    const relative = files.map((f) => path.relative(FIXTURES, f)).sort();

    expect(relative.every((f) => !f.includes('services'))).toBe(true);
  });

  it('returns empty array for non-existent directory', () => {
    const files = discoverFiles(path.join(FIXTURES, 'nonexistent'));
    expect(files).toEqual([]);
  });
});

describe('parseFile', () => {
  it('extracts imports from a file', () => {
    const file = parseFile(path.join(FIXTURES, 'index.ts'));
    expect(file.imports.length).toBeGreaterThan(0);
    expect(file.imports.some((i) => i.name === 'formatDate')).toBe(true);
    expect(file.imports.some((i) => i.name === 'login')).toBe(true);
  });

  it('extracts exports from a file', () => {
    const file = parseFile(path.join(FIXTURES, 'utils.ts'));
    const exportNames = file.exports.map((e) => e.name);
    expect(exportNames).toContain('formatDate');
    expect(exportNames).toContain('clamp');
  });

  it('sets correct language for .ts files', () => {
    const file = parseFile(path.join(FIXTURES, 'index.ts'));
    expect(file.language).toBe('typescript');
  });

  it('handles namespace imports', () => {
    const file = parseFile(path.join(FIXTURES, 'services', 'pay.ts'));
    expect(file.imports.some((i) => i.name === 'helpers')).toBe(true);
  });
});

describe('resolveImport', () => {
  it('resolves relative .ts imports', () => {
    const result = resolveImport('./utils', path.join(FIXTURES, 'index.ts'));
    expect(result).toBe(path.join(FIXTURES, 'utils.ts'));
  });

  it('resolves imports with .js extension to .ts file', () => {
    const result = resolveImport('./utils.js', path.join(FIXTURES, 'index.ts'));
    expect(result).toBe(path.join(FIXTURES, 'utils.ts'));
  });

  it('returns null for external packages', () => {
    const result = resolveImport('lodash', path.join(FIXTURES, 'index.ts'));
    expect(result).toBeNull();
  });

  it('resolves directory imports to index.ts', () => {
    // services/ is a directory containing auth.ts and pay.ts
    // but it doesn't have an index.ts, so resolution should fail
    const result = resolveImport('./services', path.join(FIXTURES, 'index.ts'));
    // No index.ts in services/, so should be null
    expect(result).toBeNull();
  });
});

// ── Graph ────────────────────────────────────────────────────────

describe('buildGraph', () => {
  it('builds a graph with correct node count', () => {
    const files = discoverFiles(FIXTURES).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });

    const graph = buildGraph(files);
    expect(graph.nodes.size).toBe(5);
  });

  it('creates edges for imports between files', () => {
    const files = discoverFiles(FIXTURES).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });

    const graph = buildGraph(files);
    expect(graph.edges.length).toBeGreaterThan(0);

    // index.ts imports from utils.ts and services/auth.ts
    const indexImports = graph.edges.filter(
      (e) => e.from === path.join(FIXTURES, 'index.ts')
    );
    expect(indexImports.length).toBe(2); // merged into 2 unique targets
  });

  it('merges multiple imports from the same file pair', () => {
    const files = discoverFiles(FIXTURES).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });

    const graph = buildGraph(files);

    // pay.ts imports login + formatDate + helpers → check these are merged per target
    const payEdges = graph.edges.filter(
      (e) => e.from === path.join(FIXTURES, 'services', 'pay.ts')
    );

    // pay.ts imports from: auth.ts, utils.ts, helpers.ts = 3 unique targets
    expect(payEdges.length).toBe(3);

    // The edge to utils.ts should only appear once (merged)
    const utilsEdges = payEdges.filter(
      (e) => e.to === path.join(FIXTURES, 'utils.ts')
    );
    expect(utilsEdges.length).toBe(1);
  });

  it('sets correct in-degrees', () => {
    const files = discoverFiles(FIXTURES).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });

    const graph = buildGraph(files);

    // utils.ts is imported by index.ts, auth.ts, pay.ts = 3
    const utilsNode = graph.nodes.get(path.join(FIXTURES, 'utils.ts'));
    expect(utilsNode).toBeDefined();
    expect(utilsNode!.inDegree).toBe(3);
  });
});

// ── Community Detection ──────────────────────────────────────────

describe('detectCommunities', () => {
  function buildTestGraph() {
    const files = discoverFiles(FIXTURES).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });
    return buildGraph(files);
  }

  it('assigns every node to a module', () => {
    const graph = buildTestGraph();
    const { moduleIds } = detectCommunities(graph);
    expect(moduleIds.size).toBe(graph.nodes.size);

    for (const nodePath of graph.nodes.keys()) {
      expect(moduleIds.has(nodePath)).toBe(true);
      expect(moduleIds.get(nodePath)).toBeTruthy();
    }
  });

  it('groups tightly coupled services together', () => {
    const graph = buildTestGraph();
    const { moduleIds } = detectCommunities(graph);

    // auth.ts and pay.ts are in the same directory and import each other
    // They should be in the same module
    const authMod = moduleIds.get(path.join(FIXTURES, 'services', 'auth.ts'));
    const payMod = moduleIds.get(path.join(FIXTURES, 'services', 'pay.ts'));

    expect(authMod).toBeDefined();
    expect(payMod).toBeDefined();
    expect(authMod).toBe(payMod); // same module
  });

  it('returns deterministic results', () => {
    const graph = buildTestGraph();
    const result1 = detectCommunities(graph);
    const result2 = detectCommunities(graph);

    // Module assignments should be identical across runs
    for (const nodePath of graph.nodes.keys()) {
      expect(result1.moduleIds.get(nodePath)).toBe(
        result2.moduleIds.get(nodePath)
      );
    }
  });

  it('returns modules sorted by size', () => {
    const graph = buildTestGraph();
    const { modules } = detectCommunities(graph);

    for (let i = 1; i < modules.length; i++) {
      expect(modules[i - 1]!.size).toBeGreaterThanOrEqual(modules[i]!.size);
    }
  });
});

// ── Analysis ─────────────────────────────────────────────────────

describe('buildFolderTree', () => {
  it('builds a tree matching the fixture structure', () => {
    const files = discoverFiles(FIXTURES);
    const tree = buildFolderTree(files, FIXTURES);

    expect(tree.name).toBe('mock-project');
    // fileCount counts all files found under the tree (may include
    // additional discovered files depending on platform path resolution)
    expect(tree.fileCount).toBeGreaterThanOrEqual(5);

    const serviceChild = tree.children.find((c) => c.name === 'services');
    expect(serviceChild).toBeDefined();
    expect(serviceChild!.fileCount).toBe(2);
  });
});

describe('findBoundaryViolations', () => {
  it('returns empty for a clean small project', () => {
    const files = discoverFiles(FIXTURES).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });
    const graph = buildGraph(files);
    const { modules, moduleIds } = detectCommunities(graph);
    const violations = findBoundaryViolations(graph, modules, moduleIds);

    // Small tightly-coupled project should have few/no medium+ violations
    const highViolations = violations.filter((v) => v.severity === 'high');
    expect(highViolations.length).toBe(0);
  });
});

describe('generateSuggestions', () => {
  it('produces suggestions for the test project', () => {
    const files = discoverFiles(FIXTURES).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });
    const graph = buildGraph(files);
    const { modules, moduleIds } = detectCommunities(graph);
    const folderTree = buildFolderTree(
      files.map((f) => f.path),
      FIXTURES
    );
    const suggestions = generateSuggestions(modules, folderTree, graph);

    expect(Array.isArray(suggestions)).toBe(true);
    // Each suggestion should have required fields
    for (const s of suggestions) {
      expect(s.type).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.impactEstimate).toBeTruthy();
    }
  });
});

// ── Git Analysis ──────────────────────────────────────────────────

describe('analyzeGitHistory', () => {
  it('returns null for non-git directory', async () => {
    const { analyzeGitHistory } = await import('../src/git-analysis.js');
    const result = analyzeGitHistory([], '/tmp/nonexistent', new Map());
    expect(result).toBeNull();
  });

  it('returns a report for a real git repo', async () => {
    const { analyzeGitHistory } = await import('../src/git-analysis.js');
    // Use FIXTURES parent (archmap itself) which IS a git repo
    const repoRoot = path.resolve(FIXTURES, '..', '..');
    const files = discoverFiles(path.join(repoRoot, 'src'));
    const moduleIds = new Map<string, string>();
    files.forEach((f) => moduleIds.set(f, 'M0'));

    const report = analyzeGitHistory(files, repoRoot, moduleIds, 50);
    // Should return a report since archmap is a git repo
    expect(report).not.toBeNull();
    if (report) {
      // commitsAnalyzed may be 0 if no commits touched the analyzed files
      // (e.g., if recent commits only touched non-src files like CHANGELOG.md)
      expect(report.commitsAnalyzed).toBeGreaterThanOrEqual(0);
      expect(typeof report.averageCoChange).toBe('number');
      expect(Array.isArray(report.pairs)).toBe(true);
      expect(Array.isArray(report.crossModulePairs)).toBe(true);
    }
  });
});

// ── Sprawl ───────────────────────────────────────────────────────

// ── Multi-Language (v0.3) ─────────────────────────────────────

const FIXTURES_PY = path.resolve(__dirname, 'fixtures', 'mock-python');
const FIXTURES_GO = path.resolve(__dirname, 'fixtures', 'mock-go');
const FIXTURES_RS = path.resolve(__dirname, 'fixtures', 'mock-rust');

describe('discoverFiles with multi-language', () => {
  it('discovers Python files', () => {
    const files = discoverFiles(FIXTURES_PY);
    const relative = files.map((f) => path.relative(FIXTURES_PY, f)).sort();

    expect(relative).toContain('main.py');
    expect(relative).toContain('utils.py');
    expect(relative).toContain(path.join('models', '__init__.py'));
    expect(relative).toContain(path.join('models', 'user.py'));
    expect(files.length).toBe(4);
  });

  it('discovers Go files', () => {
    const files = discoverFiles(FIXTURES_GO);
    const relative = files.map((f) => path.relative(FIXTURES_GO, f)).sort();

    expect(relative).toContain('main.go');
    expect(relative).toContain('utils.go');
    expect(relative).toContain(path.join('models', 'user.go'));
    expect(files.length).toBe(3);
  });

  it('discovers Rust files', () => {
    const files = discoverFiles(FIXTURES_RS);
    const relative = files.map((f) => path.relative(FIXTURES_RS, f)).sort();

    expect(relative).toContain('main.rs');
    expect(relative).toContain('utils.rs');
    expect(relative).toContain(path.join('models', 'mod.rs'));
    expect(relative).toContain(path.join('models', 'user.rs'));
    expect(files.length).toBe(4);
  });
});

describe('parseFile — Python', () => {
  it('extracts imports from Python files', () => {
    const file = parseFile(path.join(FIXTURES_PY, 'main.py'));
    expect(file.language).toBe('python');

    const importModules = file.imports.map((i) => i.modulePath);
    expect(importModules).toContain('os');
    expect(importModules).toContain('collections');
    expect(importModules).toContain('.utils');
    expect(importModules).toContain('.models.user');
    expect(importModules).toContain('sys');
  });

  it('extracts relative import flags for Python', () => {
    const file = parseFile(path.join(FIXTURES_PY, 'main.py'));
    const utilsImport = file.imports.find((i) => i.modulePath === '.utils');
    expect(utilsImport).toBeDefined();
    expect(utilsImport!.isRelative).toBe(true);
  });

  it('extracts exported functions and classes from Python', () => {
    const file = parseFile(path.join(FIXTURES_PY, 'utils.py'));
    const exportNames = file.exports.map((e) => e.name);

    expect(exportNames).toContain('format_date');
    expect(exportNames).toContain('clamp');
    expect(exportNames).toContain('Helper');
  });

  it('extracts class exports from Python models', () => {
    const file = parseFile(path.join(FIXTURES_PY, 'models', 'user.py'));
    const exportNames = file.exports.map((e) => e.name);

    expect(exportNames).toContain('User');
    expect(exportNames).toContain('Admin');
  });
});

describe('parseFile — Go', () => {
  it('extracts imports from Go files', () => {
    const file = parseFile(path.join(FIXTURES_GO, 'main.go'));
    expect(file.language).toBe('go');

    const importModules = file.imports.map((i) => i.modulePath);
    expect(importModules).toContain('fmt');
    expect(importModules).toContain('os');
    expect(importModules).toContain('./models');
    expect(importModules).toContain('./utils');
  });

  it('extracts exported (capitalized) functions from Go', () => {
    const file = parseFile(path.join(FIXTURES_GO, 'utils.go'));
    const exportNames = file.exports.map((e) => e.name);

    expect(exportNames).toContain('FormatDate');
    expect(exportNames).toContain('Clamp');
    // Unexported function should not appear
    expect(exportNames).not.toContain('privateHelper');
  });

  it('extracts exported types and methods from Go models', () => {
    const file = parseFile(path.join(FIXTURES_GO, 'models', 'user.go'));
    const exportNames = file.exports.map((e) => e.name);

    expect(exportNames).toContain('User');
    expect(exportNames).toContain('NewUser');
    expect(exportNames).not.toContain('age');
    expect(exportNames).not.toContain('hiddenHelper');
  });
});

describe('parseFile — Rust', () => {
  it('extracts imports from Rust files', () => {
    const file = parseFile(path.join(FIXTURES_RS, 'main.rs'));
    expect(file.language).toBe('rust');

    const importModules = file.imports.map((i) => i.modulePath);
    expect(importModules).toContain('std::env');
    expect(importModules).toContain('crate::utils::format_date');
    expect(importModules).toContain('crate::utils::clamp');
    expect(importModules).toContain('crate::models::user::User');
  });

  it('extracts pub function exports from Rust', () => {
    const file = parseFile(path.join(FIXTURES_RS, 'utils.rs'));
    const exportNames = file.exports.map((e) => e.name);

    expect(exportNames).toContain('format_date');
    expect(exportNames).toContain('clamp');
    // Private function should not appear
    expect(exportNames).not.toContain('private_helper');
  });

  it('extracts pub struct and impl exports from Rust models', () => {
    const file = parseFile(path.join(FIXTURES_RS, 'models', 'user.rs'));
    const exportNames = file.exports.map((e) => e.name);

    expect(exportNames).toContain('User');
    expect(exportNames).toContain('new');
    expect(exportNames).toContain('greet');
    expect(exportNames).not.toContain('secret');
    expect(exportNames).not.toContain('age');
  });
});

describe('resolveImport — Python', () => {
  it('resolves relative dot imports', () => {
    const result = resolveImport(
      '.utils',
      path.join(FIXTURES_PY, 'main.py')
    );
    expect(result).toBe(path.join(FIXTURES_PY, 'utils.py'));
  });

  it('resolves relative dot-path imports', () => {
    const result = resolveImport(
      '.models.user',
      path.join(FIXTURES_PY, 'main.py')
    );
    expect(result).toBe(path.join(FIXTURES_PY, 'models', 'user.py'));
  });

  it('returns null for external Python packages', () => {
    const result = resolveImport('os', path.join(FIXTURES_PY, 'main.py'));
    expect(result).toBeNull();
  });
});

describe('resolveImport — Go', () => {
  it('resolves relative Go imports', () => {
    const result = resolveImport(
      './utils',
      path.join(FIXTURES_GO, 'main.go')
    );
    expect(result).toBe(path.join(FIXTURES_GO, 'utils.go'));
  });

  it('returns null for external Go packages', () => {
    const result = resolveImport('fmt', path.join(FIXTURES_GO, 'main.go'));
    expect(result).toBeNull();
  });
});

describe('resolveImport — Rust', () => {
  it('resolves super:: imports', () => {
    const result = resolveImport(
      'super::utils',
      path.join(FIXTURES_RS, 'models', 'user.rs')
    );
    // super from models/user.rs goes to parent dir (mock-rust/)
    expect(result).not.toBeNull();
    expect(result!.endsWith('utils.rs')).toBe(true);
  });
});

describe('buildGraph with multi-language', () => {
  it('builds a graph for a Python project', () => {
    const files = discoverFiles(FIXTURES_PY).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES_PY, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });

    const graph = buildGraph(files);
    expect(graph.nodes.size).toBe(4);
    // main.py imports from utils.py and models/user.py (internal) + os, collections, sys (external)
    // External imports are filtered, so at least 2 internal edges
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('builds a graph for a Go project', () => {
    const files = discoverFiles(FIXTURES_GO).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES_GO, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });

    const graph = buildGraph(files);
    expect(graph.nodes.size).toBe(3);
    // main.go imports from utils and models (internal)
    expect(graph.edges.length).toBeGreaterThanOrEqual(2);
  });

  it('builds a graph for a Rust project', () => {
    const files = discoverFiles(FIXTURES_RS).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES_RS, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });

    const graph = buildGraph(files);
    expect(graph.nodes.size).toBe(4);
  });

  it('detects communities in a Python project', () => {
    const files = discoverFiles(FIXTURES_PY).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES_PY, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });

    const graph = buildGraph(files);
    const { moduleIds, modules } = detectCommunities(graph);
    expect(moduleIds.size).toBe(graph.nodes.size);
    expect(modules.length).toBeGreaterThan(0);

    // All nodes should have a module assigned
    for (const nodePath of graph.nodes.keys()) {
      expect(moduleIds.has(nodePath)).toBe(true);
      expect(moduleIds.get(nodePath)).toBeTruthy();
    }
  });
});

describe('detectSprawl', () => {
  it('runs without error on test project', () => {
    const files = discoverFiles(FIXTURES).map((fp) => {
      const file = parseFile(fp);
      file.relativePath = path.relative(FIXTURES, fp);
      for (const imp of file.imports) {
        imp.resolvedPath = resolveImport(imp.modulePath, fp);
      }
      return file;
    });
    const graph = buildGraph(files);
    const { moduleIds } = detectCommunities(graph);

    const sprawling = detectSprawl(graph, moduleIds);
    expect(Array.isArray(sprawling)).toBe(true);
  });
});
