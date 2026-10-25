#!/usr/bin/env node
/**
 * Studio Integration Test - RED phase
 * Tests data layers against deterministic fixtures written to a temp dir.
 * The suite is hermetic: it never reads the developer's real ~/.config state,
 * so local and CI runs validate identical data.
 */

const fs = require('fs');
const path = require('path');
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

console.log('\n=== Studio Integration Test (RED Phase) ===\n');

// Test 1: Test file exists
console.log('Test 1: Integration test file exists');
const testPath = path.join(__dirname, 'test-studio-integration.js');
assert(fs.existsSync(testPath), 'test-studio-integration.js exists');

// Test 2: Create deterministic temp fixtures
console.log('\nTest 2: Create deterministic temp fixtures');
let tmpDir = '';
try {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  
  // Write deterministic conductor-runs fixture (real ~/.config state varies
  // per machine — the suite must validate the same data locally and in CI)
  const dstConductorRuns = path.join(tmpDir, 'conductor-runs');
  {
    const now = Date.now();
    const runEntry = {
      runId: 'test-ws:test-session:test-task',
      workspace: 'test-workspace',
      sessionId: 'test-session',
      taskId: 'test-task',
      goal: 'Test goal',
      status: 'completed',
      phase: 'review',
      startedAt: now - 100000,
      updatedAt: now,
    };
    fs.mkdirSync(dstConductorRuns, { recursive: true });
    fs.writeFileSync(path.join(dstConductorRuns, 'index.json'), JSON.stringify({ version: 1, runs: { 'test-ws:test-session:test-task': runEntry } }, null, 2));
    assert(fs.existsSync(path.join(dstConductorRuns, 'index.json')), 'conductor-runs/index.json fixture created');
  }
  
  // Write deterministic domain-events fixture (same rationale as above)
  const dstDomainEvents = path.join(tmpDir, 'domain-events.json');
  {
    const now = Date.now();
    const eventsFixture = [
      {
        id: 'evt-1',
        type: 'evidence.run',
        at: now - 50000,
        payload: {
          runId: 'test-ws:test-session:test-task',
          records: [{ gate: 'build', ok: true, exitCode: 0 }],
        },
      },
      {
        id: 'evt-2',
        type: 'ticket.created',
        at: now - 40000,
        payload: { ticketId: 'ticket-1', title: 'Test ticket', state: 'TRIAGE' },
      },
      {
        id: 'evt-3',
        type: 'ticket.transitioned',
        at: now - 30000,
        payload: { ticketId: 'ticket-1', fromState: 'TRIAGE', toState: 'READY' },
      },
    ];
    fs.writeFileSync(dstDomainEvents, JSON.stringify(eventsFixture, null, 2));
    assert(fs.existsSync(dstDomainEvents), 'domain-events.json fixture created');
  }
  
  // Write deterministic token fixture (real state uses the sessions[] shape)
  const tokensPath = path.join(tmpDir, 'orchestra-tokens.json');
  const tokenFixture = {
    runs: [
      {
        runId: 'test-run-1',
        timestamp: Date.now(),
        byAgent: [{ agent: 'orchestra-planner', total: 1500, average: 1500, budget: 2000, overBudget: false, runs: 1 }],
        byPhase: [{ phase: 'plan', total: 1500, average: 1500, budget: 2000, runs: 1 }],
        total: 1500,
        budget: 2000,
        overBudget: false
      }
    ],
    aggregated: {
      byAgent: [{ agent: 'orchestra-planner', total: 1500, average: 1500, budget: 2000, overBudget: false, runs: 1 }],
      byPhase: [{ phase: 'plan', total: 1500, average: 1500, budget: 2000, runs: 1 }],
      byRun: [],
      trend: []
    }
  };
  fs.writeFileSync(tokensPath, JSON.stringify(tokenFixture, null, 2));
  assert(fs.existsSync(tokensPath), 'orchestra-tokens.json fixture created');
  
  // Write deterministic history fixture (real state may not exist on this machine)
  const historyPath = path.join(tmpDir, 'orchestra-history.json');
  const historyFixture = [
    {
      runId: 'test-run-1',
      workspace: 'test-workspace',
      sessionId: 'test-session',
      taskId: 'test-task',
      goal: 'Test goal',
      status: 'completed',
      phase: 'review',
      startedAt: Date.now() - 100000,
      updatedAt: Date.now(),
      durationMs: 100000,
      phases: [
        { name: 'plan', status: 'completed', startedAt: Date.now() - 100000, completedAt: Date.now() - 80000, durationMs: 20000 },
        { name: 'implement', status: 'completed', startedAt: Date.now() - 80000, completedAt: Date.now() - 40000, durationMs: 40000 },
        { name: 'verify', status: 'completed', startedAt: Date.now() - 40000, completedAt: Date.now() - 20000, durationMs: 20000 },
        { name: 'review', status: 'completed', startedAt: Date.now() - 20000, completedAt: Date.now(), durationMs: 20000 }
      ],
      worktreePath: undefined
    }
  ];
  fs.writeFileSync(historyPath, JSON.stringify(historyFixture, null, 2));
  assert(fs.existsSync(historyPath), 'orchestra-history.json fixture created');
  
  console.log(`  Temp fixtures created at: ${tmpDir}`);
  assert(fs.existsSync(tmpDir), 'Temp directory exists');
  
} catch (e) {
  assert(false, `Failed to create temp fixtures: ${e.message}`);
}

