// Stands in for `claude -p --input-format stream-json --output-format stream-json` in the agent tests. Its output
// follows lines recorded from Claude Code (agent.test.ts pins the fields read). Each start appends its arguments
// to $STUB_LOG. Messages: anything → "echo: <text>"; "slow" (or one with "[slow]" in it) → a tool call that waits for an interrupt; "crash" →
// exits 3 mid-turn. With $STUB_FAIL_RESUME set, a --resume start fails before answering. A mode or model switch
// is appended to $STUB_LOG too; with $STUB_REFUSE_SWITCH set, it's refused as Claude Code refuses one.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (process.env.STUB_LOG) appendFileSync(process.env.STUB_LOG, `${JSON.stringify(args)}\n`);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const resume = flag("--resume");
const session = resume ?? flag("--session-id") ?? "no-session";
if (resume && process.env.STUB_FAIL_RESUME) {
  process.stderr.write(`No conversation found with session ID: ${resume}\n`);
  process.exit(1);
}

let cost = 0;
let slow = null;
const out = (o) => process.stdout.write(`${JSON.stringify({ ...o, session_id: session })}\n`);
const init = () =>
  out({
    type: "system",
    subtype: "init",
    cwd: process.cwd(),
    tools: ["Bash", "Read"],
    mcp_servers: [{ name: "ezapply", status: process.env.STUB_MCP_STATUS ?? "connected" }],
  });
const result = (extra = {}) => {
  cost += 0.01;
  out({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    total_cost_usd: cost,
    terminal_reason: "completed",
    queued_turn_count: 0,
    result: "",
    ...extra,
  });
};

createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request" && m.request?.subtype === "interrupt") {
    out({
      type: "control_response",
      response: { subtype: "success", request_id: m.request_id, response: { still_queued: [] } },
    });
    if (slow) {
      out({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: slow,
              is_error: true,
              content: "The user doesn't want to proceed with this tool use.",
            },
          ],
        },
        parent_tool_use_id: null,
      });
      slow = null;
      result({ subtype: "error_during_execution", is_error: true, terminal_reason: "aborted_tools" });
    }
    return;
  }
  if (m.type === "control_request" && ["set_permission_mode", "set_model"].includes(m.request?.subtype)) {
    if (process.env.STUB_LOG)
      appendFileSync(
        process.env.STUB_LOG,
        `${JSON.stringify(m.request)}
`,
      );
    out({
      type: "control_response",
      response: process.env.STUB_REFUSE_SWITCH
        ? { subtype: "error", request_id: m.request_id, error: "not allowed here", error_code: "refused" }
        : { subtype: "success", request_id: m.request_id },
    });
    return;
  }
  if (m.type !== "user") return;
  const text = typeof m.message.content === "string" ? m.message.content : "";
  init();
  out({ type: "user", message: { role: "user", content: text }, parent_tool_use_id: null, isReplay: true });
  if (text === "crash") {
    process.stderr.write("boom: something broke\n");
    process.exit(3);
  }
  if (text === "slow" || text.includes("[slow]")) {
    slow = "toolu_slow";
    out({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: slow, name: "mcp__ezapply__fill_fields", input: { fills: [] } }] },
      parent_tool_use_id: null,
    });
    return;
  }
  out({ type: "assistant", message: { content: [{ type: "text", text: `echo: ${text}` }] }, parent_tool_use_id: null });
  result();
});
