/**
 * Analysis engine - detects boundary violations, tangled interfaces,
 * and generates actionable restructure suggestions.
 */

import type {
  DependencyGraph,
  Module,
  BoundaryViolation,
  RestructureSuggestion,
  FolderNode,
  CoChangeReport,
} from './types.js';
import * as path from 'path';

/**
 * Find boundary violations between discovered modules.
 *
 * A boundary violation occurs when files from one module have
 * unusually high cross-import activity with another module,
 * indicating a hidden dependency that should be made explicit
 * or refactored away.
 */
export function findBoundaryViolations(
  graph: DependencyGraph,
  modules: Module[],
  moduleIds: Map<string, string>
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];

  // Build cross-module import counts
  // Key: "fromModule::toModule"
  const crossImports = new Map<string, {
    fromMod: string;
    toMod: string;
    count: number;
    files: Set<string>;
  }>();

  for (const edge of graph.edges) {
    const fromMod = moduleIds.get(edge.from);
    const toMod = moduleIds.get(edge.to);

    if (!fromMod || !toMod || fromMod === toMod) continue;

    const key = `${fromMod}::${toMod}`;
    const existing = crossImports.get(key);
    if (existing) {
      existing.count++;
      existing.files.add(edge.from);
      existing.files.add(edge.to);
    } else {
      crossImports.set(key, {
        fromMod,
        toMod,
        count: 1,
        files: new Set([edge.from, edge.to]),
      });
    }
  }

  // Classify severity based on cross-import density
  const moduleFileCounts = new Map<string, number>();
  for (const mod of modules) {
    moduleFileCounts.set(mod.id, mod.size);
  }

  for (const ci of crossImports.values()) {
    const fromSize = moduleFileCounts.get(ci.fromMod) || 1;
    const toSize = moduleFileCounts.get(ci.toMod) || 1;

    // Cross-import density: imports per file in the smaller module
    const smallerSize = Math.min(fromSize, toSize);
    const density = ci.count / smallerSize;

    let severity: 'low' | 'medium' | 'high';
    if (density >= 0.5) {
      severity = 'high';
    } else if (density >= 0.25) {
      severity = 'medium';
    } else {
      severity = 'low';
    }

    // Only report medium+ violations
    if (severity !== 'low') {
      const fromModName = modules.find((m) => m.id === ci.fromMod)?.name || ci.fromMod;
      const toModName = modules.find((m) => m.id === ci.toMod)?.name || ci.toMod;

      violations.push({
        fromModule: fromModName,
        toModule: toModName,
        crossImportCount: ci.count,
        tangledFiles: Array.from(ci.files),
        severity,
      });
    }
  }

  // Sort by severity then count
  violations.sort((a, b) => {
    const sevOrder = { high: 3, medium: 2, low: 1 };
    const diff = (sevOrder[b.severity] || 0) - (sevOrder[a.severity] || 0);
    if (diff !== 0) return diff;
    return b.crossImportCount - a.crossImportCount;
  });

  return violations.slice(0, 10); // Top 10
}

/**
 * Generate restructure suggestions based on discovered modules vs actual folders.
 */
