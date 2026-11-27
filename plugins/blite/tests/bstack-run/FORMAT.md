# Observed `oc-lite run --format json` output

Probe: `oc-lite run -m openai/gpt-6-luna --format json --archived "say ok"`.
These are the three stdout lines, unmodified:

```jsonl
{"type":"step_start","timestamp":1795258317257,"sessionID":"ses_e02440e60ffeS2o5X7WzRGLo7L","part":{"id":"prt_1fdbbf9c9001rfBo5Xtw7kiIWp","sessionID":"ses_e02440e60ffeS2o5X7WzRGLo7L","messageID":"msg_1fdbbf2b1001MTxL09pOJRqzEc","type":"step-start","snapshot":"9e484197e293e304c440ab78a2d07588f6ca2dfe"}}
{"type":"text","timestamp":1795258317341,"sessionID":"ses_e02440e60ffeS2o5X7WzRGLo7L","part":{"id":"prt_1fdbbf9d1001hPkvvNFvxASCcO","sessionID":"ses_e02440e60ffeS2o5X7WzRGLo7L","messageID":"msg_1fdbbf2b1001MTxL09pOJRqzEc","type":"text","text":"ok","time":{"start":1795258317265,"end":1795258317341}}}
{"type":"step_finish","timestamp":1795258317372,"sessionID":"ses_e02440e60ffeS2o5X7WzRGLo7L","part":{"id":"prt_1fdbbfa3c001haYDa5nNcWDj0h","sessionID":"ses_e02440e60ffeS2o5X7WzRGLo7L","messageID":"msg_1fdbbf2b1001MTxL09pOJRqzEc","type":"step-finish","reason":"stop","snapshot":"9e484197e293e304c440ab78a2d07588f6ca2dfe","cost":0,"tokens":{"input":8804,"output":5,"reasoning":0,"cache":{"read":0,"write":0}}}}
```

A second archived Luna probe asked the worker to run `pwd` and finish with `ok`.
It emitted `step_start`, `tool_use` (with output in `part.state.output`),
`step_finish` (`tool-calls`), a new `step_start` with a different `messageID`,
`text`, then `step_finish` (`stop`). Selected unmodified stdout lines:

```jsonl
{"type":"step_finish","timestamp":1795258327256,"sessionID":"ses_e0243ea2affesb28XVfZA1mmYd","part":{"id":"prt_1fdbc20d8001N5TRdvVbNapz3j","sessionID":"ses_e0243ea2affesb28XVfZA1mmYd","messageID":"msg_1fdbc16b9001il4Q1WDp1EWN9d","type":"step-finish","reason":"tool-calls","snapshot":"3349b17f4b2c6575b08fb6af3942c719fd7b1f4e","cost":0,"tokens":{"input":6264,"output":17,"reasoning":0,"cache":{"read":2560,"write":0}}}}
{"type":"text","timestamp":1795258329125,"sessionID":"ses_e0243ea2affesb28XVfZA1mmYd","part":{"id":"prt_1fdbc27f8001bg7kmDRLVJvmCY","sessionID":"ses_e0243ea2affesb28XVfZA1mmYd","messageID":"msg_1fdbc20e1001vEgrnfeINqGe6D","type":"text","text":"ok","time":{"start":1795258329080,"end":1795258329125}}}
```

The wrapper reads the top-level `sessionID` and extracts `part.text` only from
`text` events in the final completed, non-tool step. Multiple final text
parts are separated by a blank line. Stdout is parsed in memory and not
persisted as a stream. Only failed and interrupted runs save a diagnostic
tail in `stderr.log` (at most 200 entries per stream, up to 1 KiB each).

With the session ID, OpenCode metadata records a shell-quoted `export_cmd`
(`oc-lite session export <sid>` with the default CLI). The worker session is
not archived.

## Fast routing

The launcher records the original model reference (including any `#variant`)
as `base_model`, the selected reference as `model`, and whether fast routing
changed the model as `fast`. The shipped `explore` model is already Luna Fast,
so `--fast` leaves it unchanged without warning. A request for an unmapped model, including
`zai-coding-plan/glm-5.4`, leaves the model unchanged and writes a stderr
warning. Plain `ask` inherits the parent selection, even with `BSTACK_FAST=1`.

In the live `run --role explore --fast --message "reply pong"` probe,
`meta.json` recorded `openai/gpt-6-luna-fast` and the worker replied `pong`.
Two subsequent `oc-lite run -s <sid> -m <model>` turns used standard Luna
and then fast Luna. The exported assistant messages had the respective model
IDs in the same session.

## Observed `claude -p --output-format json` output

Claude Code 2.1.323 emitted one JSON object for `--model haiku "say ok"`.
Relevant fields, with the other fields omitted:

```json
{"type":"result","result":"ok","is_error":false,"session_id":"eae030ef-6728-4f70-83bc-eaf39247d702","total_cost_usd":0.00280544}
```

The launcher parses the JSON object in memory. The answer and fields above
(except `type`) go to `meta.json` and `result.md`. Stdout contains the status header and answer.
`meta.json` also records the absolute native `transcript_path`, including
for `-w` sessions. A missing transcript is recorded as `null`; the wrapper
never disables Claude's native session persistence.
