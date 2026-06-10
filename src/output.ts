/**
 * Terminal output renderer — this is where the magic becomes visible.
 *
 * The output is designed to be screenshot-worthy:
 * - Clean box-drawn diagrams
 * - Color-coded severity indicators
 * - Human-readable module descriptions
 * - Actionable suggestions
 */

import chalk from 'chalk';
import type { ArchMapResult, Module, BoundaryViolation, RestructureSuggestion } from './types.js';
import * as path from 'path';

export function render(result: ArchMapResult, root: string): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(header(result, root));
  lines.push('');
  lines.push(moduleMap(result.discoveredModules, result.graph.nodes.size));
  lines.push('');

  if (result.sprawlingFiles.length > 0) {
    lines.push(sprawlSection(result.sprawlingFiles));
    lines.push('');
  }

  if (result.boundaryViolations.length > 0) {
    lines.push(violationsSection(result.boundaryViolations));
    lines.push('');
  }

  if (result.restructureSuggestions.length > 0) {
    lines.push(suggestionsSection(result.restructureSuggestions));
    lines.push('');
  }

  lines.push(summaryFooter(result));

  return lines.join('\n');
}

function header(result: ArchMapResult, root: string): string {
  const name = path.basename(path.resolve(root));
  const lines: string[] = [];

  lines.push(chalk.bold.cyan('╔══════════════════════════════════════════════════════════════╗'));
  lines.push(chalk.bold.cyan('║') + chalk.bold.white('  ARCHMAP — Architecture Discovery') + chalk.bold.cyan('                          ║'));
  lines.push(chalk.bold.cyan('╠══════════════════════════════════════════════════════════════╣'));

  const projectLine = `  Project: ${chalk.yellow(name)}`;
  const filesLine = `  Files:   ${chalk.white(result.fileCount)} source files`;
  const edgesLine = `  Edges:   ${chalk.white(result.edgeCount)} import relationships`;
  const modulesLine = `  Modules: ${chalk.green(result.discoveredModules.length)} natural modules discovered`;
  const langLine = `  Languages: ${chalk.dim(result.languagesDetected.join(', '))}`;

  lines.push(chalk.bold.cyan('║') + projectLine.padEnd(65) + chalk.bold.cyan('║'));
  lines.push(chalk.bold.cyan('║') + filesLine.padEnd(65) + chalk.bold.cyan('║'));
  lines.push(chalk.bold.cyan('║') + edgesLine.padEnd(65) + chalk.bold.cyan('║'));
  lines.push(chalk.bold.cyan('║') + modulesLine.padEnd(65) + chalk.bold.cyan('║'));
  lines.push(chalk.bold.cyan('║') + langLine.padEnd(65) + chalk.bold.cyan('║'));
  lines.push(chalk.bold.cyan('╚══════════════════════════════════════════════════════════════╝'));

  return lines.join('\n');
}

function moduleMap(modules: Module[], totalFiles: number): string {
  const lines: string[] = [];

  lines.push(chalk.bold.magenta('┌─── DISCOVERED MODULES (by actual coupling, not folder structure) ───┐'));
  lines.push(chalk.bold.magenta('│') + '                                                                    ' + chalk.bold.magenta('│'));

  // Show top modules
  const topModules = modules.slice(0, 8);

  for (const mod of topModules) {
    const percentOfCodebase = ((mod.size / Math.max(totalFiles, 1)) * 100).toFixed(0);
    const cohesionBar = barChart(mod.cohesion, 12);
    const cohesionLabel = mod.cohesion > 0.6
      ? chalk.green('HIGH')
      : mod.cohesion > 0.3
        ? chalk.yellow('MED ')
        : chalk.red('LOW ');

    const nameDisplay = chalk.bold(mod.name || 'Unnamed Module');
    const sizeDisplay = chalk.white(`${mod.size} files`);
    const percentDisplay = chalk.dim(`(${percentOfCodebase}%)`);

    lines.push(
      chalk.bold.magenta('│') +
      `  ${nameDisplay}`.padEnd(48) +
      `${sizeDisplay}  ${cohesionLabel} ${cohesionBar}  ` +
      chalk.bold.magenta('│')
    );
  }

  if (modules.length > 8) {
    lines.push(
      chalk.bold.magenta('│') +
      chalk.dim(`  ... and ${modules.length - 8} more modules`).padEnd(67) +
      chalk.bold.magenta('│')
    );
  }

  lines.push(chalk.bold.magenta('│') + '                                                                    ' + chalk.bold.magenta('│'));
  lines.push(chalk.bold.magenta('└────────────────────────────────────────────────────────────────────┘'));

  return lines.join('\n');
}

