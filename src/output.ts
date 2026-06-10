/**
 * Terminal output renderer - this is where the magic becomes visible.
 *
 * The output is designed to be screenshot-worthy:
 * - Clean box-drawn diagrams
 * - Color-coded severity indicators
 * - Human-readable module descriptions
 * - Actionable suggestions
 */

import chalk from 'chalk';
import type { ArchMapResult, Module, BoundaryViolation, RestructureSuggestion, CoChangeReport } from './types.js';
import * as path from 'path';

// ── ANSI-aware string utilities ───────────────────────────────────

/** Strip ANSI escape sequences to get the visible length of a string. */
function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Pad a string (possibly containing ANSI codes) to a visible width. */
function padVisible(s: string, width: number): string {
  const current = visibleLen(s);
  if (current >= width) return s;
  return s + ' '.repeat(width - current);
}

/** Create a row in the box: left border + content + right border, properly aligned. */
function boxRow(left: string, content: string, right: string, innerWidth: number): string {
  return left + padVisible(content, innerWidth) + right;
}

const BOX_W = 66; // inner width of boxed sections
const HEADER_W = 62; // inner width of header box

export function render(result: ArchMapResult, root: string): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(header(result, root));
  lines.push('');

  if (result.discoveredModules.length > 0) {
    lines.push(moduleMap(result.discoveredModules, result.graph.nodes.size));
    lines.push('');
  } else {
    lines.push(chalk.dim('  No modules discovered (not enough edges for clustering).'));
    lines.push('');
  }

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

  if (result.coChange) {
    lines.push(coChangeSection(result.coChange));
    lines.push('');
  }

  lines.push(summaryFooter(result));

  return lines.join('\n');
}

function header(result: ArchMapResult, root: string): string {
  const name = path.basename(path.resolve(root));
  const lines: string[] = [];

  const bar = '═'.repeat(HEADER_W);
  lines.push(chalk.bold.cyan(`╔${bar}╗`));
  lines.push(boxRow(
    chalk.bold.cyan('║'),
    '  ' + chalk.bold.white('ARCHMAP - Architecture Discovery'),
    chalk.bold.cyan('║'),
    HEADER_W
  ));
  lines.push(chalk.bold.cyan(`╠${bar}╣`));

  const rows = [
    `  Project: ${chalk.yellow(name)}`,
    `  Files:   ${chalk.white(String(result.fileCount))} source files`,
    `  Edges:   ${chalk.white(String(result.edgeCount))} import relationships`,
    `  Modules: ${chalk.green(String(result.discoveredModules.length))} natural modules discovered`,
    `  Languages: ${chalk.dim(result.languagesDetected.join(', '))}`,
  ];

  for (const row of rows) {
    lines.push(boxRow(chalk.bold.cyan('║'), row, chalk.bold.cyan('║'), HEADER_W));
  }

  lines.push(chalk.bold.cyan(`╚${bar}╝`));

  return lines.join('\n');
}

function moduleMap(modules: Module[], totalFiles: number): string {
  const lines: string[] = [];
  const bar = '─'.repeat(BOX_W);

  lines.push(chalk.bold.magenta(`┌─── DISCOVERED MODULES (by actual coupling, not folder structure) ${bar.slice(3)}┐`));
  lines.push(boxRow(chalk.bold.magenta('│'), '', chalk.bold.magenta('│'), BOX_W));

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
    const stats = `${chalk.white(String(mod.size) + ' files')}  ${cohesionLabel} ${cohesionBar}  ${chalk.dim(`(${percentOfCodebase}%)`)}`;

    // Layout: indent + name, then stats on the same line
    const row = `  ${nameDisplay}  ${stats}`;
    lines.push(boxRow(chalk.bold.magenta('│'), row, chalk.bold.magenta('│'), BOX_W));
  }

  if (modules.length > 8) {
    lines.push(boxRow(
      chalk.bold.magenta('│'),
      chalk.dim(`  ... and ${modules.length - 8} more modules`),
      chalk.bold.magenta('│'),
      BOX_W
    ));
  }

  lines.push(boxRow(chalk.bold.magenta('│'), '', chalk.bold.magenta('│'), BOX_W));
  lines.push(chalk.bold.magenta(`└${bar}┘`));

  return lines.join('\n');
}

