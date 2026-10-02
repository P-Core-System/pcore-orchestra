#!/usr/bin/env node
/**
 * Test Studio data layer modules - RED phase
 * This test should FAIL initially because the modules don't exist yet.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ ${message}`);
    failed++;
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    console.log(`  ✗ ${message} (expected to throw)`);
    failed++;
  } catch (e) {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

console.log('\n=== Studio Data Layer Tests (RED Phase) ===\n');

// Test 1: Studio directory structure exists
console.log('Test 1: Studio directory structure');
const studioDir = path.join(__dirname, '..', 'studio');
const studioSrcDir = path.join(studioDir, 'src');
const studioLibDir = path.join(studioSrcDir, 'lib');
const studioComponentsDir = path.join(studioSrcDir, 'components');
const studioHooksDir = path.join(studioSrcDir, 'hooks');

assert(fs.existsSync(studioDir), 'studio/ directory exists');
assert(fs.existsSync(studioSrcDir), 'studio/src/ directory exists');
assert(fs.existsSync(studioLibDir), 'studio/src/lib/ directory exists');
assert(fs.existsSync(studioComponentsDir), 'studio/src/components/ directory exists');
assert(fs.existsSync(studioHooksDir), 'studio/src/hooks/ directory exists');

// Test 2: package.json exists with correct dependencies
console.log('\nTest 2: Studio package.json');
const studioPkgPath = path.join(studioDir, 'package.json');
assert(fs.existsSync(studioPkgPath), 'studio/package.json exists');

if (fs.existsSync(studioPkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(studioPkgPath, 'utf8'));
  assert(pkg.name === 'pcore-orchestra-studio', 'package name is pcore-orchestra-studio');
  assert(pkg.dependencies?.react === '^19.3.0', 'react ^19.3.0');
  assert(pkg.dependencies?.['react-dom'] === '^19.3.0', 'react-dom ^19.3.0');
  assert(pkg.devDependencies?.typescript === '^7.0.2', 'typescript ^7.0.2');
  assert(pkg.devDependencies?.vite === '^8.3.2', 'vite ^8.3.2');
  assert(pkg.devDependencies?.tailwindcss === '^4.3.3', 'tailwindcss ^4.3.3');
  assert(pkg.devDependencies?.postcss === '^8.5.28', 'postcss ^8.5.28');
  assert(pkg.devDependencies?.autoprefixer === '^10.6.1', 'autoprefixer ^10.6.1');
  assert(pkg.devDependencies?.vitest === '^5.0.3', 'vitest ^5.0.3');
  assert(pkg.devDependencies?.['@testing-library/react'] === '^16.3.3', '@testing-library/react ^16.3.3');
  assert(pkg.devDependencies?.jsdom === '^30.1.1', 'jsdom ^30.1.1');
}

// Test 3: Vite config exists
console.log('\nTest 3: Vite config');
const viteConfigPath = path.join(studioDir, 'vite.config.ts');
assert(fs.existsSync(viteConfigPath), 'vite.config.ts exists');

// Test 4: TypeScript config exists
console.log('\nTest 4: TypeScript config');
const tsConfigPath = path.join(studioDir, 'tsconfig.json');
assert(fs.existsSync(tsConfigPath), 'tsconfig.json exists');

// Test 5: HTML entry point exists
console.log('\nTest 5: HTML entry point');
const htmlPath = path.join(studioDir, 'index.html');
assert(fs.existsSync(htmlPath), 'index.html exists');

// Test 6: Main entry point exists
console.log('\nTest 6: Main entry point');
const mainPath = path.join(studioSrcDir, 'main.tsx');
assert(fs.existsSync(mainPath), 'src/main.tsx exists');

// Test 7: App component exists
console.log('\nTest 7: App component');
const appPath = path.join(studioSrcDir, 'App.tsx');
assert(fs.existsSync(appPath), 'src/App.tsx exists');

// Test 8: Styles exist
console.log('\nTest 8: Styles');
const stylesPath = path.join(studioSrcDir, 'styles.css');
assert(fs.existsSync(stylesPath), 'src/styles.css exists');

// Test 9: Data layer modules - should exist now (GREEN)
console.log('\nTest 9: Data layer modules (GREEN phase)');
const typesPath = path.join(studioLibDir, 'types.ts');
const conductorRunsPath = path.join(studioLibDir, 'conductorRuns.ts');

assert(fs.existsSync(typesPath), 'types.ts exists');
assert(fs.existsSync(conductorRunsPath), 'conductorRuns.ts exists');

// Verify types.ts exports expected interfaces
if (fs.existsSync(typesPath)) {
  const typesContent = fs.readFileSync(typesPath, 'utf8');
  assert(typesContent.includes('export interface RunEntry'), 'RunEntry interface exported');
  assert(typesContent.includes('export interface RunDetail'), 'RunDetail interface exported');
  assert(typesContent.includes('export interface RunPhase'), 'RunPhase interface exported');
  assert(typesContent.includes('export interface RunGate'), 'RunGate interface exported');
  assert(typesContent.includes('export interface RunEvidence'), 'RunEvidence interface exported');
  assert(typesContent.includes('export interface RunHandoff'), 'RunHandoff interface exported');
  assert(typesContent.includes('export interface RunTokens'), 'RunTokens interface exported');
  assert(typesContent.includes('export type TicketState'), 'TicketState type exported');
  assert(typesContent.includes('TRIAGE'), 'TRIAGE state in TicketState');
  assert(typesContent.includes('COMPLETED'), 'COMPLETED state in TicketState');
}

// Verify conductorRuns.ts exports expected functions
if (fs.existsSync(conductorRunsPath)) {
  const conductorContent = fs.readFileSync(conductorRunsPath, 'utf8');
  assert(conductorContent.includes('export function resolveStateDirs'), 'resolveStateDirs exported');
  assert(conductorContent.includes('export function loadIndex'), 'loadIndex exported');
  assert(conductorContent.includes('export function loadRun'), 'loadRun exported');
  assert(conductorContent.includes('export function listRuns'), 'listRuns exported');
  assert(conductorContent.includes('export function findRunByKey'), 'findRunByKey exported');
  assert(conductorContent.includes('PCORE_STATE_DIR'), 'Uses PCORE_STATE_DIR env');
  assert(conductorContent.includes('resolveWorktreeConductorRunsDir'), 'Worktree path support function');
  assert(conductorContent.includes("'.pcore'") && conductorContent.includes("'state'") && conductorContent.includes("'conductor-runs'"), 'Worktree conductor-runs path components');
}

// Test 10: Public directory exists
console.log('\nTest 10: Public directory');
const publicDir = path.join(studioDir, 'public');
assert(fs.existsSync(publicDir), 'studio/public/ directory exists');

// Test 11: domainEvents.ts module
console.log('\nTest 11: domainEvents.ts data layer');
const domainEventsPath = path.join(studioLibDir, 'domainEvents.ts');
assert(fs.existsSync(domainEventsPath), 'domainEvents.ts exists');

if (fs.existsSync(domainEventsPath)) {
  const content = fs.readFileSync(domainEventsPath, 'utf8');
  assert(content.includes('export function loadEvents'), 'loadEvents exported');
  assert(content.includes('export function getEvidenceRuns'), 'getEvidenceRuns exported');
  assert(content.includes('export function getPhaseOutcomes'), 'getPhaseOutcomes exported');
  assert(content.includes('export function getReviewEvents'), 'getReviewEvents exported');
  assert(content.includes('export function getTicketEvents'), 'getTicketEvents exported');
  assert(content.includes('export function getWorkItems'), 'getWorkItems exported');
  assert(content.includes('export function getWorkItemsByRun'), 'getWorkItemsByRun exported');
  assert(content.includes('export function getAllTicketStates'), 'getAllTicketStates exported');
  assert(content.includes('PCORE_STATE_DIR'), 'Uses PCORE_STATE_DIR env');
  assert(content.includes('resolveDomainEventsPaths'), 'Worktree path support function');
  assert(content.includes("'.pcore'") && content.includes("'state'") && content.includes("'domain-events.json'"), 'Worktree domain-events path components');
  assert(content.includes('ticket.created') && content.includes('ticket.transitioned'), 'Handles ticket.created and ticket.transitioned');
  assert(content.includes('evidence.run') && content.includes('phase.outcome'), 'Handles evidence.run and phase.outcome');
  assert(content.includes('review.requested') && content.includes('review.resolved'), 'Handles review events');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);