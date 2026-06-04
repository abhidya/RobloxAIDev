# Studio MCP Troubleshooting

Use this when Studio opens a place file but `list_roblox_studios` still reports
an old or unrelated place. Player-height screenshots and Studio inspections are
not valid until MCP is attached to the intended place.

## Active-Place Recovery

1. Confirm the target file passed headless validation first.
2. Close unrelated Roblox Studio windows, especially old validation places.
3. Stop stale bridge processes:

```bash
pkill -f "StudioMCP --stdio"
```

4. Open only the target candidate:

```bash
open -a "RobloxStudio" /path/to/candidate.rbxl
```

5. Wait for Studio to finish loading, then call `list_roblox_studios`.
6. If more than one Studio is listed, call `set_active_studio` with the exact
   target id before running `execute_luau` or `screen_capture`.
7. If the target Studio process exists but MCP still only reports another place,
   restart the Studio MCP plugin/bridge and repeat from step 5.

## Stop Conditions

- Do not use heuristic active-place selection for final screenshots.
- Do not capture screenshots from a place whose name does not match the target.
- Treat stale MCP attachment as a visual-review blocker and record
  `verdict: "not_signed_off"` in `validate_playable_space_review`.

## Common Symptom

`ps` shows a Roblox Studio process with the target file path, but
`list_roblox_studios` only returns another place. This means the Studio process
is open, but the MCP bridge is still attached to the old instance. The fix is
bridge/process hygiene, not another headless merge.
