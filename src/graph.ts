/**
 * Graph engine — builds the dependency graph and runs community detection
 * to discover natural module boundaries.
 *
 * Uses the Louvain algorithm for community detection on the undirected
 * co-import graph: two files are connected if they import each other
 * or if they share import targets.
 */

import type {
  SourceFile,
  DependencyGraph,
  GraphNode,
  DependencyEdge,
  Module,
} from './types.js';

/**
 * Simple seeded PRNG (mulberry32) for deterministic shuffles.
 * Uses a fixed seed so archmap results are reproducible.
 */
function seededRandom(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle. */
function shuffle<T>(arr: T[], rand: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/**
 * Build a directed dependency graph from parsed source files.
 * Merges multiple imports from the same (from, to) file pair into
 * a single edge with aggregated symbols.
 */
export function buildGraph(files: SourceFile[]): DependencyGraph {
  const nodes = new Map<string, GraphNode>();
  const adjacency = new Map<string, Set<string>>();
  const edgeMap = new Map<string, DependencyEdge>();

  // Index files by path for quick lookup
  const fileSet = new Set(files.map((f) => f.path));

  // Create nodes
  for (const file of files) {
    nodes.set(file.path, {
      path: file.path,
      relativePath: file.relativePath,
      outDegree: 0,
      inDegree: 0,
      exportCount: file.exports.length,
      lineCount: 0, // set later by caller
      language: file.language,
      moduleId: null,
    });

    adjacency.set(file.path, new Set());
  }

  // Create edges from imports — merge same (from, to) pairs
  for (const file of files) {
    const out = adjacency.get(file.path)!;

    for (const imp of file.imports) {
      // Only track internal (relative) imports that resolve
      if (!imp.resolvedPath || !fileSet.has(imp.resolvedPath)) continue;

      out.add(imp.resolvedPath);

      const key = `${file.path}::${imp.resolvedPath}`;
      const existing = edgeMap.get(key);
      if (existing) {
        if (!existing.symbols.includes(imp.name)) {
          existing.symbols.push(imp.name);
        }
        existing.usageCount++;
      } else {
        edgeMap.set(key, {
          from: file.path,
          to: imp.resolvedPath,
          symbols: [imp.name],
          kind: 'direct',
          usageCount: 1,
        });
      }
    }

    // Update out-degree (count unique targets)
    const node = nodes.get(file.path);
    if (node) {
      node.outDegree = out.size;
    }
  }

  // Update in-degrees (count unique source files that import each target)
  for (const edge of edgeMap.values()) {
    const targetNode = nodes.get(edge.to);
    if (targetNode) {
      targetNode.inDegree++;
    }
  }

  const edges = Array.from(edgeMap.values());
  return { nodes, edges, adjacency };
}

/**
 * Run Louvain community detection on the co-import graph.
 *
 * The Louvain algorithm maximizes modularity by iteratively moving nodes
 * between communities to increase the overall modularity score.
 *
 * Uses a deterministic shuffle with a fixed seed so results are
 * reproducible across runs.
 */
export function detectCommunities(graph: DependencyGraph): {
  moduleIds: Map<string, string>;
  modules: Module[];
} {
  const filePaths = Array.from(graph.nodes.keys());
  const n = filePaths.length;

  if (n === 0) {
    return { moduleIds: new Map(), modules: [] };
  }

  // Build undirected adjacency (co-import graph: files are connected if
  // they import each other or share the same import target)
  const neighbors = new Map<string, Set<string>>();
  for (const fp of filePaths) {
    neighbors.set(fp, new Set());
  }

  // Edge weight is 1 for direct imports in either direction
  for (const edge of graph.edges) {
    neighbors.get(edge.from)?.add(edge.to);
    neighbors.get(edge.to)?.add(edge.from);
  }

  // Also connect files that share import targets (indirect coupling)
  const importersOf = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!importersOf.has(edge.to)) {
      importersOf.set(edge.to, new Set());
    }
    importersOf.get(edge.to)!.add(edge.from);
  }

  for (const importers of importersOf.values()) {
    const arr = Array.from(importers);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        neighbors.get(arr[i]!)?.add(arr[j]!);
        neighbors.get(arr[j]!)?.add(arr[i]!);
      }
    }
  }

  // Calculate total weight
  let totalWeight = 0;
  const degrees = new Map<string, number>();
  for (const [node, neighs] of neighbors) {
    degrees.set(node, neighs.size);
    totalWeight += neighs.size;
  }
  totalWeight = totalWeight / 2; // each edge counted twice

  if (totalWeight === 0) {
    // No edges — every file is its own module
    const moduleIds = new Map<string, string>();
    filePaths.forEach((fp, i) => moduleIds.set(fp, `m${i}`));
    return {
      moduleIds,
      modules: filePaths.map((fp, i) => ({
        id: `m${i}`,
        name: `Module ${i + 1}`,
        files: [fp],
        size: 1,
        cohesion: 1,
        internalEdgeDensity: 0,
      })),
    };
  }

  // Initialize: each node is its own community
  const community = new Map<string, number>();
  filePaths.forEach((fp, i) => community.set(fp, i));

  // Deterministic PRNG with fixed seed for reproducibility
  const rand = seededRandom(42);

  // Louvain iteration
  let improved = true;
  const maxIterations = 100;

  for (let iter = 0; iter < maxIterations && improved; iter++) {
    improved = false;

    // Deterministic shuffle
    const shuffled = shuffle(filePaths, rand);

    for (const node of shuffled) {
      const currentComm = community.get(node)!;
      const neighSet = neighbors.get(node)!;
      const nodeDegree = degrees.get(node) || 0;

      // Find the best community to move to
      const commWeights = new Map<number, number>();

      for (const neighbor of neighSet) {
        const neighborComm = community.get(neighbor)!;
        commWeights.set(
          neighborComm,
          (commWeights.get(neighborComm) || 0) + 1
        );
      }

      // Calculate current community's total degree
      const commTotals = new Map<number, number>();
      for (const [fp, c] of community) {
        commTotals.set(c, (commTotals.get(c) || 0) + (degrees.get(fp) || 0));
      }

      const currentCommTotal = commTotals.get(currentComm) || 0;

      // Calculate modularity gain for moving to each neighbor community
      let bestComm = currentComm;
      let bestGain = 0;

      for (const [targetComm, weightToComm] of commWeights) {
        if (targetComm === currentComm) continue;

        const targetCommTotal = commTotals.get(targetComm) || 0;

        // Simplified modularity gain for weighted undirected graphs:
        // ΔQ ≈ (weight_to_comm / totalWeight) - (nodeDegree * (targetTotal - (currentTotal - nodeDegree))) / (2 * totalWeight²)
        const gain =
          weightToComm / totalWeight -
          (nodeDegree * (targetCommTotal - (currentCommTotal - nodeDegree))) /
            (2 * totalWeight * totalWeight);

        if (gain > bestGain) {
          bestGain = gain;
          bestComm = targetComm;
        }
      }

      if (bestComm !== currentComm) {
        community.set(node, bestComm);
        improved = true;
      }
    }
  }

  // Assign string module IDs
  const moduleIdMap = new Map<number, string>();
  const moduleFiles = new Map<string, string[]>();
  const moduleIds = new Map<string, string>();

  for (const [fp, commNum] of community) {
    let modId = moduleIdMap.get(commNum);
    if (!modId) {
      modId = `M${moduleIdMap.size}`;
      moduleIdMap.set(commNum, modId);
    }
    moduleIds.set(fp, modId);
    if (!moduleFiles.has(modId)) {
      moduleFiles.set(modId, []);
    }
    moduleFiles.get(modId)!.push(fp);
  }

  // Build Module objects
  const modules: Module[] = [];
  for (const [modId, files] of moduleFiles) {
    // Calculate cohesion: ratio of internal edges to possible internal edges
    let internalEdges = 0;
    const fileSet = new Set(files);

    for (const fp of files) {
      for (const neighbor of neighbors.get(fp) || []) {
        if (fileSet.has(neighbor)) {
          internalEdges++;
        }
      }
    }
    internalEdges = internalEdges / 2; // each counted twice

    const possibleEdges = (files.length * (files.length - 1)) / 2;
    const density = possibleEdges > 0 ? internalEdges / possibleEdges : 0;

    // Name the module based on common directory
    const dirs = files.map((f) => f.split('/').slice(0, -1).join('/'));
    const dirCounts = new Map<string, number>();
    for (const d of dirs) {
      dirCounts.set(d, (dirCounts.get(d) || 0) + 1);
    }
    let bestDir = '';
    let bestCount = 0;
    for (const [d, c] of dirCounts) {
      if (c > bestCount) {
        bestCount = c;
        bestDir = d;
      }
    }

    modules.push({
      id: modId,
      name: bestDir || `Module ${modId}`,
      files,
      size: files.length,
      cohesion: density,
      internalEdgeDensity: density,
    });
  }

  // Update graph nodes with module IDs
  for (const [fp, modId] of moduleIds) {
    const node = graph.nodes.get(fp);
    if (node) {
      node.moduleId = modId;
    }
  }

  // Sort modules by size descending
  modules.sort((a, b) => b.size - a.size);

  return { moduleIds, modules };
}