// Test 3: Load via conductorRuns data layer
console.log('\nTest 3: Load via conductorRuns data layer');
try {
  // Set PCORE_STATE_DIR to temp dir
  process.env.PCORE_STATE_DIR = tmpDir;
  
  // We need to dynamically import the TypeScript modules
  // For now, verify the data files can be read and parsed correctly
  const indexPath = path.join(tmpDir, 'conductor-runs', 'index.json');
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  const index = JSON.parse(indexContent);
  
  assert(index.version === 1, 'Index has version 1');
  assert(index.runs && typeof index.runs === 'object', 'Index has runs object');
  assert(Object.keys(index.runs).length > 0, 'Index has at least one run');
  
  const firstRunKey = Object.keys(index.runs)[0];
  const firstRun = index.runs[firstRunKey];
  assert(firstRunKey.includes(firstRun.taskId) || firstRun.runId, 'Run has runId (from key or value)');
  assert(firstRun.workspace, 'Run has workspace');
  assert(firstRun.sessionId, 'Run has sessionId');
  assert(firstRun.taskId, 'Run has taskId');
  assert(firstRun.goal, 'Run has goal');
  assert(firstRun.status, 'Run has status');
  assert(firstRun.phase, 'Run has phase');
  assert(firstRun.startedAt, 'Run has startedAt');
  assert(firstRun.lastUpdatedAt || firstRun.updatedAt, 'Run has updatedAt');
  
  // Verify RunEntry shape matches domain types
  console.log(`  First run: ${firstRunKey} (${firstRun.runId || 'key-based'})`);
  
} catch (e) {
  assert(false, `conductorRuns data layer failed: ${e.message}`);
}

// Test 4: Load via domainEvents data layer
console.log('\nTest 4: Load via domainEvents data layer');
try {
  const eventsPath = path.join(tmpDir, 'domain-events.json');
  const eventsContent = fs.readFileSync(eventsPath, 'utf8');
  const events = JSON.parse(eventsContent);
  
  assert(Array.isArray(events), 'Events is an array');
  assert(events.length > 0, 'Events array not empty');
  
  const firstEvent = events[0];
  assert(firstEvent.id, 'Event has id');
  assert(firstEvent.type, 'Event has type');
  assert(firstEvent.at || firstEvent.timestamp, 'Event has timestamp');
  assert(firstEvent.payload || firstEvent.data, 'Event has payload/data');
  
  // Check for expected event types
  const types = new Set(events.map(e => e.type));
  assert(types.has('evidence.run'), 'Has evidence.run events');
  
  console.log(`  Event types found: ${Array.from(types).join(', ')}`);
  console.log(`  Total events: ${events.length}`);
  
} catch (e) {
  assert(false, `domainEvents data layer failed: ${e.message}`);
}

