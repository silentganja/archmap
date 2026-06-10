/**
 * Core types for archmap - the architecture mapper.
 */

// ─── File & Symbol ────────────────────────────────────────────────

export interface SourceFile {
  /** Absolute path to the file */
  path: string;
  /** Path relative to the project root */
  relativePath: string;
  /** Language detected (ts, js, py, etc.) */
  language: string;
  /** Symbols this file exports */
  exports: ExportSymbol[];
  /** Imports this file depends on */
  imports: ImportSymbol[];
}

export interface ExportSymbol {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'unknown';
  /** Whether this is the default export */
  isDefault: boolean;
  /** Line number where exported */
  line: number;
}

export interface ImportSymbol {
  name: string;
  /** The module path being imported from */
  modulePath: string;
  /** Resolved absolute file path (if resolvable) */
  resolvedPath: string | null;
  /** Whether this is a default import */
  isDefault: boolean;
  /** Is this a relative import (./ or ../) */
  isRelative: boolean;
  /** Line number */
  line: number;
}

// ─── Dependency Graph ─────────────────────────────────────────────

export interface DependencyEdge {
  from: string; // file path
  to: string;   // file path
  /** Names of symbols imported */
  symbols: string[];
  /** Import kind */
  kind: 'direct' | 're-export' | 'dynamic';
  /** How many actual usages in the source */
  usageCount: number;
}

export interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  edges: DependencyEdge[];
  /** Adjacency list: filePath → [filePaths it depends on] */
  adjacency: Map<string, Set<string>>;
}

export interface GraphNode {
  path: string;
  relativePath: string;
  /** Number of files this file imports */
  outDegree: number;
  /** Number of files that import this file */
  inDegree: number;
  /** Number of export symbols */
  exportCount: number;
  /** File size in lines */
  lineCount: number;
  /** Language */
  language: string;
  /** Which discovered module this node belongs to */
  moduleId: string | null;
}

// ─── Module / Cluster ─────────────────────────────────────────────

export interface Module {
  id: string;
  name: string;
  /** Files belonging to this module */
  files: string[];
  /** How many files */
  size: number;
  /** Internal cohesion score (0-1) */
  cohesion: number;
  /** How tightly files in this module depend on each other */
  internalEdgeDensity: number;
}

// ─── Git Co-Change ──────────────────────────────────────────────────

export interface CoChangePair {
  fileA: string;
  fileB: string;
  /** Number of commits where both files changed together */
  togetherCount: number;
  /** Jaccard similarity: |A ∩ B| / |A ∪ B| */
  jaccard: number;
  /** How many standard deviations above the mean co-change rate */
  surprise: number;
  /** Modules these files belong to (for cross-module detection) */
  moduleA: string | null;
  moduleB: string | null;
}

export interface CoChangeReport {
  /** Top co-change pairs */
  pairs: CoChangePair[];
  /** Total commits analyzed */
  commitsAnalyzed: number;
  /** Files that changed in the analyzed window */
  filesWithHistory: number;
  /** Pairs that cross module boundaries - architecture smells */
  crossModulePairs: CoChangePair[];
  /** Average co-change rate across all pairs */
  averageCoChange: number;
}

// ─── Analysis Results ─────────────────────────────────────────────

export interface ArchMapResult {
  /** Project root path */
  root: string;
  /** Total files analyzed */
  fileCount: number;
  /** Total import edges found */
  edgeCount: number;
  /** Languages detected */
  languagesDetected: string[];

  /** Discovered modules (by community detection) */
  discoveredModules: Module[];
  /** Files that don't cluster - the "sprawl" */
  sprawlingFiles: string[];
  /** The current folder structure's directories */
  folderStructure: FolderNode;

  /** Boundary violations (files from one module importing from another at high rates) */
  boundaryViolations: BoundaryViolation[];
  /** Suggestion for restructuring */
  restructureSuggestions: RestructureSuggestion[];

  /** Git co-change analysis (only when --git flag is used) */
  coChange: CoChangeReport | null;

  /** Raw dependency graph (for advanced consumers) */
  graph: DependencyGraph;
}

export interface BoundaryViolation {
  /** The two modules involved */
  fromModule: string;
  toModule: string;
  /** How many cross-imports exist */
  crossImportCount: number;
  /** Files involved in the tangle */
  tangledFiles: string[];
  /** Severity: low, medium, high */
  severity: 'low' | 'medium' | 'high';
}

export interface RestructureSuggestion {
  type: 'merge' | 'split' | 'extract-interface' | 'move';
  description: string;
  /** Files affected */
  files: string[];
  /** How much it would improve cohesion */
  impactEstimate: 'low' | 'medium' | 'high';
}

export interface FolderNode {
  name: string;
  path: string;
  fileCount: number;
  children: FolderNode[];
}

// ─── CLI Options ──────────────────────────────────────────────────

export interface ArchMapOptions {
  /** Directory to analyze */
  root: string;
  /** File glob patterns to include */
  include: string[];
  /** File glob patterns to exclude */
  exclude: string[];
  /** Output format */
  format: 'terminal' | 'json';
  /** Run git co-change analysis */
  gitAnalysis: boolean;
  /** Verbose output */
  verbose: boolean;
}