/**
 * Detect sprawling files — files that don't cluster well.
 * A file is "sprawl" if it has high in-degree AND high out-degree,
 * meaning it's a hub that couples many modules together.
 */
export function detectSprawl(
  graph: DependencyGraph,
  moduleIds: Map<string, string>
): string[] {
  const sprawling: string[] = [];
  const avgOutDegree =
    Array.from(graph.nodes.values()).reduce((s, n) => s + n.outDegree, 0) /
    Math.max(graph.nodes.size, 1);
  const avgInDegree =
    Array.from(graph.nodes.values()).reduce((s, n) => s + n.inDegree, 0) /
    Math.max(graph.nodes.size, 1);

  for (const node of graph.nodes.values()) {
    // A sprawing file imports from many places AND is imported by many places
    if (node.outDegree > avgOutDegree * 2 && node.inDegree > avgInDegree * 1.5) {
      sprawling.push(node.path);
    }

    // Also mark files that are the sole import target for many modules
    const importers = graph.edges
      .filter((e) => e.to === node.path)
      .map((e) => e.from);

    const importerModules = new Set(
      importers.map((f) => moduleIds.get(f)).filter(Boolean)
    );

    if (importerModules.size >= 3 && !sprawling.includes(node.path)) {
      sprawling.push(node.path);
    }
  }

  return sprawling;
}
