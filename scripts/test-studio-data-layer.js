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
  assert(pkg.dependencies?.react === '^19.3.1', 'react ^19.3.1');
  assert(pkg.dependencies?.['react-dom'] === '^19.3.1', 'react-dom ^19.3.1');
  assert(pkg.devDependencies?.typescript === '^7.0.2', 'typescript ^7.0.2');
  assert(pkg.devDependencies?.vite === '^8.3.5', 'vite ^8.3.5');
  assert(pkg.devDependencies?.tailwindcss === '^4.3.3', 'tailwindcss ^4.3.3');
  assert(pkg.devDependencies?.postcss === '^8.5.31', 'postcss ^8.5.31');
  assert(pkg.devDependencies?.autoprefixer === '^10.6.1', 'autoprefixer ^10.6.1');
  assert(pkg.devDependencies?.vitest === '^5.0.5', 'vitest ^5.0.5');
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

// Test 12: tokenTracker.ts module
console.log('\nTest 12: tokenTracker.ts data layer');
const tokenTrackerPath = path.join(studioLibDir, 'tokenTracker.ts');
assert(fs.existsSync(tokenTrackerPath), 'tokenTracker.ts exists');

if (fs.existsSync(tokenTrackerPath)) {
  const content = fs.readFileSync(tokenTrackerPath, 'utf8');
  assert(content.includes('export function loadTokenState'), 'loadTokenState exported');
  assert(content.includes('export function getAggregatedTokens'), 'getAggregatedTokens exported');
  assert(content.includes('export function getSessionTokens'), 'getSessionTokens exported');
  assert(content.includes('export function getRunTokens'), 'getRunTokens exported');
  assert(content.includes('export function getOverBudgetAgents'), 'getOverBudgetAgents exported');
  assert(content.includes('export function getPhasesExceedingEstimate'), 'getPhasesExceedingEstimate exported');
  assert(content.includes('export function getTokenTrend'), 'getTokenTrend exported');
  assert(content.includes('PCORE_STATE_DIR'), 'Uses PCORE_STATE_DIR env');
  assert(content.includes('resolveTokensPaths'), 'Worktree path support function');
  assert(content.includes("'.pcore'") && content.includes("'state'") && content.includes("'orchestra-tokens.json'"), 'Worktree orchestra-tokens path components');
  assert(content.includes('computeAgentTokens') || content.includes('byAgent'), 'Computes byAgent aggregates');
  assert(content.includes('computePhaseTokens') || content.includes('byPhase'), 'Computes byPhase aggregates');
  assert(content.includes('computeTrend') || content.includes('trend'), 'Computes trend');
}

// Test 13: history.ts module
console.log('\nTest 13: history.ts data layer');
const historyPath = path.join(studioLibDir, 'history.ts');
assert(fs.existsSync(historyPath), 'history.ts exists');

if (fs.existsSync(historyPath)) {
  const content = fs.readFileSync(historyPath, 'utf8');
  assert(content.includes('export function loadHistory'), 'loadHistory exported');
  assert(content.includes('export function getRecentRuns'), 'getRecentRuns exported');
  assert(content.includes('export function getRunById'), 'getRunById exported');
  assert(content.includes('export function getRunByRunId'), 'getRunByRunId exported');
  assert(content.includes('export function getPhasesForRun'), 'getPhasesForRun exported');
  assert(content.includes('export function getCompletedRuns'), 'getCompletedRuns exported');
  assert(content.includes('export function getFailedRuns'), 'getFailedRuns exported');
  assert(content.includes('PCORE_STATE_DIR'), 'Uses PCORE_STATE_DIR env');
  assert(content.includes('resolveHistoryPaths'), 'Worktree path support function');
  assert(content.includes("'.pcore'") && content.includes("'state'") && content.includes("'orchestra-history.json'"), 'Worktree orchestra-history path components');
}

// Test 14: workItems.ts module
console.log('\nTest 14: workItems.ts data layer');
const workItemsPath = path.join(studioLibDir, 'workItems.ts');
assert(fs.existsSync(workItemsPath), 'workItems.ts exists');

