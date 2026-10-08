import { describe, expect, it } from "vitest";
import { diffPages, diffWords, normalizeWord, tokenize, tokenizePages } from "../src/textdiff.js";

describe("tokenize", () => {
  it("splits on whitespace and line breaks, keeping each word's place in the text", () => {
    const text = "Built  a\nparser in Rust";
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.text)).toEqual(["Built", "a", "parser", "in", "Rust"]);
    for (const t of tokens) expect(text.slice(t.start, t.end)).toBe(t.text);
  });

  it("joins a word broken by a hyphen at a line's end, spanning both parts", () => {
    const text = "years of experi-\nence with Go";
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.text)).toEqual(["years", "of", "experience", "with", "Go"]);
    expect(text.slice(tokens[2]?.start, tokens[2]?.end)).toBe("experi-\nence");
  });

  it("keeps a hyphen inside a line, and one before a capitalised word", () => {
    expect(tokenize("full-stack work").map((t) => t.text)).toEqual(["full-stack", "work"]);
    expect(tokenize("Python-\nDjango").map((t) => t.text)).toEqual(["Python-", "Django"]);
  });

  it("unfolds ligatures and unifies quotes and dashes", () => {
    expect(normalizeWord("ﬁle")).toBe("file");
    expect(normalizeWord("“fast”")).toBe('"fast"');
    expect(normalizeWord("2020–2024")).toBe("2020-2024");
    expect(normalizeWord("co­op")).toBe("coop");
  });
});

describe("diffWords", () => {
  it("finds nothing between equal lists", () => {
    expect(diffWords(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("gives a replacement as one hunk of removed and added words", () => {
    expect(diffWords(["led", "a", "team", "of", "four"], ["led", "a", "team", "of", "six", "engineers"])).toEqual([
      { oldStart: 4, oldEnd: 5, newStart: 4, newEnd: 6 },
    ]);
  });

  it("gives separate hunks for separate changes, insertions and removals alike", () => {
    const a = "one two three four five six".split(" ");
    const b = "one 2 three four six seven".split(" ");
    expect(diffWords(a, b)).toEqual([
      { oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2 },
      { oldStart: 4, oldEnd: 5, newStart: 4, newEnd: 4 },
      { oldStart: 6, oldEnd: 6, newStart: 5, newEnd: 6 },
    ]);
  });

  it("handles one side empty", () => {
    expect(diffWords([], ["a"])).toEqual([{ oldStart: 0, oldEnd: 0, newStart: 0, newEnd: 1 }]);
    expect(diffWords(["a"], [])).toEqual([{ oldStart: 0, oldEnd: 1, newStart: 0, newEnd: 0 }]);
  });

  it("matches the longest common run when words repeat", () => {
    const a = "a b a b a".split(" ");
    const b = "b a b a b".split(" ");
    const hunks = diffWords(a, b);
    const removed = hunks.reduce((n, h) => n + h.oldEnd - h.oldStart, 0);
    const added = hunks.reduce((n, h) => n + h.newEnd - h.newStart, 0);
    expect([removed, added]).toEqual([1, 1]);
  });

  it("compares two documents that share nothing as one change", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`);
    expect(diffWords(a, b)).toEqual([{ oldStart: 0, oldEnd: 3000, newStart: 0, newEnd: 3000 }]);
  });
});

describe("diffPages", () => {
  it("sees no change in text only reflowed or re-hyphenated", () => {
    const before = ["Designed and built a distributed cache in\nGo, cutting latency by 40% across ser-\nvices."];
    const after = ["Designed and built a distributed\ncache in Go, cutting latency by 40%\nacross services."];
    expect(diffPages(before, after)).toEqual([]);
  });

  it("describes each change with its page, the words removed and added, and the words before it", () => {
    const before = ["Jane Doe\nSoftware engineer", "Led a team of four engineers in Berlin"];
    const after = ["Jane Doe\nSoftware engineer", "Led a team of six engineers in Berlin and Paris"];
    expect(diffPages(before, after)).toEqual([
      { page: 2, removed: "four", added: "six", before: "Led a team of" },
      { page: 2, added: "and Paris", before: "of six engineers in Berlin" },
    ]);
  });

  it("places a change on the new version's page, with words before it from that page only", () => {
    expect(diffPages(["intro"], ["intro", "page two words"])).toEqual([
      { page: 2, added: "page two words", before: "" },
    ]);
    expect(diffPages(["a b c"], ["a c"])).toEqual([{ page: 1, removed: "b", before: "a" }]);
  });

  it("numbers tokens across pages", () => {
    expect(tokenizePages(["a b", "c"]).map((t) => [t.text, t.page])).toEqual([
      ["a", 0],
      ["b", 0],
      ["c", 1],
    ]);
  });
});
