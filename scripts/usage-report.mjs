#!/usr/bin/env node
// Token usage of a Claude Code session in the ezapply workspace, to measure changes that aim to cut it.
//
//   npm run usage:report                      the workspace's most recent session
//   npm run usage:report -- <transcript.jsonl>
//
// Every turn re-sends the whole conversation, so cost ≈ turns × context size. The report shows both, per
// user prompt (phase) and per tool, plus the session's subagents (their tokens are not in the main
// transcript).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const arg = process.argv[2];
if (arg === "--help" || arg === "-h") {
  process.stdout.write("Usage: npm run usage:report [-- <transcript.jsonl>]\n");
  process.exit(0);
}
const file = arg ?? latestWorkspaceTranscript();
const main = analyze(readJsonl(file));

const k = (n) => `${Math.round(n / 1000)}k`;
const M = (n) => `${(n / 1e6).toFixed(2)}M`;
const out = [];
out.push(`Session ${basename(file, ".jsonl")}`);
out.push(
  `  ${main.turns} turns · ${M(main.resent)} re-sent from cache · ${k(main.written)} written · ` +
    `${k(main.output)} output · context avg ${k(main.turns ? main.contextSum / main.turns : 0)}, peak ${k(main.peak)}`,
);

out.push("", "Phases (one per user prompt): turns, tokens sent, context at start → end");
for (const p of main.phases) {
  if (p.turns === 0) continue;
  out.push(
    `  ${String(p.turns).padStart(4)}  ${M(p.sent).padStart(7)}  ${k(p.start).padStart(5)} → ${k(p.end).padEnd(5)} ${p.prompt}`,
  );
}

out.push("", "Tools: calls, result size (chars; ~4 per token)");
for (const [name, t] of [...main.tools].sort((a, b) => b[1].calls - a[1].calls)) {
  out.push(
    `  ${String(t.calls).padStart(4)}  ${String(t.chars).padStart(8)}${t.images ? `  +${t.images} img` : ""}  ${name}`,
  );
}

const subDir = join(dirname(file), basename(file, ".jsonl"), "subagents");
if (existsSync(subDir)) {
  const subs = readdirSync(subDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ name: subagentName(join(subDir, f)), ...analyze(readJsonl(join(subDir, f))) }));
  if (subs.length) {
    const total = subs.reduce((s, a) => s + a.sent, 0);
    out.push("", `Subagents: ${subs.length}, ${M(total)} tokens sent in all`);
    for (const a of subs.sort((x, y) => y.sent - x.sent)) {
      out.push(
        `  ${String(a.turns).padStart(4)} turns  ${M(a.sent).padStart(7)}  start ${k(a.first)}, peak ${k(a.peak)}  ${a.name}`,
      );
    }
  }
}
process.stdout.write(`${out.join("\n")}\n`);

/** Turns, tokens and tool use of one transcript. */
function analyze(entries) {
  const seen = new Set();
  const toolNames = new Map();
  const tools = new Map();
  const phases = [];
  let phase = null;
  const r = { turns: 0, resent: 0, written: 0, output: 0, sent: 0, contextSum: 0, peak: 0, first: 0, phases, tools };
  for (const e of entries) {
    const m = e.message;
    if (!m) continue;
    if (e.type === "user" && !e.isMeta && isPrompt(m.content)) {
      phase = { prompt: promptText(m.content), turns: 0, sent: 0, start: 0, end: 0 };
      phases.push(phase);
    }
    if (e.type === "assistant" && m.usage && !seen.has(m.id)) {
      seen.add(m.id);
      const u = m.usage;
      const context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      if (context === 0) continue; // a synthetic message (an error or notice), not a model call
      r.turns++;
      r.resent += u.cache_read_input_tokens ?? 0;
      r.written += u.cache_creation_input_tokens ?? 0;
      r.output += u.output_tokens ?? 0;
      r.sent += context;
      r.contextSum += context;
      r.peak = Math.max(r.peak, context);
      r.first ||= context;
      if (phase) {
        phase.turns++;
        phase.sent += context;
        phase.start ||= context;
        phase.end = context;
      }
    }
    if (!Array.isArray(m.content)) continue;
    for (const c of m.content) {
      if (c.type === "tool_use") toolNames.set(c.id, c.name.replace(/^mcp__ezapply__/, ""));
      if (c.type === "tool_result") {
        const name = toolNames.get(c.tool_use_id) ?? "?";
        const parts = Array.isArray(c.content) ? c.content : [{ type: "text", text: String(c.content ?? "") }];
        const t = tools.get(name) ?? { calls: 0, chars: 0, images: 0 };
        t.calls++;
        t.chars += parts.reduce((s, p) => s + (p.type === "text" ? p.text.length : 0), 0);
        t.images += parts.filter((p) => p.type === "image").length;
        tools.set(name, t);
      }
    }
  }
  return r;
}

/** A prompt the user typed: text, not tool results, local command output or subagent notifications. */
function isPrompt(content) {
  const text = promptText(content);
  return text.length > 0 && !/^<(command-name|local-command-stdout|command-message|task-notification)>/.test(text);
}

function promptText(content) {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(" ")
        : "";
  return text.replace(/\s+/g, " ").trim().slice(0, 70);
}

/** The task the subagent was given (from its .meta.json), else its file name. */
function subagentName(path) {
  try {
    const meta = JSON.parse(readFileSync(path.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    return meta.description ?? basename(path, ".jsonl");
  } catch {
    return basename(path, ".jsonl");
  }
}

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/** Claude Code keeps a project's transcripts in ~/.claude/projects/<path with non-alphanumerics as "-">. */
function latestWorkspaceTranscript() {
  const config = join(homedir(), ".ezapply", "daemon.json");
  if (!existsSync(config)) fail("No ~/.ezapply/daemon.json: pass a transcript path.");
  const { workspace } = JSON.parse(readFileSync(config, "utf8"));
  const dir = join(homedir(), ".claude", "projects", workspace.replace(/[^A-Za-z0-9]/g, "-"));
  if (!existsSync(dir)) fail(`No Claude Code transcripts for ${workspace} (looked in ${dir}).`);
  const latest = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!latest) fail(`No transcripts in ${dir}.`);
  return latest;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