if (fs.existsSync(workItemsPath)) {
  const content = fs.readFileSync(workItemsPath, 'utf8');
  assert(content.includes('export const TICKET_STATES'), 'TICKET_STATES exported');
  assert(content.includes('TRIAGE') && content.includes('COMPLETED'), 'All 10 states in TICKET_STATES');
  assert(content.includes('export function deriveWorkItems'), 'deriveWorkItems exported');
  assert(content.includes('export function buildBoardColumns'), 'buildBoardColumns exported');
  assert(content.includes('export function getBoardData'), 'getBoardData exported');
  assert(content.includes('export function getStateColor'), 'getStateColor exported');
  assert(content.includes('export function getStateOrder'), 'getStateOrder exported');
  // Verify exactly 10 states in TICKET_STATES array (before first interface/type after it)
  const ticketStatesSection = content.split('export const TICKET_STATES')[1]?.split('export ')[0] || '';
  const stateNames = ticketStatesSection.match(/'(TRIAGE|READY|PLANNED|IN_PROGRESS|VERIFYING|REVIEW_PENDING|COMPLETED|NEEDS_HUMAN|CANCELLED|FAILED)'/g) || [];
  assert(stateNames.length === 10, `TICKET_STATES has exactly 10 states (found ${stateNames.length})`);
}

// Test 15: WorkItem components
console.log('\nTest 15: WorkItem components');
const workItemBoardPath = path.join(studioComponentsDir, 'WorkItemBoard.tsx');
const workItemColumnPath = path.join(studioComponentsDir, 'WorkItemColumn.tsx');
const workItemCardPath = path.join(studioComponentsDir, 'WorkItemCard.tsx');

assert(fs.existsSync(workItemBoardPath), 'WorkItemBoard.tsx exists');
assert(fs.existsSync(workItemColumnPath), 'WorkItemColumn.tsx exists');
assert(fs.existsSync(workItemCardPath), 'WorkItemCard.tsx exists');

if (fs.existsSync(workItemBoardPath)) {
  const content = fs.readFileSync(workItemBoardPath, 'utf8');
  assert(content.includes('export function WorkItemBoard'), 'WorkItemBoard exported');
  assert(content.includes('buildBoardColumns'), 'Uses buildBoardColumns');
  assert(content.includes('TICKET_STATES'), 'Uses TICKET_STATES');
  assert(content.includes('workspace') && content.includes('session'), 'Has workspace/session filter dropdowns');
}

if (fs.existsSync(workItemColumnPath)) {
  const content = fs.readFileSync(workItemColumnPath, 'utf8');
  assert(content.includes('export function WorkItemColumn'), 'WorkItemColumn exported');
  assert(content.includes('WorkItemCard'), 'Uses WorkItemCard');
}

if (fs.existsSync(workItemCardPath)) {
  const content = fs.readFileSync(workItemCardPath, 'utf8');
  assert(content.includes('export function WorkItemCard'), 'WorkItemCard exported');
  assert(content.includes('ticketId') && content.includes('title'), 'Displays ticketId and title');
  assert(content.includes('agent') && content.includes('createdAt'), 'Displays agent and timestamps');
}

// Test 16: useRunPolling hook
console.log('\nTest 16: useRunPolling hook');
const useRunPollingPath = path.join(studioHooksDir, 'useRunPolling.ts');
assert(fs.existsSync(useRunPollingPath), 'useRunPolling.ts exists');

if (fs.existsSync(useRunPollingPath)) {
  const content = fs.readFileSync(useRunPollingPath, 'utf8');
  assert(content.includes('export function useRunPolling'), 'useRunPolling exported');
  assert(content.includes('listRuns') && content.includes('loadRun'), 'Uses conductorRuns functions');
  assert(content.includes('useState') && content.includes('useEffect'), 'Uses React hooks');
  assert(content.includes('intervalMs') && content.includes('setInterval'), 'Implements polling');
  assert(content.includes('refresh') && content.includes('selectRun'), 'Returns refresh and selectRun');
  assert(content.includes('StateDirInfo') || content.includes('stateDirs'), 'Returns stateDirs');
}

// Test 17: RunList component
console.log('\nTest 17: RunList component');
const runListPath = path.join(studioComponentsDir, 'RunList.tsx');
assert(fs.existsSync(runListPath), 'RunList.tsx exists');

if (fs.existsSync(runListPath)) {
  const content = fs.readFileSync(runListPath, 'utf8');
  assert(content.includes('export function RunList'), 'RunList exported');
  assert(content.includes('runs') && content.includes('onSelect'), 'Accepts runs and onSelect props');
  assert(content.includes('rounded-full') && content.includes('status'), 'Shows status indicators');
  assert(content.includes('goal') && content.includes('truncate'), 'Truncates goal text');
  assert(content.includes('formatDuration') || content.includes('duration'), 'Formats duration');
}