function barChart(value: number, width: number): string {
  const filled = Math.round(value * width);
  const empty = width - filled;

  if (value > 0.6) {
    return chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  } else if (value > 0.3) {
    return chalk.yellow('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  } else {
    return chalk.red('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  }
}

function sprawlSection(sprawlingFiles: string[]): string {
  const lines: string[] = [];

  lines.push(chalk.bold.red('┌─── SPRAWL DETECTED ───────────────────────────────────────────────┐'));
  lines.push(
    chalk.bold.red('│') +
    chalk.white(`  ${sprawlingFiles.length} files don't cluster — they're imported by everything:`) +
    ' '.repeat(Math.max(0, 40 - String(sprawlingFiles.length).length)) +
    chalk.bold.red('│')
  );
  lines.push(chalk.bold.red('│') + '                                                                    ' + chalk.bold.red('│'));

  for (const file of sprawlingFiles.slice(0, 6)) {
    const display = file.length > 55 ? '...' + file.slice(-52) : file;
    lines.push(chalk.bold.red('│') + chalk.yellow(`    ${display}`).padEnd(67) + chalk.bold.red('│'));
  }

  if (sprawlingFiles.length > 6) {
    const remaining = sprawlingFiles.length - 6;
    lines.push(
      chalk.bold.red('│') +
      chalk.dim(`    ... and ${remaining} more sprawling files`).padEnd(67) +
      chalk.bold.red('│')
    );
  }

  lines.push(chalk.bold.red('│') + '                                                                    ' + chalk.bold.red('│'));
  lines.push(chalk.bold.red('│') + chalk.dim('  → These files are invisible "utils" folders. Consider:') + '         ' + chalk.bold.red('│'));
  lines.push(chalk.bold.red('│') + chalk.dim('    1. Split large utils into domain-specific modules') + '             ' + chalk.bold.red('│'));
  lines.push(chalk.bold.red('│') + chalk.dim('    2. Move shared code to a dedicated core/ package') + '              ' + chalk.bold.red('│'));
  lines.push(chalk.bold.red('└────────────────────────────────────────────────────────────────────┘'));

  return lines.join('\n');
}

function violationsSection(violations: BoundaryViolation[]): string {
  const lines: string[] = [];

  lines.push(chalk.bold.yellow('┌─── TANGLED MODULE BOUNDARIES ────────────────────────────────────┐'));
  lines.push(chalk.bold.yellow('│') + '                                                                    ' + chalk.bold.yellow('│'));

  for (const v of violations.slice(0, 5)) {
    const sevIcon = v.severity === 'high'
      ? chalk.red('🔴 HIGH  ')
      : chalk.yellow('🟡 MEDIUM');

    lines.push(
      chalk.bold.yellow('│') +
      `  ${sevIcon}  ` +
      chalk.cyan(v.fromModule) +
      chalk.dim(' ↔ ') +
      chalk.cyan(v.toModule) +
      chalk.dim(`  (${v.crossImportCount} cross-imports, ${v.tangledFiles.length} tangled files)`)
    );
  }

  lines.push(chalk.bold.yellow('│') + '                                                                    ' + chalk.bold.yellow('│'));
  lines.push(chalk.bold.yellow('└────────────────────────────────────────────────────────────────────┘'));

  return lines.join('\n');
}

function suggestionsSection(suggestions: RestructureSuggestion[]): string {
  const lines: string[] = [];

  lines.push(chalk.bold.green('┌─── SUGGESTED RESTRUCTURE ────────────────────────────────────────┐'));
  lines.push(chalk.bold.green('│') + '                                                                    ' + chalk.bold.green('│'));

  for (const s of suggestions.slice(0, 5)) {
    const typeIcon: Record<string, string> = {
      'merge': chalk.blue('[MERGE] '),
      'split': chalk.magenta('[SPLIT] '),
      'extract-interface': chalk.cyan('[EXTRACT]'),
      'move': chalk.yellow('[MOVE]  '),
    };

    const prefix = typeIcon[s.type] || '       ';
    const impact = s.impactEstimate === 'high'
      ? chalk.red('⚠ HIGH IMPACT')
      : chalk.yellow('⚡ MEDIUM');

    lines.push(chalk.bold.green('│') + `  ${prefix} ${s.description.slice(0, 55)}`);
    lines.push(chalk.bold.green('│') + `            ${impact}  ${chalk.dim(`${s.files.length} files affected`)}`);
    lines.push(chalk.bold.green('│') + '');
  }

  lines.push(chalk.bold.green('└────────────────────────────────────────────────────────────────────┘'));

  return lines.join('\n');
}

function summaryFooter(result: ArchMapResult): string {
  const lines: string[] = [];

  lines.push(chalk.dim('───────────────────────────────────────────────────────────────────'));
  lines.push('');

  const currentDirs = countFolders(result.graph);

  lines.push(
    chalk.white('  Current structure:  ') +
    chalk.yellow(`${currentDirs} directories`) +
    chalk.dim('  (by folder layout)')
  );

  lines.push(
    chalk.white('  Optimal structure:  ') +
    chalk.green(`${result.discoveredModules.length} modules`) +
    chalk.dim('    (by actual coupling)')
  );

  const savings = currentDirs - result.discoveredModules.length;
  if (savings > 0) {
    lines.push('');
    lines.push(
      chalk.green(`  → ${savings} directories are artifacts of history, not architecture.`)
    );
  }

  if (result.sprawlingFiles.length > 0) {
    lines.push(
      chalk.yellow(`  → ${result.sprawlingFiles.length} files show signs of sprawl — unclustered, high-coupling files.`)
    );
  }

  if (result.boundaryViolations.length > 0) {
    const highCount = result.boundaryViolations.filter(v => v.severity === 'high').length;
    lines.push(
      chalk.red(`  → ${highCount} high-severity boundary violations found. Fix these first.`)
    );
  }

  lines.push('');
  lines.push(chalk.dim('  Run with --json for machine-readable output.'));
  lines.push('');

  return lines.join('\n');
}

function countFolders(graph: import('./types.js').DependencyGraph): number {
  const folders = new Set<string>();
  for (const node of graph.nodes.values()) {
    const dir = path.dirname(node.path);
    folders.add(dir);
  }
  return folders.size;
}

/**
 * JSON output for CI / programmatic consumers.
 */
export function renderJson(result: ArchMapResult): string {
  // Strip the heavy raw graph for cleaner JSON output
  const { graph, ...rest } = result;

  const output = {
    ...rest,
    graphSummary: {
      nodeCount: graph.nodes.size,
      edgeCount: graph.edges.length,
    },
  };

  return JSON.stringify(output, null, 2);
}