export function generateSuggestions(
  modules: Module[],
  folderStructure: FolderNode,
  graph: DependencyGraph,
  coChange?: CoChangeReport | null
): RestructureSuggestion[] {
  const suggestions: RestructureSuggestion[] = [];

  // ── Co-change based suggestions (v0.2) ─────────────
  if (coChange && coChange.crossModulePairs.length > 0) {
    // Group cross-module pairs by module pair
    const modulePairCounts = new Map<string, { count: number; files: string[] }>();
    for (const pair of coChange.crossModulePairs) {
      if (!pair.moduleA || !pair.moduleB) continue;
      const key = [pair.moduleA, pair.moduleB].sort().join('::');
      const existing = modulePairCounts.get(key);
      if (existing) {
        existing.count++;
        if (!existing.files.includes(pair.fileA)) existing.files.push(pair.fileA);
        if (!existing.files.includes(pair.fileB)) existing.files.push(pair.fileB);
      } else {
        modulePairCounts.set(key, { count: 1, files: [pair.fileA, pair.fileB] });
      }
    }

    // High co-change across module boundaries = missing module or shared contract
    const topModulePairs = Array.from(modulePairCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3);

    for (const [key, info] of topModulePairs) {
      const [modA, modB] = key.split('::');
      const modAName = modules.find((m) => m.id === modA)?.name || modA || '?';
      const modBName = modules.find((m) => m.id === modB)?.name || modB || '?';

      suggestions.push({
        type: 'extract-interface',
        description: `Modules "${modAName}" and "${modBName}" change together in ${info.count} commit pairs. Hidden coupling - consider a shared contract or merging.`,
        files: info.files.slice(0, 5),
        impactEstimate: info.count >= 5 ? 'high' : 'medium',
      });
    }
  }

  // 1. Find modules that are spread across many folders → suggest merge
  for (const mod of modules) {
    if (mod.size < 3) continue;

    const folders = new Set<string>();
    for (const fp of mod.files) {
      const dir = path.dirname(fp);
      folders.add(dir);
    }

    if (folders.size > mod.size * 0.5) {
      // More than half the files are in different directories
      // → this module should be consolidated
      suggestions.push({
        type: 'merge',
        description: `Module "${mod.name}" (${mod.size} files) is spread across ${folders.size} directories. Consider consolidating into a single directory.`,
        files: mod.files.slice(0, 5), // sample
        impactEstimate: mod.size > 20 ? 'high' : 'medium',
      });
    }
  }

  // 2. Find large folders that contain multiple modules → suggest split
  const moduleByFolder = new Map<string, Set<string>>();
  for (const mod of modules) {
    for (const fp of mod.files) {
      const dir = path.dirname(fp);
      if (!moduleByFolder.has(dir)) {
        moduleByFolder.set(dir, new Set());
      }
      moduleByFolder.get(dir)!.add(mod.id);
    }
  }

  for (const [folder, modsInFolder] of moduleByFolder) {
    if (modsInFolder.size >= 2) {
      // Count files in this folder
      const filesInFolder = Array.from(graph.nodes.keys()).filter(
        (fp) => path.dirname(fp) === folder
      );

      if (filesInFolder.length > 15) {
        suggestions.push({
          type: 'split',
          description: `Directory "${folder}" (${filesInFolder.length} files) contains ${modsInFolder.size} natural modules. Consider splitting into separate directories.`,
          files: filesInFolder.slice(0, 5),
          impactEstimate: 'high',
        });
      }
    }
  }

  // 3. Detect files with high betweenness - suggest extracting interface
  const hubFiles: string[] = [];
  for (const node of graph.nodes.values()) {
    if (node.inDegree >= 5 && node.outDegree >= 5) {
      hubFiles.push(node.path);
    }
  }

  if (hubFiles.length > 0) {
    suggestions.push({
      type: 'extract-interface',
      description: `${hubFiles.length} files act as hubs (high imports + high exports). Consider extracting stable interfaces or splitting responsibilities.`,
      files: hubFiles.slice(0, 5),
      impactEstimate: 'medium',
    });
  }

  // 4. Find files imported by many modules but belonging to none
  const noModuleHighImport: string[] = [];
  for (const node of graph.nodes.values()) {
    if (node.moduleId === null && node.inDegree >= 4) {
      noModuleHighImport.push(node.path);
    }
  }

  if (noModuleHighImport.length > 0) {
    suggestions.push({
      type: 'move',
      description: `${noModuleHighImport.length} unclustered files are heavily imported. They likely belong in a shared/core module.`,
      files: noModuleHighImport.slice(0, 5),
      impactEstimate: 'medium',
    });
  }

  return suggestions;
}

/**
 * Build a tree of the actual folder structure.
 */
export function buildFolderTree(filePaths: string[], root: string): FolderNode {
  const resolvedRoot = path.resolve(root);

  const rootNode: FolderNode = {
    name: path.basename(resolvedRoot) || resolvedRoot,
    path: resolvedRoot,
    fileCount: 0,
    children: [],
  };

  const dirMap = new Map<string, FolderNode>();
  dirMap.set(resolvedRoot, rootNode);

  for (const fp of filePaths) {
    const dir = path.dirname(fp);

    // Ensure all ancestor directories exist
    const parts = dir.replace(resolvedRoot, '').split(path.sep).filter(Boolean);
    let currentPath = resolvedRoot;

    for (const part of parts) {
      currentPath = path.join(currentPath, part);
      if (!dirMap.has(currentPath)) {
        const node: FolderNode = {
          name: part,
          path: currentPath,
          fileCount: 0,
          children: [],
        };
        dirMap.set(currentPath, node);

        const parentPath = path.dirname(currentPath);
        const parent = dirMap.get(parentPath);
        if (parent) {
          parent.children.push(node);
        }
      }
    }

    // Increment file count in leaf directory
    const leafDir = dirMap.get(dir);
    if (leafDir) {
      leafDir.fileCount++;
    }

    // Also increment root
    rootNode.fileCount++;
  }

  return rootNode;
}