// Test 18: RunDetail component
console.log('\nTest 18: RunDetail component');
const runDetailPath = path.join(studioComponentsDir, 'RunDetail.tsx');
assert(fs.existsSync(runDetailPath), 'RunDetail.tsx exists');

if (fs.existsSync(runDetailPath)) {
  const content = fs.readFileSync(runDetailPath, 'utf8');
  assert(content.includes('export function RunDetail'), 'RunDetail exported');
  assert(content.includes('phases') && content.includes('gates'), 'Shows phases and gates');
  assert(content.includes('evidence') && content.includes('handoff'), 'Shows evidence and handoff');
  assert(content.includes('tokens') && content.includes('byAgent'), 'Shows token breakdown');
  assert(content.includes('formatTime') || content.includes('toLocaleString'), 'Formats timestamps');
}

// Test 19: RunViewer component
console.log('\nTest 19: RunViewer component');
const runViewerPath = path.join(studioComponentsDir, 'RunViewer.tsx');
assert(fs.existsSync(runViewerPath), 'RunViewer.tsx exists');

if (fs.existsSync(runViewerPath)) {
  const content = fs.readFileSync(runViewerPath, 'utf8');
  assert(content.includes('export function RunViewer'), 'RunViewer exported');
  assert(content.includes('useRunPolling'), 'Uses useRunPolling hook');
  assert(content.includes('RunList') && content.includes('RunDetail'), 'Composes RunList and RunDetail');
  assert(content.includes('stateDirs') && content.includes('selectedStateDir'), 'Has state dir selector');
}

// Test 20: EvidenceTable component
console.log('\nTest 20: EvidenceTable component');
const evidenceTablePath = path.join(studioComponentsDir, 'EvidenceTable.tsx');
assert(fs.existsSync(evidenceTablePath), 'EvidenceTable.tsx exists');

if (fs.existsSync(evidenceTablePath)) {
  const content = fs.readFileSync(evidenceTablePath, 'utf8');
  assert(content.includes('export function EvidenceTable'), 'EvidenceTable exported');
  assert(content.includes('evidence') && content.includes('onRowClick'), 'Accepts evidence and onRowClick props');
  assert(content.includes('search') && content.includes('setSearch'), 'Has search functionality');
  assert(content.includes('sortConfig') && content.includes('handleSort'), 'Has sorting');
  assert(content.includes('pagination') || content.includes('currentPage'), 'Has pagination');
  assert(content.includes('gate') && content.includes('ok') && content.includes('exitCode'), 'Shows all columns');
}

// Test 21: EvidenceDetail component
console.log('\nTest 21: EvidenceDetail component');
const evidenceDetailPath = path.join(studioComponentsDir, 'EvidenceDetail.tsx');
assert(fs.existsSync(evidenceDetailPath), 'EvidenceDetail.tsx exists');

if (fs.existsSync(evidenceDetailPath)) {
  const content = fs.readFileSync(evidenceDetailPath, 'utf8');
  assert(content.includes('export function EvidenceDetail'), 'EvidenceDetail exported');
  assert(content.includes('evidence') && content.includes('onClose'), 'Accepts evidence and onClose props');
  assert(content.includes('command') && content.includes('args'), 'Shows command and args');
  assert(content.includes('stdoutExcerpt') && content.includes('stderrExcerpt'), 'Shows stdout/stderr');
  assert(content.includes('details') && content.includes('exitCode'), 'Shows details and exit code');
  assert(content.includes('fixed inset-0') || content.includes('Modal'), 'Is a modal/drawer');
}

// Test 22: EvidenceVisualizer component
console.log('\nTest 22: EvidenceVisualizer component');
const evidenceVisualizerPath = path.join(studioComponentsDir, 'EvidenceVisualizer.tsx');
assert(fs.existsSync(evidenceVisualizerPath), 'EvidenceVisualizer.tsx exists');

if (fs.existsSync(evidenceVisualizerPath)) {
  const content = fs.readFileSync(evidenceVisualizerPath, 'utf8');
  assert(content.includes('export function EvidenceVisualizer'), 'EvidenceVisualizer exported');
  assert(content.includes('handoff') && content.includes('evidenceDigest'), 'Shows handoff digest');
  assert(content.includes('phase.outcome') || content.includes('block') || content.includes('needsHuman'), 'Shows phase blocks/needsHuman');
  assert(content.includes('EvidenceTable') && content.includes('EvidenceDetail'), 'Composes EvidenceTable and EvidenceDetail');
}

