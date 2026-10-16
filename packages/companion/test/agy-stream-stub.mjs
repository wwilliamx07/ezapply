// Stands in for `agy --input-format stream-json --output-format stream-json` in the agent tests. Its output follows
// agy 1.4's stream as recorded live (antigravity.ts reads it). Each start appends its arguments and every message it
// gets to $STUB_LOG, and whether it was started with its auto-updater off. Messages: anything → an ezapply call,
// then "echo: <text>"; "deny" → a command its rules deny,
// which ends the turn; "slow" → a call that never ends (Stop kills the process). It names its conversation `agy-<n>`,
// or continues --conversation's.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
// `agy models`: its list as agy 1.4 prints it, ids and names made up.
if (args[0] === "models") {
  process.stdout.write("Fetching available models...\nmodel-a-high\tModel A (High)\nmodel-b\tModel B\n");
  process.exit(0);
}
const log = (o) => process.env.STUB_LOG && appendFileSync(process.env.STUB_LOG, `${JSON.stringify(o)}\n`);
log(args);
log({ autoUpdateOff: process.env.AGY_CLI_DISABLE_AUTO_UPDATE === "true" });
const i = args.indexOf("--conversation");
const conversation = i >= 0 ? args[i + 1] : `agy-${process.pid}`;
const out = (event, o) => process.stdout.write(`${JSON.stringify({ event, [event]: o })}\n`);
let step = 0;
// The whole conversation's, as agy reports it: not the turn's.
let seconds = 100;
const update = (o) => out("step_update", { conversation_id: conversation, step_index: step, ...o });
const result = (o) => {
  seconds += 2;
  out("result", { conversation_id: conversation, duration_seconds: seconds, num_turns: step, ...o });
};

process.stdout.write(
  `${JSON.stringify({ event: "init", conversation_id: conversation, init: { model: "stub", cwd: process.cwd(), tools: ["call_mcp_tool", "run_command", "view_file"] } })}\n`,
);

createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  log({ message: m });
  const text = m.message?.content ?? "";
  const word = text.split("\n").pop();
  step++;
  update({ state: "DONE", step_type: "user_input" });
  step++;
  if (word === "deny") {
    const info = { name: "run_command", parameters: { CommandLine: "git status" } };
    update({ state: "ACTIVE", step_type: "tool", tool_name: "run_command", tool_info: info });
    update({
      state: "ERROR",
      step_type: "tool",
      tool_info: { ...info, error: { type: "permission", message: "denied" } },
    });
    result({ status: "SUCCESS", response: "", denied_actions: [{ action: "command", display_name: "git status" }] });
    return;
  }
  const call = { ServerName: "ezapply", ToolName: "ask_user", Arguments: { title: "Work history" } };
  update({
    state: "ACTIVE",
    step_type: "tool",
    tool_name: "call_mcp_tool",
    tool_info: { name: "call_mcp_tool", parameters: call },
  });
  if (word === "slow") return;
  update({ state: "DONE", step_type: "tool", tool_info: { name: "call_mcp_tool", parameters: call, output: "{}" } });
  step++;
  const reply = `echo: ${word}`;
  update({ state: "ACTIVE", step_type: "agent_response", text_delta: reply.slice(0, 4) });
  update({ state: "DONE", step_type: "agent_response", text_delta: reply.slice(4) });
  result({ status: "SUCCESS", response: reply });
});
