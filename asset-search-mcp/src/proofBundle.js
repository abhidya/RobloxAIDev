// Proof-bundle module.
//
// The one place that defines how a validation verdict is shaped and rendered
// across every gate: batch visual gate, world asset-family sweep, playable-space
// review, prop-hunt gate, publish policy, asset delivery, asset acquisition, and
// project template.
//
// Each gate still owns its domain checks — the evaluate loop is the gate's depth,
// not duplication. This module owns the shared envelope (passed + findings +
// counts) and the two render dialects, so a change to what a proof bundle looks
// like happens here instead of being copy-pasted across N gates.
//
// Surfaces:
//   collect  -> createFindings()         accumulate errors/warnings
//   verdict  -> sealVerdict(), withCounts() assemble the canonical envelope
//   present  -> passLabel(), renderFindings() render the two shared dialects

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// Collect surface. Accumulate findings, then read passed/errors/warnings.
// `errors` and `warnings` are the live arrays, so existing `errors.push(...)`
// call sites keep working after `const { errors, warnings } = createFindings()`.
export function createFindings() {
  const errors = [];
  const warnings = [];
  return {
    error(message) {
      errors.push(message);
      return this;
    },
    warn(message) {
      warnings.push(message);
      return this;
    },
    errorIf(condition, message) {
      if (condition) errors.push(message);
      return this;
    },
    warnIf(condition, message) {
      if (condition) warnings.push(message);
      return this;
    },
    errors,
    warnings,
    get passed() {
      return errors.length === 0;
    },
    get errorCount() {
      return errors.length;
    },
    get warnCount() {
      return warnings.length;
    },
  };
}

// Fold the standard error/warning tallies into a gate's domain counts.
export function withCounts(findings, extra = {}) {
  return { ...extra, errors: findings.errorCount, warnings: findings.warnCount };
}

// Verdict surface. Assemble the canonical proof-bundle envelope:
//   { schema?, passed, ...fields, errors, warnings, counts? }
export function sealVerdict(findings, { schema, fields = {}, counts } = {}) {
  const out = {};
  if (schema != null) out.schema = schema;
  out.passed = findings.passed;
  Object.assign(out, fields);
  out.errors = findings.errors;
  out.warnings = findings.warnings;
  if (counts !== undefined) out.counts = counts;
  return out;
}

export function passLabel(passed) {
  return passed ? "PASS" : "FAIL";
}

// Present surface. The two render dialects every gate formatter shared:
//   "bullets": blank line + "Errors:" header + "- item"  (validation/v1 family)
//   "inline":  "ERROR: item" / "WARN: item"              (studio gate family)
// Returns an array of lines so callers can spread it into their own headline.
export function renderFindings(result, { style = "bullets" } = {}) {
  const errors = asArray(result?.errors);
  const warnings = asArray(result?.warnings);
  const lines = [];
  if (style === "inline") {
    for (const error of errors) lines.push(`ERROR: ${error}`);
    for (const warning of warnings) lines.push(`WARN: ${warning}`);
    return lines;
  }
  if (errors.length) lines.push("", "Errors:", ...errors.map((error) => `- ${error}`));
  if (warnings.length) lines.push("", "Warnings:", ...warnings.map((warning) => `- ${warning}`));
  return lines;
}
