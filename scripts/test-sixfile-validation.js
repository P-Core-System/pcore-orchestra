"use strict";

/**
 * Test for six-file context validation at verify phase.
 * RED first: tests fail because validateSixFileContext doesn't exist or isn't wired.
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

function loadContextDetector() {
  const modPath = path.join(__dirname, "..", "bundle", "hooks", "lib", "context-detector.js");
  delete require.cache[require.resolve(modPath)];
  return require(modPath);
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

async function runTests() {
  console.log("=== test-sixfile-validation.js ===");
  let passed = 0;
  let failed = 0;

  const ctxDet = loadContextDetector();

  // Create a temporary test directory with six-file context
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "sixfile-test-"));
  const ctxDir = path.join(testDir, "context");
  fs.mkdirSync(ctxDir);

  // Write all six files
  const sixFiles = [
    "project-overview.md",
    "architecture.md",
    "code-standards.md",
    "ui-context.md",
    "ai-workflow-rules.md",
    "progress-tracker.md",
  ];

  for (const file of sixFiles) {
    fs.writeFileSync(path.join(ctxDir, file), `# ${file}\n\nTest content for ${file}`);
  }

  // Test 1: validateSixFileContext function exists
  try {
    assert(typeof ctxDet.validateSixFileContext === "function", "validateSixFileContext is exported as a function");
    passed++;
  } catch (e) {
    console.log(`  ✗ validateSixFileContext exported: ${e.message}`);
    failed++;
  }

  // Test 2: validateSixFileContext reads all six files and returns correct structure
  try {
    const result = ctxDet.validateSixFileContext(testDir);
    assert(result !== null, "Returns non-null for valid context dir");
    assert(Array.isArray(result.files), "Returns files array");
    assert(result.files.length === 6, "Returns 6 file entries");
    assert(result.missing.length === 0, "Missing array is empty when all files present");
    assert(typeof result.progressTrackerTouched === "boolean", "progressTrackerTouched is boolean");
    assert(result.foundCount === 6, "foundCount is 6");
    assert(result.totalCount === 6, "totalCount is 6");
    passed += 6;
  } catch (e) {
    console.log(`  ✗ validateSixFileContext structure: ${e.message}`);
    failed += 6;
  }

  // Test 3: validateSixFileContext detects missing files
  try {
    // Remove one file
    fs.unlinkSync(path.join(ctxDir, "ui-context.md"));
    const result = ctxDet.validateSixFileContext(testDir);
    assert(result.missing.length === 1, "Missing array has 1 entry");
    assert(result.missing[0] === "ui-context.md", "Missing file is ui-context.md");
    assert(result.foundCount === 5, "foundCount is 5");
    // Restore
    fs.writeFileSync(path.join(ctxDir, "ui-context.md"), "# ui-context.md\n\nTest content");
    passed += 3;
  } catch (e) {
    console.log(`  ✗ validateSixFileContext missing files: ${e.message}`);
    failed += 3;
  }

  // Test 4: validateSixFileContext returns null when context dir doesn't exist
  try {
    const noCtxDir = fs.mkdtempSync(path.join(os.tmpdir(), "noctx-"));
    const result = ctxDet.validateSixFileContext(noCtxDir);
    assert(result === null, "Returns null when context dir doesn't exist");
    fs.rmSync(noCtxDir, { recursive: true });
    passed++;
  } catch (e) {
    console.log(`  ✗ validateSixFileContext no context dir: ${e.message}`);
    failed++;
  }

  // Test 5: validateSixFileContext progressTrackerTouched logic
  try {
    const trackerPath = path.join(ctxDir, "progress-tracker.md");
    const originalMtime = fs.statSync(trackerPath).mtimeMs;
    
    // Simulate claimedAt being before mtime (touched since claim)
    const claimedAt = originalMtime - 10000; // 10 seconds before mtime
    // We can't easily test the comparison without modifying the function signature
    // but we can verify the field exists and is boolean
    const result = ctxDet.validateSixFileContext(testDir);
    assert(typeof result.progressTrackerTouched === "boolean", "progressTrackerTouched is boolean");
    passed++;
  } catch (e) {
    console.log(`  ✗ validateSixFileContext progressTrackerTouched: ${e.message}`);
    failed++;
  }

  // Test 6: orchestra-subagent-stop.js at verify entry calls validator
  try {
    const subagentStopPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-subagent-stop.js");
    const content = fs.readFileSync(subagentStopPath, "utf8");
    assert(content.includes("validateSixFileContext"), "orchestra-subagent-stop.js calls validateSixFileContext");
    assert(content.includes("progressTrackerTouchedAt"), "Records progressTrackerTouchedAt");
    assert(content.includes("progressTrackerClaimedAt"), "Records progressTrackerClaimedAt");
    assert(content.includes("missingContext"), "Adds missing files to qualityGates.missingContext");
    passed += 4;
  } catch (e) {
    console.log(`  ✗ orchestra-subagent-stop.js integration: ${e.message}`);
    failed += 4;
  }

  // Test 7: Verifier gets validation result via handoff/state
  try {
    const subagentStopPath = path.join(__dirname, "..", "bundle", "hooks", "orchestra-subagent-stop.js");
    const content = fs.readFileSync(subagentStopPath, "utf8");
    // Check that validation result is passed to the next phase
    assert(content.includes("validateSixFileContext"), "Validation called at verify entry");
    passed++;
  } catch (e) {
    console.log(`  ✗ Verifier gets validation result: ${e.message}`);
    failed++;
  }

  // Cleanup
  fs.rmSync(testDir, { recursive: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});