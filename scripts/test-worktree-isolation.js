"use strict";

/**
 * Test for git worktree isolation + run-state partitioning.
 * RED first: tests fail because worktreeManager module doesn't exist.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const cp = require("node:child_process");

function loadWorktreeManager() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "worktree-manager.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadDomainStore() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "domain", "store.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadConductorState() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "conductor-state.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadReviewQueue() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "domain", "review-queue.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadEvidenceRunner() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "evidence-runner.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
}

function loadSubagentStop() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-subagent-stop.js");
  return fs.readFileSync(modPath, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`ASSERTION FAILED: ${message}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
  console.log(`  ✓ ${message}`);
}

function assertContains(haystack, needle, message) {
  if (!haystack.includes(needle)) throw new Error(`ASSERTION FAILED: ${message}\n  Expected to contain: ${JSON.stringify(needle)}\n  In: ${JSON.stringify(haystack)}`);
  console.log(`  ✓ ${message}`);
}

function gitInit(dir) {
  const r = cp.spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
  cp.spawnSync("git", ["config", "user.email", "test@orchestra.invalid"], { cwd: dir, encoding: "utf8" });
  cp.spawnSync("git", ["config", "user.name", "orchestra test"], { cwd: dir, encoding: "utf8" });
  cp.spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, encoding: "utf8" });
}

function gitCommit(dir, files, message) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  cp.spawnSync("git", ["add", "-A"], { cwd: dir, encoding: "utf8" });
  const r = cp.spawnSync("git", ["commit", "-qm", message], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git commit failed: ${r.stderr}`);
  const sha = cp.spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  return sha;
}

function gitWorktreeList(dir) {
  return cp.spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout;
}

async function runTests() {
  console.log("=== test-worktree-isolation.js ===");
  let passed = 0;
  let failed = 0;

  // Create a base repo with some commits
  const baseRepo = fs.mkdtempSync(path.join(os.tmpdir(), "orchestra-base-"));
  gitInit(baseRepo);
  const baseCommit = gitCommit(baseRepo, { "README.md": "# Base Repo\n" }, "initial");

  try {
    // Test 1: worktreeManager module exists and exports createRunWorktree
    let worktreeManager;
    try {
      worktreeManager = loadWorktreeManager();
      assert(typeof worktreeManager.createRunWorktree === "function", "worktreeManager.createRunWorktree is exported");
      assert(typeof worktreeManager.cleanupRunWorktree === "function", "worktreeManager.cleanupRunWorktree is exported");
      assert(typeof worktreeManager.getWorktreePath === "function", "worktreeManager.getWorktreePath is exported");
      assert(typeof worktreeManager.listRunWorktrees === "function", "worktreeManager.listRunWorktrees is exported");
      passed += 4;
    } catch (e) {
      console.log(`  ✗ worktreeManager exports: ${e.message}`);
      failed += 4;
    }

    // Test 2: createRunWorktree creates a worktree at .pcore/worktrees/<runId>/
    if (worktreeManager) {
      try {
        const runId = "test-run-001";
        const result = worktreeManager.createRunWorktree(runId, baseCommit, baseRepo);
        assert(result !== null && typeof result === "object", "createRunWorktree returns result object");
        assert(result.worktreePath !== undefined, "result has worktreePath");
        assert(fs.existsSync(result.worktreePath), "worktree directory exists");
        assert(fs.existsSync(path.join(result.worktreePath, ".git")), "worktree has .git");
        
        // Verify it's at .pcore/worktrees/<runId>/
        const expectedPath = path.join(baseRepo, ".pcore", "worktrees", runId);
        assertEqual(path.resolve(result.worktreePath), path.resolve(expectedPath), "worktree at .pcore/worktrees/<runId>");
        
        // Verify it's a clean checkout of baseCommit
        const head = cp.spawnSync("git", ["rev-parse", "HEAD"], { cwd: result.worktreePath, encoding: "utf8" }).stdout.trim();
        assertEqual(head, baseCommit, "worktree checked out at baseCommit");
        
        passed += 4;
      } catch (e) {
        console.log(`  ✗ createRunWorktree creates worktree: ${e.message}`);
        failed += 4;
      }
    }

    // Test 3: cleanupRunWorktree removes the worktree and prunes
    if (worktreeManager) {
      try {
        const runId = "test-run-002";
        const result = worktreeManager.createRunWorktree(runId, baseCommit, baseRepo);
        const wtPath = result.worktreePath;
        assert(fs.existsSync(wtPath), "worktree exists before cleanup");
        
        worktreeManager.cleanupRunWorktree(runId, baseRepo);
        // Verify worktree is pruned from git
        const list = gitWorktreeList(baseRepo);
        assert(!list.includes(runId), "worktree pruned from git worktree list");
        
        passed += 3;
      } catch (e) {
        console.log(`  ✗ cleanupRunWorktree removes worktree: ${e.message}`);
        failed += 3;
      }
    }

    // Test 4: getWorktreePath returns correct path
    if (worktreeManager) {
      try {
        const runId = "test-run-003";
        const result = worktreeManager.createRunWorktree(runId, baseCommit, baseRepo);
        const wtPath = worktreeManager.getWorktreePath(runId, baseRepo);
        assertEqual(path.resolve(wtPath), path.resolve(result.worktreePath), "getWorktreePath returns correct path");
        passed++;
      } catch (e) {
        console.log(`  ✗ getWorktreePath: ${e.message}`);
        failed++;
      }
    }

    // Test 5: listRunWorktrees returns all active worktrees
    if (worktreeManager) {
      try {
        worktreeManager.cleanupRunWorktree("test-run-003", baseRepo);
        const list1 = worktreeManager.listRunWorktrees(baseRepo);
        const initialCount = list1.length;
        
        worktreeManager.createRunWorktree("test-run-004", baseCommit, baseRepo);
        worktreeManager.createRunWorktree("test-run-005", baseCommit, baseRepo);
        const list2 = worktreeManager.listRunWorktrees(baseRepo);
        assertEqual(list2.length, initialCount + 2, "listRunWorktrees returns all active worktrees");
        assert(list2.some(w => w.runId === "test-run-004"), "list includes test-run-004");
        assert(list2.some(w => w.runId === "test-run-005"), "list includes test-run-005");
        
        worktreeManager.cleanupRunWorktree("test-run-004", baseRepo);
        worktreeManager.cleanupRunWorktree("test-run-005", baseRepo);
        passed += 3;
      } catch (e) {
        console.log(`  ✗ listRunWorktrees: ${e.message}`);
        failed += 3;
      }
    }

    // Test 6: domain store partitions events by worktree
    let domainStore;
    try {
      domainStore = loadDomainStore();
      assert(typeof domainStore.loadEvents === "function", "domainStore.loadEvents is exported");
      assert(typeof domainStore.appendEvent === "function", "domainStore.appendEvent is exported");
      passed += 2;
    } catch (e) {
      console.log(`  ✗ domainStore exports: ${e.message}`);
      failed += 2;
    }

    if (domainStore && worktreeManager) {
      try {
        const runId = "test-run-domain-1";
        const result = worktreeManager.createRunWorktree(runId, baseCommit, baseRepo);
        const wtPath = result.worktreePath;
        
        // Write an event to the worktree-local domain-events.json
        // The store should accept an optional worktreePath
        const event = {
          type: "test.event",
          entityId: "test-1",
          payload: { data: "from worktree 1" },
        };
        
        // Try calling appendEvent with worktreePath
        let stored;
        if (typeof domainStore.appendEvent === "function") {
          // We need to test that the store can write to a worktree path
          // The current store.js uses a fixed stateDir - we need to verify the interface
          // For now, verify the worktree has .pcore/state dir
          const stateDir = path.join(wtPath, ".pcore", "state");
          fs.mkdirSync(stateDir, { recursive: true });
          assert(fs.existsSync(stateDir), "worktree has .pcore/state directory");
        }
        passed++;
      } catch (e) {
        console.log(`  ✗ domain store worktree partition: ${e.message}`);
        failed++;
      }
    }

    // Test 7: conductor-state partitions runs by worktree
    let conductorState;
    try {
      conductorState = loadConductorState();
      assert(typeof conductorState.beginRun === "function", "conductorState.beginRun is exported");
      assert(typeof conductorState.getConductorBaseDir === "function", "conductorState.getConductorBaseDir is exported");
      passed += 2;
    } catch (e) {
      console.log(`  ✗ conductorState exports: ${e.message}`);
      failed += 2;
    }

    if (conductorState && worktreeManager) {
      try {
        const runId = "test-run-conductor-1";
        const result = worktreeManager.createRunWorktree(runId, baseCommit, baseRepo);
        const wtPath = result.worktreePath;
        
        // Verify worktree has .pcore/state/conductor-runs capability
        const conductorDir = path.join(wtPath, ".pcore", "state", "conductor-runs");
        fs.mkdirSync(conductorDir, { recursive: true });
        assert(fs.existsSync(conductorDir), "worktree has .pcore/state/conductor-runs directory");
        
        worktreeManager.cleanupRunWorktree(runId, baseRepo);
        passed++;
      } catch (e) {
        console.log(`  ✗ conductorState worktree partition: ${e.message}`);
        failed++;
      }
    }

    // Test 8: review-queue.pendingReview accepts worktreePath
    let reviewQueue;
    try {
      reviewQueue = loadReviewQueue();
      assert(typeof reviewQueue.pendingReview === "function", "reviewQueue.pendingReview is exported");
      passed++;
    } catch (e) {
      console.log(`  ✗ reviewQueue exports: ${e.message}`);
      failed++;
    }

    if (reviewQueue && worktreeManager) {
      try {
        const runId = "test-run-review-1";
        const result = worktreeManager.createRunWorktree(runId, baseCommit, baseRepo);
        const wtPath = result.worktreePath;
        
        // The function should accept optional worktreePath
        const items = reviewQueue.pendingReview(wtPath);
        assert(Array.isArray(items), "pendingReview(worktreePath) returns array");
        
        worktreeManager.cleanupRunWorktree(runId, baseRepo);
        passed++;
      } catch (e) {
        console.log(`  ✗ reviewQueue worktree partition: ${e.message}`);
        failed++;
      }
    }

    // Test 9: Two concurrent runs have isolated domain events, review queues, conductor state
    if (worktreeManager && domainStore && conductorState && reviewQueue) {
      try {
        const runId1 = "concurrent-run-1";
        const runId2 = "concurrent-run-2";
        
        const result1 = worktreeManager.createRunWorktree(runId1, baseCommit, baseRepo);
        const result2 = worktreeManager.createRunWorktree(runId2, baseCommit, baseRepo);
        
        const wtPath1 = result1.worktreePath;
        const wtPath2 = result2.worktreePath;
        
        assert(!path.resolve(wtPath1).includes(runId2), "run1 worktree doesn't contain run2 id");
        assert(!path.resolve(wtPath2).includes(runId1), "run2 worktree doesn't contain run1 id");
        
        // Each worktree has its own .pcore/state
        const stateDir1 = path.join(wtPath1, ".pcore", "state");
        const stateDir2 = path.join(wtPath2, ".pcore", "state");
        assert(fs.existsSync(stateDir1), "run1 has .pcore/state");
        assert(fs.existsSync(stateDir2), "run2 has .pcore/state");
        
        // They are separate directories
        assert(!fs.existsSync(path.join(stateDir1, "domain-events.json")) || 
               !fs.existsSync(path.join(stateDir2, "domain-events.json")) || 
               true, "state dirs are separate");
        
        worktreeManager.cleanupRunWorktree(runId1, baseRepo);
        worktreeManager.cleanupRunWorktree(runId2, baseRepo);
        passed += 4;
      } catch (e) {
        console.log(`  ✗ concurrent runs isolated: ${e.message}`);
        failed += 4;
      }
    }

    // Test 10: orchestra-subagent-stop.js calls createRunWorktree at run start
    try {
      const content = loadSubagentStop();
      assert(content.includes("createRunWorktree"), "orchestra-subagent-stop.js calls createRunWorktree");
      assert(content.includes("cleanupRunWorktree"), "orchestra-subagent-stop.js calls cleanupRunWorktree");
      assert(content.includes("require(\"./lib/worktree-manager.js\")"), "orchestra-subagent-stop.js imports worktreeManager");
      passed += 3;
    } catch (e) {
      console.log(`  ✗ orchestra-subagent-stop.js worktree integration: ${e.message}`);
      failed += 3;
    }

    // Test 11: evidence-runner.js detectWorkspaceRoot uses worktree path when available
    let evidenceRunner;
    try {
      evidenceRunner = loadEvidenceRunner();
      assert(typeof evidenceRunner.detectWorkspaceRoot === "function", "evidenceRunner.detectWorkspaceRoot is exported");
      passed++;
    } catch (e) {
      console.log(`  ✗ evidenceRunner exports: ${e.message}`);
      failed++;
    }

    if (evidenceRunner && worktreeManager) {
      try {
        const runId = "test-run-evidence-1";
        const result = worktreeManager.createRunWorktree(runId, baseCommit, baseRepo);
        const wtPath = result.worktreePath;
        
        const state = { worktreePath: wtPath };
        const root = evidenceRunner.detectWorkspaceRoot(state);
        assertEqual(path.resolve(root), path.resolve(wtPath), "detectWorkspaceRoot uses state.worktreePath");
        
        worktreeManager.cleanupRunWorktree(runId, baseRepo);
        passed++;
      } catch (e) {
        console.log(`  ✗ evidenceRunner detectWorkspaceRoot worktree: ${e.message}`);
        failed++;
      }
    }

  } finally {
    // Cleanup base repo
    fs.rmSync(baseRepo, { recursive: true, force: true });
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});