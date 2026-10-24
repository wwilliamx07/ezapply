import { describe, expect, it } from "vitest";
import {
  type AskSpec,
  askAnswerProblems,
  askSpecProblems,
  changeAgentPrefs,
  conversationKey,
  DEFAULT_AGENT_PREFS,
  effectiveSettings,
  postingConversation,
  readAgentPrefs,
} from "../src/panel.js";

const yesNo = [{ value: "Yes" }, { value: "No" }];

describe("ask_user's questions", () => {
  it("takes suggestions on any question, sensitive ones too, when they're one of the options", () => {
    const spec: AskSpec = {
      title: "Step 3",
      questions: [
        {
          id: "eeo",
          prompt: "Gender",
          type: "single",
          options: [{ value: "Woman" }, { value: "Man" }, { value: "Decline" }],
          proposed: "Decline",
          sensitive: true,
        },
        {
          id: "langs",
          prompt: "Languages",
          type: "multi",
          options: [{ value: "English" }, { value: "French" }],
          proposed: ["English", "Spanish"],
          allowOther: true,
        },
        { id: "why", prompt: "Why us?", type: "text", proposed: "Because…", multiline: true },
      ],
    };
    expect(askSpecProblems(spec)).toEqual([]);
  });

  it("refuses what a schema can't: no options, a suggestion off the list, one id twice, min over max", () => {
    expect(
      askSpecProblems({
        title: "T",
        questions: [
          { id: "a", prompt: "?", type: "single" },
          { id: "b", prompt: "?", type: "single", options: yesNo, proposed: "Maybe" },
          { id: "b", prompt: "?", type: "multi", options: yesNo, min: 2, max: 1 },
          { id: "c", prompt: "?", type: "text", options: yesNo },
          { id: "d", prompt: "?", type: "single", options: yesNo, proposed: ["Yes"] },
        ],
      }),
    ).toEqual([
      "a: a single question needs options",
      'b: the suggestion "Maybe" isn\'t one of the options',
      "b: the id is used twice",
      "b: min is more than max",
      "c: a text question has no options",
      "d: a single question's suggestion is one value",
    ]);
  });

  it("checks answers: required ones, values on the list unless Other, how many, and only questions asked", () => {
    const spec: AskSpec = {
      title: "T",
      questions: [
        { id: "one", prompt: "?", type: "single", options: yesNo },
        { id: "many", prompt: "?", type: "multi", options: yesNo, min: 1, max: 1 },
        { id: "opt", prompt: "?", type: "text", required: false, maxLength: 5, remember: { answerId: "opt" } },
      ],
    };
    expect(askAnswerProblems(spec, { one: { value: "Yes" }, many: { value: ["No"] }, opt: { skipped: true } })).toEqual(
      [],
    );
    expect(
      askAnswerProblems(spec, {
        one: { value: "Yes" },
        many: { value: ["No"] },
        opt: { value: "short", remember: true },
      }),
    ).toEqual([]);
    expect(
      askAnswerProblems(spec, {
        one: { value: "Maybe", other: true },
        many: { value: ["Yes", "No"] },
        opt: { value: "far too long" },
        extra: { value: "x" },
      }),
    ).toEqual([
      'one: this question has no "Other"',
      "many: choose at most 1",
      "opt: longer than 5",
      "extra: no such question",
    ]);
    expect(askAnswerProblems(spec, { many: { value: [] } })).toEqual([
      "one: an answer is needed",
      "many: an answer is needed",
    ]);
    // An empty choice is no answer, not a value off the list.
    expect(askAnswerProblems(spec, { one: { value: "" }, many: { value: ["No"] } })).toEqual([
      "one: an answer is needed",
    ]);
  });
});

describe("conversation keys", () => {
  it("names a posting's tailoring and filling conversations, and nothing else", () => {
    expect(conversationKey("2026-01-01_acme_dev", "fill")).toBe("2026-01-01_acme_dev/fill");
    expect(postingConversation("2026-01-01_acme_dev/tailor")).toEqual({
      postingId: "2026-01-01_acme_dev",
      part: "tailor",
    });
    for (const key of ["general", "p1", "p1/other", "../x/fill", "./fill", "a/b/fill", "p1/fill/"])
      expect(postingConversation(key)).toBeNull();
  });
});

describe("the agent settings", () => {
  const both = ["claude", "antigravity"] as const;

  it("keeps each agent's own mode, model and effort, and brings them back with it", () => {
    let p = changeAgentPrefs(DEFAULT_AGENT_PREFS, both, { effort: "high", model: "opus" });
    p = changeAgentPrefs(p, both, { agent: "antigravity" });
    // One never chosen starts at its defaults.
    expect(effectiveSettings(p, both)).toEqual({ agent: "antigravity", permissionMode: "dontAsk", effort: "medium" });
    p = changeAgentPrefs(p, both, { model: "model-b", permissionMode: "plan" });
    p = changeAgentPrefs(p, both, { agent: "claude" });
    expect(effectiveSettings(p, both)).toEqual({
      agent: "claude",
      permissionMode: "auto",
      model: "opus",
      effort: "high",
    });
    expect(effectiveSettings({ ...p, agent: "antigravity" }, both)).toMatchObject({
      model: "model-b",
      permissionMode: "plan",
    });
  });

  it("runs the first agent installed when the chosen one isn't, and falls back from what an agent can't take", () => {
    const p = {
      agent: "antigravity" as const,
      choices: {
        claude: { permissionMode: "plan" as const, model: "model-b", effort: "low" as const },
        antigravity: { permissionMode: "auto" as const, effort: "max" as const },
      },
    };
    expect(effectiveSettings(p, ["claude"])).toEqual({
      agent: "claude",
      permissionMode: "plan",
      model: "sonnet",
      effort: "low",
    });
    expect(effectiveSettings(p, both)).toEqual({ agent: "antigravity", permissionMode: "dontAsk", effort: "max" });
  });

  it("gives Codex every mode, its own default model, and an effort", () => {
    const installed = ["claude", "codex"] as const;
    let p = changeAgentPrefs(DEFAULT_AGENT_PREFS, installed, { agent: "codex" });
    expect(effectiveSettings(p, installed)).toEqual({ agent: "codex", permissionMode: "auto", effort: "medium" });
    p = changeAgentPrefs(p, installed, { permissionMode: "default", model: "gpt-x", effort: "max" });
    expect(effectiveSettings(p, installed)).toEqual({
      agent: "codex",
      permissionMode: "default",
      model: "gpt-x",
      effort: "max",
    });
    expect(readAgentPrefs(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it("reads stored settings field by field, so one an older build kept falls back alone", () => {
    expect(readAgentPrefs(undefined)).toEqual(DEFAULT_AGENT_PREFS);
    expect(
      readAgentPrefs({
        agent: "gone",
        choices: { claude: { permissionMode: "plan", model: "", effort: "huge" }, x: {} },
      }),
    ).toEqual({ agent: "claude", choices: { claude: { permissionMode: "plan", model: "sonnet", effort: "medium" } } });
  });
});