function barChart(value: number, width: number): string {
  const filled = Math.round(Math.min(value, 1) * width);
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
  const bar = '─'.repeat(BOX_W);

  lines.push(chalk.bold.red(`┌─── SPRAWL DETECTED ${bar.slice(16)}┐`));
  lines.push(boxRow(
    chalk.bold.red('│'),
    chalk.white(`  ${sprawlingFiles.length} files don't cluster - they're imported by everything:`),
    chalk.bold.red('│'),
    BOX_W
  ));
  lines.push(boxRow(chalk.bold.red('│'), '', chalk.bold.red('│'), BOX_W));

  for (const file of sprawlingFiles.slice(0, 6)) {
    const display = file.length > 52 ? '...' + file.slice(-49) : file;
    lines.push(boxRow(
      chalk.bold.red('│'),
      chalk.yellow(`    ${display}`),
      chalk.bold.red('│'),
      BOX_W
    ));
  }

  if (sprawlingFiles.length > 6) {
    lines.push(boxRow(
      chalk.bold.red('│'),
      chalk.dim(`    ... and ${sprawlingFiles.length - 6} more sprawling files`),
      chalk.bold.red('│'),
      BOX_W
    ));
  }

  lines.push(boxRow(chalk.bold.red('│'), '', chalk.bold.red('│'), BOX_W));
  lines.push(boxRow(chalk.bold.red('│'), chalk.dim('  → These files are invisible "utils" folders. Consider:'), chalk.bold.red('│'), BOX_W));
  lines.push(boxRow(chalk.bold.red('│'), chalk.dim('    1. Split large utils into domain-specific modules'), chalk.bold.red('│'), BOX_W));
  lines.push(boxRow(chalk.bold.red('│'), chalk.dim('    2. Move shared code to a dedicated core/ package'), chalk.bold.red('│'), BOX_W));
  lines.push(chalk.bold.red(`└${bar}┘`));

  return lines.join('\n');
}

function violationsSection(violations: BoundaryViolation[]): string {
  const lines: string[] = [];
  const bar = '─'.repeat(BOX_W);

  lines.push(chalk.bold.yellow(`┌─── TANGLED MODULE BOUNDARIES ${bar.slice(28)}┐`));
  lines.push(boxRow(chalk.bold.yellow('│'), '', chalk.bold.yellow('│'), BOX_W));

  for (const v of violations.slice(0, 5)) {
    const sevIcon = v.severity === 'high'
      ? chalk.red('🔴 HIGH  ')
      : chalk.yellow('🟡 MEDIUM');

    const desc =
      `${sevIcon}  ` +
      chalk.cyan(v.fromModule) +
      chalk.dim(' ↔ ') +
      chalk.cyan(v.toModule) +
      chalk.dim(`  (${v.crossImportCount} cross-imports, ${v.tangledFiles.length} tangled files)`);

    lines.push(boxRow(chalk.bold.yellow('│'), desc, chalk.bold.yellow('│'), BOX_W));
  }

  lines.push(boxRow(chalk.bold.yellow('│'), '', chalk.bold.yellow('│'), BOX_W));
  lines.push(chalk.bold.yellow(`└${bar}┘`));

  return lines.join('\n');
}

function suggestionsSection(suggestions: RestructureSuggestion[]): string {
  const lines: string[] = [];
  const bar = '─'.repeat(BOX_W);

  lines.push(chalk.bold.green(`┌─── SUGGESTED RESTRUCTURE ${bar.slice(24)}┐`));
  lines.push(boxRow(chalk.bold.green('│'), '', chalk.bold.green('│'), BOX_W));

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

    lines.push(boxRow(
      chalk.bold.green('│'),
      `  ${prefix} ${s.description.slice(0, 55)}`,
      chalk.bold.green('│'),
      BOX_W
    ));
    lines.push(boxRow(
      chalk.bold.green('│'),
      `            ${impact}  ${chalk.dim(`${s.files.length} files affected`)}`,
      chalk.bold.green('│'),
      BOX_W
    ));
    lines.push(boxRow(chalk.bold.green('│'), '', chalk.bold.green('│'), BOX_W));
  }

  lines.push(chalk.bold.green(`└${bar}┘`));

  return lines.join('\n');
}