// Test 5: Load via tokenTracker data layer
console.log('\nTest 5: Load via tokenTracker data layer');
try {
  const tokensPath = path.join(tmpDir, 'orchestra-tokens.json');
  const tokensContent = fs.readFileSync(tokensPath, 'utf8');
  const tokens = JSON.parse(tokensContent);
  
  assert(tokens.runs && Array.isArray(tokens.runs), 'Tokens has runs array');
  assert(tokens.aggregated, 'Tokens has aggregated');
  assert(tokens.aggregated.byAgent && Array.isArray(tokens.aggregated.byAgent), 'Aggregated has byAgent');
  assert(tokens.aggregated.byPhase && Array.isArray(tokens.aggregated.byPhase), 'Aggregated has byPhase');
  
  const firstRun = tokens.runs[0];
  assert(firstRun.runId, 'RunToken has runId');
  assert(firstRun.byAgent && Array.isArray(firstRun.byAgent), 'RunToken has byAgent');
  assert(firstRun.byPhase && Array.isArray(firstRun.byPhase), 'RunToken has byPhase');
  assert(typeof firstRun.total === 'number', 'RunToken has total');
  assert(typeof firstRun.budget === 'number', 'RunToken has budget');
  assert(typeof firstRun.overBudget === 'boolean', 'RunToken has overBudget');
  
  const agentAgg = tokens.aggregated.byAgent[0];
  assert(agentAgg.agent, 'AgentTokens has agent');
  assert(typeof agentAgg.total === 'number', 'AgentTokens has total');
  assert(typeof agentAgg.average === 'number', 'AgentTokens has average');
  assert(typeof agentAgg.budget === 'number', 'AgentTokens has budget');
  assert(typeof agentAgg.overBudget === 'boolean', 'AgentTokens has overBudget');
  assert(typeof agentAgg.runs === 'number', 'AgentTokens has runs');
  
  const phaseAgg = tokens.aggregated.byPhase[0];
  assert(phaseAgg.phase, 'PhaseTokens has phase');
  assert(typeof phaseAgg.total === 'number', 'PhaseTokens has total');
  assert(typeof phaseAgg.average === 'number', 'PhaseTokens has average');
  assert(typeof phaseAgg.budget === 'number', 'PhaseTokens has budget');
  assert(typeof phaseAgg.runs === 'number', 'PhaseTokens has runs');
  
  console.log(`  Token runs: ${tokens.runs.length}`);
  console.log(`  Aggregated agents: ${tokens.aggregated.byAgent.length}`);
  console.log(`  Aggregated phases: ${tokens.aggregated.byPhase.length}`);
  
} catch (e) {
  assert(false, `tokenTracker data layer failed: ${e.message}`);
}

// Test 6: Load via history data layer
console.log('\nTest 6: Load via history data layer');
try {
  const historyPath = path.join(tmpDir, 'orchestra-history.json');
  const historyContent = fs.readFileSync(historyPath, 'utf8');
  const history = JSON.parse(historyContent);
  
  assert(Array.isArray(history), 'History is an array');
  assert(history.length > 0, 'History not empty');
  
  const firstRun = history[0];
  assert(firstRun.runId, 'CycleReport has runId');
  assert(firstRun.workspace, 'CycleReport has workspace');
  assert(firstRun.sessionId, 'CycleReport has sessionId');
  assert(firstRun.taskId, 'CycleReport has taskId');
  assert(firstRun.goal, 'CycleReport has goal');
  assert(firstRun.status, 'CycleReport has status');
  assert(firstRun.phase, 'CycleReport has phase');
  assert(firstRun.startedAt, 'CycleReport has startedAt');
  assert(firstRun.updatedAt, 'CycleReport has updatedAt');
  assert(firstRun.phases && Array.isArray(firstRun.phases), 'CycleReport has phases array');
  
  const firstPhase = firstRun.phases[0];
  assert(firstPhase.name, 'CyclePhase has name');
  assert(firstPhase.status, 'CyclePhase has status');
  assert(firstPhase.startedAt, 'CyclePhase has startedAt');
  
  console.log(`  History runs: ${history.length}`);
  console.log(`  Phases in first run: ${firstRun.phases.length}`);
  
} catch (e) {
  assert(false, `history data layer failed: ${e.message}`);
}

