import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFindings, passLabel, renderFindings, sealVerdict, withCounts } from "./proofBundle.js";

export const ASSET_DELIVERY_BASE_URL = "https://apis.roblox.com/asset-delivery-api/v1";
export const DEFAULT_API_KEY_ENV = "ROBLOX_OPEN_CLOUD_API_KEY";
export const DEFAULT_BEARER_ENV = "ROBLOX_OPEN_CLOUD_ACCESS_TOKEN";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "asset";
}

function numericId(value, label) {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`${label} must be a positive numeric id`);
  }
  return id;
}

function optionalVersion(value) {
  if (value == null || value === "") return null;
  return numericId(value, "version_number");
}

function normalizeBaseUrl(value) {
  return String(value || ASSET_DELIVERY_BASE_URL).replace(/\/+$/g, "");
}

function deliveryPath(assetId, versionNumber = null) {
  const base = `/assetId/${assetId}`;
  return versionNumber ? `${base}/version/${versionNumber}` : base;
}

function urlForRequest(baseUrl, assetId, versionNumber = null) {
  return `${normalizeBaseUrl(baseUrl)}${deliveryPath(assetId, versionNumber)}`;
}

function defaultQuarantineRoot({ project, slot }) {
  return `work/asset-acquisition/${slugify(project)}/${slugify(slot)}/quarantine`;
}

function outputStem(assetId, versionNumber = null) {
  return versionNumber ? `${assetId}-v${versionNumber}` : String(assetId);
}

export function buildAssetDeliveryRequest({
  project = "roblox-ai-game",
  slot = "unassigned.asset",
  assetId,
  versionNumber,
  quarantineRoot,
  baseUrl = ASSET_DELIVERY_BASE_URL,
  apiKeyEnv = DEFAULT_API_KEY_ENV,
  bearerEnv = DEFAULT_BEARER_ENV,
} = {}) {
  const id = numericId(assetId, "asset_id");
  const version = optionalVersion(versionNumber);
  const root = quarantineRoot || defaultQuarantineRoot({ project, slot });
  const stem = outputStem(id, version);
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return {
    schema: "roblox-asset-delivery-request/v1",
    project,
    slot,
    asset_id: id,
    version_number: version,
    endpoint: {
      name: "Asset Delivery",
      method: "GET",
      base_url: normalizedBaseUrl,
      path: deliveryPath(id, version),
      url: urlForRequest(normalizedBaseUrl, id, version),
      auth: ["api_key", "oauth_bearer"],
    },
    auth: {
      api_key_env: apiKeyEnv,
      bearer_env: bearerEnv,
      secret_policy: "read from environment or explicit runtime option; never write credential values to receipts",
    },
    outputs: {
      quarantine_root: root,
      asset_path: `${root}/assets/${stem}.rbxm`,
      receipt_path: `${root}/receipts/${stem}.delivery-receipt.json`,
    },
    policy: {
      asset_brain_metadata_only: true,
      quarantine_before_palette: true,
      receipt_must_be_redacted: true,
      followup_validation: ["roblox_validate_asset_delivery_receipt", "roblox_validate_fragment_manifest", "roblox_validate_batch_visual_gate"],
    },
  };
}

function redactAuthProof({ mode, sourceEnv, headerName, present }) {
  return {
    mode,
    source_env: sourceEnv,
    header: headerName,
    credential_present: present === true,
    redacted: true,
  };
}

// Resolve an Open Cloud credential into a sealed handle. The secret value is
// captured in the `apply` closure and never returned as data, so the only thing
// that crosses this seam is the redacted `proof`. This is the credential
// boundary: callers can authenticate a request (apply headers in place) and
// prove a credential was present, but cannot read the credential itself.
// Deliberately not exported — the authenticated request is the public seam.
function resolveDeliveryCredential({
  apiKey,
  bearerToken,
  apiKeyEnv = DEFAULT_API_KEY_ENV,
  bearerEnv = DEFAULT_BEARER_ENV,
  env = process.env,
} = {}) {
  const resolvedApiKey = apiKey || env?.[apiKeyEnv];
  if (resolvedApiKey) {
    return {
      apply(headers) {
        headers["x-api-key"] = resolvedApiKey;
      },
      proof: redactAuthProof({
        mode: "api_key",
        sourceEnv: apiKey ? "runtime_option" : apiKeyEnv,
        headerName: "x-api-key",
        present: true,
      }),
    };
  }
  const resolvedBearer = bearerToken || env?.[bearerEnv];
  if (resolvedBearer) {
    return {
      apply(headers) {
        headers.Authorization = `Bearer ${resolvedBearer}`;
      },
      proof: redactAuthProof({
        mode: "oauth_bearer",
        sourceEnv: bearerToken ? "runtime_option" : bearerEnv,
        headerName: "Authorization",
        present: true,
      }),
    };
  }
  return {
    apply() {},
    proof: redactAuthProof({
      mode: "missing",
      sourceEnv: `${apiKeyEnv}|${bearerEnv}`,
      headerName: null,
      present: false,
    }),
  };
}

