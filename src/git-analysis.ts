/**
 * Git co-change analysis - discovers files that change together
 * in the same commits, revealing hidden coupling that static
 * import analysis can't detect.
 *
 * Two files that always change together but don't import each
 * other have a HIDDEN DEPENDENCY - they share logic, a contract,
 * or an implicit convention. This is the architecture you can't
 * see in the source code alone.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import type { CoChangePair, CoChangeReport } from './types.js';

/** Maximum commits to analyze (balancing accuracy vs speed). */
const MAX_COMMITS = 500;

/**
 * Run git co-change analysis on a set of files.
 *
 * @param filePaths - Absolute paths to all analyzed source files
 * @param root - Project root directory
 * @param moduleIds - Module assignments from community detection
 * @param maxCommits - Override the default commit limit
 */
export function analyzeGitHistory(
  filePaths: string[],
  root: string,
  moduleIds: Map<string, string>,
  maxCommits: number = MAX_COMMITS
): CoChangeReport | null {
  // Check if this is a git repo
  try {
    execSync('git rev-parse --git-dir', {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    return null; // not a git repo
  }

  // Normalize file paths to be relative to the repo root
  const repoRoot = getRepoRoot(root);
  const relativePaths = filePaths.map((fp) =>
    path.relative(repoRoot, fp).replace(/\\/g, '/')
  );
  const fileSet = new Set(relativePaths);

  // Build a map of relative → absolute for quick lookup
  const relToAbs = new Map<string, string>();
  for (let i = 0; i < filePaths.length; i++) {
    relToAbs.set(relativePaths[i]!, filePaths[i]!);
  }

  // Run git log to get commit→files mapping
  let output: string;
  try {
    output = execSync(
      `git log --pretty=format:"COMMIT %H" --name-only --diff-filter=ACM -n ${maxCommits}`,
      {
        cwd: root,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024, // 50MB for large repos
        timeout: 30000, // 30s timeout
      }
    );
  } catch (err: any) {
    // Timeout or buffer overflow - try with fewer commits
    if (maxCommits > 100) {
      return analyzeGitHistory(filePaths, root, moduleIds, 100);
    }
    return null;
  }

  // Parse the output
  const commitFiles = parseGitLog(output, fileSet);

  if (commitFiles.length === 0) {
    return {
      pairs: [],
      commitsAnalyzed: 0,
      filesWithHistory: 0,
      crossModulePairs: [],
      averageCoChange: 0,
    };
  }

  // Build co-change matrix
  const coChangeCounts = new Map<string, number>(); // "fileA::fileB" → count
  const fileChangeCounts = new Map<string, number>(); // file → total commits it appears in

  for (const files of commitFiles) {
    // Increment individual file change counts
    for (const f of files) {
      fileChangeCounts.set(f, (fileChangeCounts.get(f) || 0) + 1);
    }

    // Count co-changes for all pairs in this commit
    const sorted = Array.from(files).sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}::${sorted[j]}`;
        coChangeCounts.set(key, (coChangeCounts.get(key) || 0) + 1);
      }
    }
  }

  // Calculate Jaccard similarity and surprise for each pair
  const pairs: CoChangePair[] = [];
  const totalCommits = commitFiles.length;

  let allJaccardSum = 0;
  let pairCount = 0;

  for (const [key, togetherCount] of coChangeCounts) {
    const [fileA, fileB] = key.split('::');
    if (!fileA || !fileB) continue;

    // Skip trivial pairs (changed together only once)
    if (togetherCount < 2) continue;

    const countA = fileChangeCounts.get(fileA) || 0;
    const countB = fileChangeCounts.get(fileB) || 0;
    const unionCount = countA + countB - togetherCount;
    const jaccard = unionCount > 0 ? togetherCount / unionCount : 0;

    // Surprise: how unexpected is this co-change rate?
    // Expected co-change = (countA / totalCommits) * (countB / totalCommits) * totalCommits
    const expectedTogether =
      (countA / totalCommits) * (countB / totalCommits) * totalCommits;
    const surprise =
      expectedTogether > 0
        ? (togetherCount - expectedTogether) / Math.sqrt(expectedTogether)
        : 0;

    pairs.push({
      fileA: relToAbs.get(fileA) || fileA,
      fileB: relToAbs.get(fileB) || fileB,
      togetherCount,
      jaccard: Math.round(jaccard * 1000) / 1000,
      surprise: Math.round(surprise * 100) / 100,
      moduleA: relToAbs.get(fileA) ? (moduleIds.get(relToAbs.get(fileA)!) ?? null) : null,
      moduleB: relToAbs.get(fileB) ? (moduleIds.get(relToAbs.get(fileB)!) ?? null) : null,
    });

    allJaccardSum += jaccard;
    pairCount++;
  }

  // Sort by surprise (most surprising co-changes first)
  pairs.sort((a, b) => b.surprise - a.surprise);

  // Cross-module pairs: files that change together but belong to different modules
  const crossModulePairs = pairs.filter(
    (p) => p.moduleA && p.moduleB && p.moduleA !== p.moduleB
  );

  const averageCoChange =
    pairCount > 0 ? allJaccardSum / pairCount : 0;

  return {
    pairs: pairs.slice(0, 30), // top 30
    commitsAnalyzed: totalCommits,
    filesWithHistory: fileChangeCounts.size,
    crossModulePairs: crossModulePairs.slice(0, 15),
    averageCoChange: Math.round(averageCoChange * 1000) / 1000,
  };
}

/**
 * Get the root of the git repository.
 */
function getRepoRoot(cwd: string): string {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    // Normalize to platform-native path separators
    return path.resolve(root);
  } catch {
    return cwd;
  }
}

/**
 * Parse `git log --name-only` output.
 *
 * Format:
 *   COMMIT <hash>
 *   path/to/file1.ts
 *   path/to/file2.ts
 *   <blank line>
 *   COMMIT <hash>
 *   ...
 *
 * Returns an array of Sets, each containing the relative file paths
 * that changed in that commit (filtered to only include files in fileSet).
 */
function parseGitLog(
  output: string,
  fileSet: Set<string>
): Set<string>[] {
  const commits: Set<string>[] = [];
  let currentFiles = new Set<string>();

  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '') {
      // Blank line ends a commit
      if (currentFiles.size > 0) {
        commits.push(currentFiles);
      }
      currentFiles = new Set<string>();
      continue;
    }

    if (trimmed.startsWith('COMMIT ')) {
      // New commit starts - push previous if it has files
      if (currentFiles.size > 0) {
        commits.push(currentFiles);
        currentFiles = new Set<string>();
      }
      continue;
    }

    // This is a file path - only include if it's in our analyzed set
    if (fileSet.has(trimmed)) {
      currentFiles.add(trimmed);
    }
  }

  // Don't forget the last commit
  if (currentFiles.size > 0) {
    commits.push(currentFiles);
  }

  return commits;
}
