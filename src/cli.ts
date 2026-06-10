/**
 * CLI - command-line interface using Commander.
 *
 * Usage:
 *   npx archmap [directory]          # Analyze project
 *   npx archmap --json [directory]   # Machine-readable output
 *   npx archmap --include 'src/**'   # Only analyze matching files
 *   npx archmap --exclude 'test'     # Exclude patterns
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { discoverFiles, parseFile, resolveImport, countLines } from './scanner.js';
import { buildGraph, detectCommunities, detectSprawl } from './graph.js';
import {
  findBoundaryViolations,
  generateSuggestions,
  buildFolderTree,
} from './analysis.js';
import { analyzeGitHistory } from './git-analysis.js';
import { render, renderJson } from './output.js';
import type { ArchMapOptions, ArchMapResult } from './types.js';

export async function runCli(): Promise<void> {
  const program = new Command();

  program
    .name('archmap')
    .description(
      'Discover the architecture your code actually has - not the one you think it has.'
    )
    .version('0.3.0')
    .argument('[directory]', 'Directory to analyze', '.')
    .option('-i, --include <patterns...>', 'File patterns to include')
    .option('-e, --exclude <patterns...>', 'File patterns to exclude')
    .option('--git', 'Enable git co-change analysis', false)
    .option('--json', 'Output as JSON', false)
    .option('-v, --verbose', 'Verbose output', false)
    .action(async (directory: string, options: any) => {
      const root = path.resolve(directory || '.');

      const opts: ArchMapOptions = {
        root,
        include: options.include || [],
        exclude: options.exclude || [],
        format: options.json ? 'json' : 'terminal',
        gitAnalysis: options.git || false,
        verbose: options.verbose || false,
      };

      await run(opts);
    });

  await program.parseAsync(process.argv);
}

export async function run(opts: ArchMapOptions): Promise<ArchMapResult> {
  const startTime = Date.now();

  // ── Phase 1: Discover files ────────────────────────
  if (opts.verbose) {
    console.error(chalk.dim('  Scanning files...'));
  }

  const filePaths = discoverFiles(opts.root, opts.include, opts.exclude);

  if (filePaths.length === 0) {
    console.error(chalk.red('No source files found in'), chalk.yellow(opts.root));
    process.exit(1);
  }

  // ── Phase 2: Parse files ──────────────────────────
  if (opts.verbose) {
    console.error(chalk.dim(`  Parsing ${filePaths.length} files...`));
  }

  const sources = filePaths.map((fp) => {
    const file = parseFile(fp);
    file.relativePath = path.relative(opts.root, fp);
    // Resolve imports
    for (const imp of file.imports) {
      imp.resolvedPath = resolveImport(imp.modulePath, fp);
    }
    return file;
  });

  // Update line counts
  for (const file of sources) {
    const node = file; // we'll pass to graph builder
  }

  // ── Phase 3: Build dependency graph ───────────────
  if (opts.verbose) {
    console.error(chalk.dim('  Building dependency graph...'));
  }

  const graph = buildGraph(sources);

  // Update line counts (lazy - only compute when needed)
  for (const node of graph.nodes.values()) {
    if (node.lineCount === 0) {
      try {
        node.lineCount = countLines(node.path);
      } catch {
        node.lineCount = 0;
      }
    }
  }

  // ── Phase 4: Community detection ──────────────────
  if (opts.verbose) {
    console.error(chalk.dim('  Detecting module boundaries...'));
  }

  const { moduleIds, modules } = detectCommunities(graph);

  // ── Phase 4.5: Git co-change analysis ─────────────
  let coChangeReport = null;
  if (opts.gitAnalysis) {
    if (opts.verbose) {
      console.error(chalk.dim('  Analyzing git history for co-change patterns...'));
    }
    coChangeReport = analyzeGitHistory(filePaths, opts.root, moduleIds);
    if (coChangeReport && opts.verbose) {
      console.error(
        chalk.dim(
          `  Analyzed ${coChangeReport.commitsAnalyzed} commits, found ${coChangeReport.pairs.length} co-change pairs`
        )
      );
    }
  }

  // ── Phase 5: Analysis ─────────────────────────────
  if (opts.verbose) {
    console.error(chalk.dim('  Analyzing boundaries...'));
  }

  const sprawlingFiles = detectSprawl(graph, moduleIds);
  const folderStructure = buildFolderTree(filePaths, opts.root);
  const boundaryViolations = findBoundaryViolations(graph, modules, moduleIds);
  const restructureSuggestions = generateSuggestions(
    modules,
    folderStructure,
    graph,
    coChangeReport
  );

  // ── Phase 6: Build result ─────────────────────────
  const languages = new Set(sources.map((s) => s.language));

  const result: ArchMapResult = {
    root: opts.root,
    fileCount: sources.length,
    edgeCount: graph.edges.length,
    languagesDetected: Array.from(languages),
    coChange: coChangeReport,
    discoveredModules: modules,
    sprawlingFiles,
    folderStructure,
    boundaryViolations,
    restructureSuggestions,
    graph,
  };

  // ── Phase 7: Output ───────────────────────────────
  if (opts.format === 'json') {
    console.log(renderJson(result));
  } else {
    console.log(render(result, opts.root));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (opts.verbose) {
    console.error(chalk.dim(`\n  Completed in ${elapsed}s`));
  }

  return result;
}
