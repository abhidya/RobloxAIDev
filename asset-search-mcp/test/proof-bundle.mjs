import assert from "node:assert";
import {
  createFindings,
  passLabel,
  renderFindings,
  sealVerdict,
  withCounts,
} from "../src/proofBundle.js";

// --- collect surface ---------------------------------------------------------
{
  const findings = createFindings();
  assert.equal(findings.passed, true, "fresh findings pass");
  assert.equal(findings.errorCount, 0);
  assert.equal(findings.warnCount, 0);

  findings.error("boom");
  findings.warn("careful");
  findings.errorIf(true, "also boom");
  findings.errorIf(false, "never");
  findings.warnIf(true, "also careful");
  findings.warnIf(false, "never");

  assert.deepEqual(findings.errors, ["boom", "also boom"], "error/errorIf append in order");
  assert.deepEqual(findings.warnings, ["careful", "also careful"], "warn/warnIf append in order");
  assert.equal(findings.passed, false, "any error fails the verdict");
  assert.equal(findings.errorCount, 2);
  assert.equal(findings.warnCount, 2);

  // The exposed arrays are live, so existing `errors.push(...)` call sites work.
  const { errors, warnings } = findings;
  errors.push("pushed");
  warnings.push("pushed-warn");
  assert.equal(findings.errorCount, 3, "destructured errors array is the live array");
  assert.equal(findings.warnCount, 3, "destructured warnings array is the live array");
}

// --- withCounts --------------------------------------------------------------
{
  const findings = createFindings();
  findings.error("e1");
  findings.error("e2");
  findings.warn("w1");
  const counts = withCounts(findings, { files: 4 });
  assert.deepEqual(counts, { files: 4, errors: 2, warnings: 1 }, "withCounts folds tallies into domain counts");
}

// --- sealVerdict -------------------------------------------------------------
{
  const passing = sealVerdict(createFindings(), {
    schema: "demo/v1",
    fields: { project: "p", slot: "s" },
    counts: { files: 1 },
  });
  assert.equal(passing.schema, "demo/v1");
  assert.equal(passing.passed, true);
  assert.equal(passing.project, "p");
  assert.equal(passing.slot, "s");
  assert.deepEqual(passing.errors, []);
  assert.deepEqual(passing.warnings, []);
  assert.deepEqual(passing.counts, { files: 1 });

  const failing = createFindings();
  failing.error("bad");
  const sealed = sealVerdict(failing, { fields: { verdict: "fix" } });
  assert.equal(sealed.passed, false, "errors flip passed to false");
  assert.equal(sealed.verdict, "fix");
  assert.equal("schema" in sealed, false, "schema omitted when not provided");
  assert.equal("counts" in sealed, false, "counts omitted when not provided");
  assert.deepEqual(sealed.errors, ["bad"]);
}

// --- present surface ---------------------------------------------------------
{
  assert.equal(passLabel(true), "PASS");
  assert.equal(passLabel(false), "FAIL");

  const result = { errors: ["e1", "e2"], warnings: ["w1"] };

  const bullets = renderFindings(result);
  assert.deepEqual(
    bullets,
    ["", "Errors:", "- e1", "- e2", "", "Warnings:", "- w1"],
    "bullets dialect matches the validation/v1 family",
  );

  const inline = renderFindings(result, { style: "inline" });
  assert.deepEqual(
    inline,
    ["ERROR: e1", "ERROR: e2", "WARN: w1"],
    "inline dialect matches the studio gate family",
  );

  assert.deepEqual(renderFindings({ errors: [], warnings: [] }), [], "clean verdict renders nothing (bullets)");
  assert.deepEqual(renderFindings({}, { style: "inline" }), [], "missing arrays render nothing (inline)");
}

console.log("PROOF_BUNDLE_OK findings accumulator, verdict seal, count fold, and both render dialects");
