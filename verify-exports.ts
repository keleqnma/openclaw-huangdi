/**
 * Huangdi Orchestrator - Plugin Exports Verification Test
 *
 * Run: node --import tsx verify-exports.ts
 */

import * as plugin from './src/plugin.js';

console.log('=== Huangdi Orchestrator - Export Verification ===\n');

// Check default export
console.log('Default export:', typeof plugin.default);
if (typeof plugin.default === 'object') {
  console.log('  - id:', plugin.default.id);
  console.log('  - name:', plugin.default.name);
  console.log('  - description:', plugin.default.description);
  console.log('  - register:', typeof plugin.default.register);
  console.log('  - activate:', typeof plugin.default.activate);
}

// Check named exports
console.log('\nNamed exports:');
console.log('  - register:', typeof plugin.register);
console.log('  - activate:', typeof plugin.activate);

// Check coordinator exports
console.log('\n=== Coordinator Exports ===');
try {
  const coordinator = await import('./src/coordinator/index.js');
  console.log('Available exports:', Object.keys(coordinator));
} catch (err) {
  console.log('Note: Coordinator exports use TypeScript, build first');
}

// Check memory exports
console.log('\n=== Memory Exports ===');
try {
  const memory = await import('./src/memory/index.js');
  console.log('Available exports:', Object.keys(memory));
} catch (err) {
  console.log('Note: Memory exports use TypeScript, build first');
}

// Check context exports
console.log('\n=== Context Exports ===');
try {
  const context = await import('./src/context/index.js');
  console.log('Available exports:', Object.keys(context));
} catch (err) {
  console.log('Note: Context exports use TypeScript, build first');
}

console.log('\n=== Verification Complete ===');
