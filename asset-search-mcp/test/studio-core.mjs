import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runMockStudioCaptureBatch,
  runStudioCaptureBatch,
} from "../src/studioMcpAdapterCore.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-core-"));

function textResponse(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

function imageResponse() {
  return { content: [{ type: "image", data: Buffer.from("fake-image-bytes").toString("base64") }] };
}

// In-process StudioMCP stand-in. screen_capture calls are counted so a specific
// capture can be made to fail without needing capture_id in the tool args.
function fakeStudioClient({ failScreenCaptureCalls = new Set() } = {}) {
  let screenCalls = 0;
  return {
    async callTool({ name }) {
      if (name === "list_roblox_studios") return textResponse([{ id: "studio-1", name: "TestPlace" }]);
      if (name === "set_active_studio") return textResponse({ ok: true });
      if (name === "execute_luau") return textResponse({ ok: true, placeName: "TestPlace", placeId: 42 });
      if (name === "screen_capture") {
        screenCalls += 1;
        if (failScreenCaptureCalls.has(screenCalls)) throw new Error("capture failed");
        return imageResponse();
      }
      return textResponse({});
    },
    async close() {},
  };
}

function samplePlan() {
  return {
    target_place: "TestPlace.rbxl",
    studio_preflight: {
      expected_place_names: ["TestPlace"],
      studio_mcp_tool: "execute_luau",
      code: "return { ok = true }",
    },
    capture_batch: {
      captures: [
        {
          capture_id: "c1",
          family_id: "fam1",
          expected_image_path: path.join(tempDir, "c1.png"),
          studio_mcp_steps: [
            { tool: "execute_luau", purpose: "camera", code: "return {}" },
            { tool: "screen_capture", purpose: "shot", suggested_output_path: path.join(tempDir, "c1.png") },
          ],
        },
        {
          capture_id: "c2",
          expected_image_path: path.join(tempDir, "c2.png"),
          studio_mcp_steps: [
            { tool: "screen_capture", purpose: "shot", suggested_output_path: path.join(tempDir, "c2.png") },
          ],
        },
      ],
    },
  };
}

try {
  // --- live driver: happy path --------------------------------------------
  {
    const run = await runStudioCaptureBatch(fakeStudioClient(), samplePlan(), {
      studioName: "TestPlace",
      transport: "studio_mcp_stdio",
    });
    assert.equal(run.preflight.passed, true, "preflight passes on a matching place");
    assert.equal(run.preflight.transport, "studio_mcp_stdio");
    assert.equal(run.captures.length, 2, "one run record per planned capture");
    assert.equal(run.captures[0].capture.capture_id, "c1");
    assert.equal(run.captures[0].passed, true);
    assert.ok(run.captures[0].response, "screen_capture response is retained for live captures");
    assert.equal(run.failedCaptureIds.size, 0, "no failed captures on the happy path");
    assert.ok(run.liveResponses.has("c1") && run.liveResponses.has("c2"), "live responses collected by capture id");

    const tools = run.executionLog.map((entry) => entry.tool);
    assert.ok(tools.includes("set_active_studio"), "driver selects the requested Studio instance");
    assert.ok(tools.includes("execute_luau"), "driver runs the Luau preflight/camera steps");
    assert.ok(tools.includes("screen_capture"), "driver calls screen_capture");

    const c1Shot = run.executionLog.find((e) => e.capture_id === "c1" && e.tool === "screen_capture");
    assert.equal(c1Shot.family_id, "fam1", "family-tagged captures carry family_id in the log");
    const c2Shot = run.executionLog.find((e) => e.capture_id === "c2" && e.tool === "screen_capture");
    assert.equal("family_id" in c2Shot, false, "untagged captures omit family_id (batch gate shape)");

    assert.ok((await fs.stat(path.join(tempDir, "c1.png"))).size > 0, "screenshot bytes written from image content");
  }

  // --- live driver: a capture fails ---------------------------------------
  {
    const run = await runStudioCaptureBatch(
      fakeStudioClient({ failScreenCaptureCalls: new Set([2]) }),
      samplePlan(),
      { studioName: "TestPlace" },
    );
    assert.equal(run.captures[0].passed, true, "c1 still passes");
    assert.equal(run.captures[1].passed, false, "c2 fails when its screen_capture throws");
    assert.ok(run.failedCaptureIds.has("c2"), "failed capture id is recorded");
    assert.ok(!run.liveResponses.has("c2"), "no live response for the failed capture");
  }

  // --- mock driver: matching place ----------------------------------------
  {
    const run = runMockStudioCaptureBatch(samplePlan(), {});
    assert.equal(run.preflight.passed, true);
    assert.equal(run.preflight.transport, "mock");
    assert.equal(run.executionLog[0].sequence, 0, "mock preflight log is the first entry");
    assert.equal(run.captures.length, 2);
    assert.equal(run.captures[0].response, null, "mock captures carry no live response");
  }

  // --- mock driver: requested capture failure -----------------------------
  {
    const run = runMockStudioCaptureBatch(samplePlan(), { failCaptures: ["c1"] });
    assert.equal(run.captures[0].passed, false, "failCaptures marks the capture failed");
    assert.ok(run.failedCaptureIds.has("c1"));
    assert.equal(run.captures[1].passed, true);
  }

  // --- mock driver: active-place mismatch stops the batch -----------------
  {
    const run = runMockStudioCaptureBatch(samplePlan(), { activePlaceName: "WrongPlace.rbxl" });
    assert.equal(run.preflight.passed, false, "mismatched place fails preflight");
    assert.equal(run.captures.length, 0, "no captures run when preflight fails");
  }
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("STUDIO_CORE_OK capture driver: live + mock preflight, serial captures, screenshot writes, failure tracking");