function coChangeSection(report: CoChangeReport): string {
  const lines: string[] = [];
  const bar = '─'.repeat(BOX_W);

  if (report.pairs.length === 0) {
    // Still show the section to confirm analysis ran
    lines.push(chalk.bold.blue(`┌─── GIT CO-CHANGE ANALYSIS ${bar.slice(22)}┐`));
    lines.push(boxRow(
      chalk.bold.blue('│'),
      chalk.dim(`  Analyzed ${report.commitsAnalyzed} commits - no significant co-change patterns found.`),
      chalk.bold.blue('│'),
      BOX_W
    ));
    lines.push(chalk.bold.blue(`└${bar}┘`));
    return lines.join('\n');
  }

  lines.push(chalk.bold.blue(`┌─── GIT CO-CHANGE ANALYSIS ${bar.slice(22)}┐`));
  lines.push(boxRow(
    chalk.bold.blue('│'),
    chalk.white(`  ${report.commitsAnalyzed} commits analyzed • ${report.pairs.length} co-change pairs found`),
    chalk.bold.blue('│'),
    BOX_W
  ));
  lines.push(boxRow(chalk.bold.blue('│'), '', chalk.bold.blue('│'), BOX_W));

  // Show top co-change pairs
  const topPairs = report.pairs.slice(0, 6);

  for (const pair of topPairs) {
    const fileADisplay = path.basename(pair.fileA);
    const fileBDisplay = path.basename(pair.fileB);
    const togetherStr = chalk.white(`${pair.togetherCount}× together`);
    const jaccardStr = pair.jaccard > 0.3
      ? chalk.yellow(`Jaccard: ${pair.jaccard}`)
      : chalk.dim(`Jaccard: ${pair.jaccard}`);

    // If cross-module, highlight it
    const isCrossModule = pair.moduleA && pair.moduleB && pair.moduleA !== pair.moduleB;
    const marker = isCrossModule ? chalk.red(' ⚡CROSS-MODULE') : '';

    const row = `  ${chalk.cyan(fileADisplay)} ${chalk.dim('+')} ${chalk.cyan(fileBDisplay)}  ${togetherStr}  ${jaccardStr}${marker}`;
    lines.push(boxRow(chalk.bold.blue('│'), row, chalk.bold.blue('│'), BOX_W));
  }

  if (report.pairs.length > 6) {
    lines.push(boxRow(
      chalk.bold.blue('│'),
      chalk.dim(`  ... and ${report.pairs.length - 6} more co-change pairs`),
      chalk.bold.blue('│'),
      BOX_W
    ));
  }

  // Cross-module summary
  if (report.crossModulePairs.length > 0) {
    lines.push(boxRow(chalk.bold.blue('│'), '', chalk.bold.blue('│'), BOX_W));
    const crossMsg = report.crossModulePairs.length === 1
      ? chalk.red(`  ⚠ ${report.crossModulePairs.length} co-change pair crosses module boundaries`)
      : chalk.red(`  ⚠ ${report.crossModulePairs.length} co-change pairs cross module boundaries`);
    lines.push(boxRow(chalk.bold.blue('│'), crossMsg, chalk.bold.blue('│'), BOX_W));
    lines.push(boxRow(
      chalk.bold.blue('│'),
      chalk.dim('  → These files change together but belong to different modules.'),
      chalk.bold.blue('│'),
      BOX_W
    ));
    lines.push(boxRow(
      chalk.bold.blue('│'),
      chalk.dim('  → Hidden coupling - consider a shared contract, interface, or merging.'),
      chalk.bold.blue('│'),
      BOX_W
    ));
  }

  lines.push(chalk.bold.blue(`└${bar}┘`));

  return lines.join('\n');
}

function summaryFooter(result: ArchMapResult): string {
  const lines: string[] = [];

  lines.push(chalk.dim('─'.repeat(67)));
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
      chalk.yellow(`  → ${result.sprawlingFiles.length} files show signs of sprawl - unclustered, high-coupling files.`)
    );
  }

  if (result.boundaryViolations.length > 0) {
    const highCount = result.boundaryViolations.filter(v => v.severity === 'high').length;
    lines.push(
      chalk.red(`  → ${highCount} high-severity boundary violations found. Fix these first.`)
    );
  }

  if (result.coChange && result.coChange.crossModulePairs.length > 0) {
    lines.push(
      chalk.red(`  → ${result.coChange.crossModulePairs.length} cross-module co-change pairs - hidden coupling detected.`)
    );
  }

  lines.push('');
  lines.push(chalk.dim('  Run with --git for co-change analysis.  Run with --json for machine-readable output.'));
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
