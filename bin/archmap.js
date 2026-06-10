#!/usr/bin/env node
// Thin entry point — all logic lives in ../dist/index.js
import('../dist/index.js').catch((err) => {
  console.error(
    'archmap is not built. Run: npm install && npm run build'
  );
  process.exit(1);
});