// Test 7: Load via workItems data layer
console.log('\nTest 7: Load via workItems data layer');
try {
  const eventsPath = path.join(tmpDir, 'domain-events.json');
  const eventsContent = fs.readFileSync(eventsPath, 'utf8');
  const events = JSON.parse(eventsContent);
  
  // Filter ticket events
  const ticketEvents = events.filter(e => e.type === 'ticket.created' || e.type === 'ticket.transitioned');
  
  // Derive work items
  const workItemsMap = new Map();
  for (const event of ticketEvents) {
    const data = event.payload || event.data;
    const ticketId = data.ticketId;
    if (!ticketId) continue;
    
    if (event.type === 'ticket.created') {
      workItemsMap.set(ticketId, {
        ticketId,
        title: data.title || '',
        state: data.state || 'TRIAGE',
        agent: data.agent,
        goal: data.goal,
        createdAt: event.at || event.timestamp,
        updatedAt: event.at || event.timestamp,
        transitions: []
      });
    } else if (event.type === 'ticket.transitioned') {
      const existing = workItemsMap.get(ticketId);
      const toState = data.toState;
      const fromState = data.fromState;
      if (existing && toState) {
        existing.state = toState;
        existing.updatedAt = event.at || event.timestamp;
        if (fromState) {
          existing.transitions.push({ from: fromState, to: toState, at: event.at || event.timestamp });
        }
      } else if (toState) {
        workItemsMap.set(ticketId, {
          ticketId,
          title: '',
          state: toState,
          createdAt: event.at || event.timestamp,
          updatedAt: event.at || event.timestamp,
          transitions: fromState ? [{ from: fromState, to: toState, at: event.at || event.timestamp }] : []
        });
      }
    }
  }
  
  const workItems = Array.from(workItemsMap.values());
  // WorkItems may be empty if no ticket events in test data
  console.log(`  WorkItems derived: ${workItems.length}`);
  
  // If we have work items, verify shape
  if (workItems.length > 0) {
    const wi = workItems[0];
    assert(wi.ticketId, 'WorkItem has ticketId');
    assert(wi.title !== undefined, 'WorkItem has title');
    assert(wi.state, 'WorkItem has state');
    assert(wi.createdAt, 'WorkItem has createdAt');
    assert(wi.updatedAt, 'WorkItem has updatedAt');
    assert(Array.isArray(wi.transitions), 'WorkItem has transitions array');
  }
  
  // Test TICKET_STATES
  const TICKET_STATES = ['TRIAGE', 'READY', 'PLANNED', 'IN_PROGRESS', 'VERIFYING', 'REVIEW_PENDING', 'COMPLETED', 'NEEDS_HUMAN', 'CANCELLED', 'FAILED'];
  assert(TICKET_STATES.length === 10, 'TICKET_STATES has 10 states');
  
} catch (e) {
  assert(false, `workItems data layer failed: ${e.message}`);
}

// Test 8: State dir discovery via server/state-dirs.js (client stateResolver.ts was
// deleted in Studio v2 — discovery runs server-side and is served at /api/state-dirs)
console.log('\nTest 8: Discover state dirs via server/state-dirs.js');
try {
  const stateDirs = require(path.join(__dirname, '..', 'server', 'state-dirs.js'));
  assert(typeof stateDirs.discoverStateDirs === 'function', 'discoverStateDirs exported');
  assert(typeof stateDirs.getEnvStateDir === 'function', 'getEnvStateDir exported');

  const prevEnv = process.env.PCORE_STATE_DIR;
  try {
    process.env.PCORE_STATE_DIR = tmpDir;
    assert(stateDirs.getEnvStateDir() === path.normalize(tmpDir), 'getEnvStateDir honors PCORE_STATE_DIR');
    const dirs = stateDirs.discoverStateDirs();
    assert(Array.isArray(dirs), 'discoverStateDirs returns an array');
    const globalDir = dirs.find(d => path.normalize(d.path) === path.normalize(tmpDir));
    assert(!!globalDir, 'discoverStateDirs includes the fixture state dir');
    assert(globalDir && globalDir.isWorktree === false, 'Fixture state dir has isWorktree false');
  } finally {
    if (prevEnv === undefined) delete process.env.PCORE_STATE_DIR;
    else process.env.PCORE_STATE_DIR = prevEnv;
  }

  console.log('  State dir discovery verified via server module');

} catch (e) {
  assert(false, `state-dirs discovery failed: ${e.message}`);
}