function receiptBase(request, authProof, startedAt) {
  const req = asObject(request);
  return {
    schema: "roblox-asset-delivery-receipt/v1",
    project: req.project || "unknown",
    slot: req.slot || "unknown",
    asset_id: req.asset_id,
    version_number: req.version_number ?? null,
    started_at: startedAt,
    finished_at: null,
    status: "running",
    passed: false,
    request: {
      endpoint: req.endpoint?.name || "Asset Delivery",
      method: req.endpoint?.method || "GET",
      base_url: req.endpoint?.base_url || ASSET_DELIVERY_BASE_URL,
      path: req.endpoint?.path || deliveryPath(req.asset_id, req.version_number),
      url: req.endpoint?.url || urlForRequest(req.endpoint?.base_url, req.asset_id, req.version_number),
    },
    auth: authProof,
    http: null,
    output: {
      asset_path: req.outputs?.asset_path || "",
      receipt_path: req.outputs?.receipt_path || "",
      bytes: 0,
      sha256: null,
      content_type: null,
    },
    blockers: [],
  };
}

function limitText(text, max = 1000) {
  const value = String(text || "");
  return value.length <= max ? value : value.slice(0, max);
}

async function writeReceipt(receipt) {
  if (!receipt.output.receipt_path) return;
  await mkdir(path.dirname(receipt.output.receipt_path), { recursive: true });
  await writeFile(receipt.output.receipt_path, `${JSON.stringify(receipt, null, 2)}\n`);
}

export async function executeAssetDeliveryRequest(request, {
  apiKey,
  bearerToken,
  apiKeyEnv,
  bearerEnv,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 30000,
  writeReceiptFile = true,
} = {}) {
  const startedAt = new Date().toISOString();
  const credential = resolveDeliveryCredential({
    apiKey,
    bearerToken,
    apiKeyEnv: apiKeyEnv || request?.auth?.api_key_env || DEFAULT_API_KEY_ENV,
    bearerEnv: bearerEnv || request?.auth?.bearer_env || DEFAULT_BEARER_ENV,
    env,
  });
  const receipt = receiptBase(request, credential.proof, startedAt);

  if (!receipt.auth.credential_present) {
    receipt.status = "blocked";
    receipt.blockers.push("missing Roblox Open Cloud credential for Asset Delivery");
    receipt.finished_at = new Date().toISOString();
    if (writeReceiptFile) await writeReceipt(receipt);
    return receipt;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { accept: "application/octet-stream, application/json;q=0.8, */*;q=0.5" };
    credential.apply(headers);
    const response = await fetchImpl(receipt.request.url, {
      method: receipt.request.method,
      signal: controller.signal,
      headers,
    });
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    receipt.http = {
      status: response.status,
      ok: response.ok,
      content_type: contentType,
    };
    receipt.output.content_type = contentType;

    if (!response.ok) {
      receipt.status = "failed";
      receipt.blockers.push(`Asset Delivery returned HTTP ${response.status}`);
      receipt.http.body_preview = limitText(await response.text());
      return receipt;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    await mkdir(path.dirname(receipt.output.asset_path), { recursive: true });
    await writeFile(receipt.output.asset_path, bytes);
    receipt.output.bytes = bytes.length;
    receipt.output.sha256 = `sha256:${digest}`;
    receipt.status = bytes.length > 0 ? "passed" : "failed";
    receipt.passed = bytes.length > 0;
    if (bytes.length === 0) receipt.blockers.push("Asset Delivery returned zero bytes");
    return receipt;
  } catch (error) {
    receipt.status = "failed";
    receipt.blockers.push(error.name === "AbortError" ? `Asset Delivery timed out after ${timeoutMs}ms` : error.message);
    return receipt;
  } finally {
    clearTimeout(timer);
    receipt.finished_at = new Date().toISOString();
    if (writeReceiptFile) await writeReceipt(receipt);
  }
}

function metadataOnlyPath(value) {
  return !/^asset-brain\//.test(String(value || "")) && !/asset-brain[\\/]/i.test(String(value || ""));
}

function receiptHasSecretLeak(value) {
  const text = JSON.stringify(value || {});
  if (/Bearer\s+[A-Za-z0-9._~+/-]+/i.test(text)) return true;
  if (/"(?:api[_-]?key|token|secret|authorization)"\s*:\s*"(?!x-api-key|Authorization|runtime_option|ROBLOX_|redacted|null)[^"]{8,}"/i.test(text)) {
    return true;
  }
  return false;
}