// Test 23: server/state-dirs.js - state discovery (moved server-side in Studio v2)
console.log('\nTest 23: server/state-dirs.js - worktree-aware state discovery');
try {
  const stateDirs = require(path.join(studioDir, '..', 'server', 'state-dirs.js'));
  assert(typeof stateDirs.discoverStateDirs === 'function', 'discoverStateDirs exported');
  assert(typeof stateDirs.getEnvStateDir === 'function', 'getEnvStateDir exported');

  const prevEnv = process.env.PCORE_STATE_DIR;
  const prevHome = process.env.HOME;
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-fakehome-'));
  const fakeState = path.join(fakeHome, 'state');
  fs.mkdirSync(fakeState, { recursive: true });
  try {
    process.env.PCORE_STATE_DIR = fakeState;
    assert(stateDirs.getEnvStateDir() === path.normalize(fakeState), 'PCORE_STATE_DIR env override honored');
    const dirs = stateDirs.discoverStateDirs();
    assert(Array.isArray(dirs) && dirs.some((d) => path.normalize(d.path) === path.normalize(fakeState) && d.isWorktree === false),
      'discoverStateDirs includes the env state dir as global');
    delete process.env.PCORE_STATE_DIR;
    process.env.HOME = fakeHome;
    assert(stateDirs.getEnvStateDir() === path.normalize(path.join(fakeHome, '.config', 'opencode', 'hooks', 'state')),
      'Default global state dir is ~/.config/opencode/hooks/state');
  } finally {
    if (prevEnv === undefined) delete process.env.PCORE_STATE_DIR;
    else process.env.PCORE_STATE_DIR = prevEnv;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }

  // Worktree patterns live in studio-api route + client contract
  const apiSource = fs.readFileSync(path.join(studioDir, '..', 'server', 'studio-api.js'), 'utf8');
  assert(apiSource.includes('"/api/state-dirs"'), 'studio-api serves GET /api/state-dirs');
  const clientApiSource = fs.readFileSync(path.join(studioLibDir, 'api.ts'), 'utf8');
  assert(clientApiSource.includes('fetchStateDirs') && clientApiSource.includes('/api/state-dirs'),
    'api.ts exposes fetchStateDirs against /api/state-dirs');
} catch (e) {
  assert(false, `server/state-dirs.js loadable: ${e.message}`);
}

// Test 24: StateContext.tsx - React context for state directory selection
console.log('\nTest 24: StateContext.tsx - React context');
const stateContextPath = path.join(studioLibDir, 'StateContext.tsx');
assert(fs.existsSync(stateContextPath), 'StateContext.tsx exists');

if (fs.existsSync(stateContextPath)) {
  const content = fs.readFileSync(stateContextPath, 'utf8');
  assert(content.includes('export function StateProvider'), 'StateProvider exported');
  assert(content.includes('export function useStateContext'), 'useStateContext exported');
  assert(content.includes('createContext'), 'Uses React createContext');
  assert(content.includes('useState'), 'Uses React useState');
  assert(content.includes('useEffect'), 'Uses React useEffect');
  assert(content.includes('stateDirs'), 'Provides stateDirs');
  assert(content.includes('selectedStateDir'), 'Provides selectedStateDir');
  assert(content.includes('setSelectedStateDir'), 'Provides setSelectedStateDir');
  assert(content.includes('refreshStateDirs'), 'Provides refreshStateDirs');
  assert(content.includes('fetchStateDirs'), 'Calls fetchStateDirs (server API) on mount');
}

// Test 25: App.tsx - StateProvider wired at root, sidebar has selector
console.log('\nTest 25: App.tsx - StateProvider and sidebar selector');
const appPath2 = path.join(studioSrcDir, 'App.tsx');
if (fs.existsSync(appPath2)) {
  const content = fs.readFileSync(appPath2, 'utf8');
  assert(content.includes('StateProvider'), 'Wraps with StateProvider');
  assert(content.includes('StateDirSelector') || content.includes('stateDirs'), 'Has state dir selector component');
  assert(content.includes('selectedStateDir'), 'Uses selectedStateDir');
  assert(content.includes('setSelectedStateDir'), 'Uses setSelectedStateDir');
  assert(content.includes('refreshStateDirs'), 'Has refresh button');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);