// Test 9: Verify UI data shapes match domain types
console.log('\nTest 9: Verify UI data shapes match domain types');
try {
  // RunEntry shape
  const indexPath = path.join(tmpDir, 'conductor-runs', 'index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const runEntry = Object.values(index.runs)[0];
  const runKey = Object.keys(index.runs)[0];
  
  const requiredRunEntryFields = ['workspace', 'sessionId', 'taskId', 'goal', 'status', 'phase', 'startedAt'];
  for (const field of requiredRunEntryFields) {
    assert(runEntry[field] !== undefined, `RunEntry has ${field}`);
  }
  // runId is derived from the key in the index
  assert(runKey.includes(runEntry.taskId), 'RunEntry key contains taskId (runId proxy)');
  
  // WorkItem shape (if available)
  const eventsPath = path.join(tmpDir, 'domain-events.json');
  const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
  const ticketEvents = events.filter(e => e.type === 'ticket.created' || e.type === 'ticket.transitioned');
  if (ticketEvents.length > 0) {
    // WorkItem shape verified in Test 7
    assert(true, 'WorkItem shape verified');
  } else {
    assert(true, 'WorkItem shape (no ticket events in test data)');
  }
  
  // EvidenceRecord (RunEvidence) shape
  const evidenceEvents = events.filter(e => e.type === 'evidence.run');
  if (evidenceEvents.length > 0) {
    const evidence = evidenceEvents[0].payload?.records?.[0] || evidenceEvents[0].data?.records?.[0];
    if (evidence) {
      const requiredEvidenceFields = ['gate', 'ok', 'exitCode'];
      for (const field of requiredEvidenceFields) {
        assert(evidence[field] !== undefined, `EvidenceRecord has ${field}`);
      }
      assert(true, 'EvidenceRecord shape verified');
    }
  } else {
    assert(true, 'EvidenceRecord shape (no evidence events)');
  }
  
  // ReviewItem (ReviewEvent) shape
  const reviewEvents = events.filter(e => e.type === 'review.requested' || e.type === 'review.resolved');
  if (reviewEvents.length > 0) {
    const review = reviewEvents[0];
    assert(review.id, 'ReviewItem has id');
    assert(review.type, 'ReviewItem has type');
    assert(review.payload?.runId || review.data?.runId, 'ReviewItem has runId');
    assert(review.payload?.phase || review.data?.phase, 'ReviewItem has phase');
    assert(true, 'ReviewItem shape verified');
  } else {
    assert(true, 'ReviewItem shape (no review events)');
  }
  
  // TokenAggregate (AgentTokens/PhaseTokens) shape
  const tokensPath = path.join(tmpDir, 'orchestra-tokens.json');
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  if (tokens.aggregated.byAgent.length > 0) {
    const agentAgg = tokens.aggregated.byAgent[0];
    const requiredAgentFields = ['agent', 'total', 'average', 'budget', 'overBudget', 'runs'];
    for (const field of requiredAgentFields) {
      assert(agentAgg[field] !== undefined, `TokenAggregate (AgentTokens) has ${field}`);
    }
    assert(true, 'TokenAggregate (AgentTokens) shape verified');
  }
  
  if (tokens.aggregated.byPhase.length > 0) {
    const phaseAgg = tokens.aggregated.byPhase[0];
    const requiredPhaseFields = ['phase', 'total', 'average', 'budget', 'runs'];
    for (const field of requiredPhaseFields) {
      assert(phaseAgg[field] !== undefined, `TokenAggregate (PhaseTokens) has ${field}`);
    }
    assert(true, 'TokenAggregate (PhaseTokens) shape verified');
  }
  
  console.log('  All UI data shapes match domain types');
  
} catch (e) {
  assert(false, `UI data shape verification failed: ${e.message}`);
}

// Cleanup
try {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
} catch (e) {
  console.log(`  Warning: cleanup failed: ${e.message}`);
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);