export function validateAssetDeliveryReceipt(receipt, request = null) {
  const findings = createFindings();
  const { errors, warnings } = findings;
  const raw = asObject(receipt);
  const expected = asObject(request);

  if (raw.schema !== "roblox-asset-delivery-receipt/v1") {
    errors.push("receipt schema must be roblox-asset-delivery-receipt/v1");
  }
  const assetId = Number(raw.asset_id);
  if (!Number.isFinite(assetId) || assetId <= 0) errors.push("receipt needs a positive asset_id");
  if (expected.asset_id && Number(expected.asset_id) !== assetId) {
    errors.push(`receipt asset_id ${assetId} does not match request ${expected.asset_id}`);
  }
  if (raw.passed !== true || raw.status !== "passed") errors.push("asset delivery receipt must have passed=true and status='passed'");
  if (raw.http?.ok !== true || Number(raw.http?.status) < 200 || Number(raw.http?.status) >= 300) {
    errors.push("asset delivery HTTP status must be 2xx");
  }
  if (!raw.auth?.credential_present || !raw.auth?.redacted) {
    errors.push("receipt must prove an auth credential was present and redacted");
  }
  if (receiptHasSecretLeak(raw)) errors.push("receipt appears to contain an unredacted credential");
  if (!raw.output?.asset_path) errors.push("receipt output.asset_path is required");
  if (!metadataOnlyPath(raw.output?.asset_path)) {
    errors.push(`delivery bytes must stay out of asset brain paths: ${raw.output?.asset_path}`);
  }
  if (!raw.output?.receipt_path) warnings.push("receipt output.receipt_path should be recorded");
  if (!metadataOnlyPath(raw.output?.receipt_path)) {
    errors.push(`delivery receipt must stay out of asset brain paths: ${raw.output?.receipt_path}`);
  }
  if (!Number.isFinite(Number(raw.output?.bytes)) || Number(raw.output?.bytes) <= 0) {
    errors.push("receipt output.bytes must be greater than zero");
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(String(raw.output?.sha256 || ""))) {
    errors.push("receipt output.sha256 must be sha256:<64 hex chars>");
  }
  const blockers = Array.isArray(raw.blockers) ? raw.blockers : [];
  if (blockers.length) errors.push(`asset delivery blockers remain: ${blockers.join("; ")}`);

  return sealVerdict(findings, {
    schema: "roblox-asset-delivery-validation/v1",
    fields: {
      project: raw.project || expected.project || "unknown",
      slot: raw.slot || expected.slot || "unknown",
      asset_id: assetId || expected.asset_id || null,
    },
    counts: withCounts(findings, { bytes: Number(raw.output?.bytes || 0) }),
  });
}

export function formatAssetDeliveryRequest(request) {
  return [
    `Asset Delivery request for ${request.project} slot=${request.slot}`,
    `asset=${request.asset_id}${request.version_number ? ` version=${request.version_number}` : ""}`,
    `${request.endpoint.method} ${request.endpoint.url}`,
    `auth=${request.auth.api_key_env} or ${request.auth.bearer_env}`,
    `asset_path=${request.outputs.asset_path}`,
    `receipt_path=${request.outputs.receipt_path}`,
  ].join("\n");
}

export function formatAssetDeliveryValidation(result) {
  const lines = [
    `${passLabel(result.passed)} asset delivery '${result.project}' slot=${result.slot} asset=${result.asset_id}`,
    `bytes=${result.counts.bytes} warnings=${result.counts.warnings} errors=${result.counts.errors}`,
  ];
  lines.push(...renderFindings(result));
  return lines.join("\n");
}
