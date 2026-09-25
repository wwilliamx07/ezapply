import { describe, expect, it } from "vitest";
import { parseTexLog } from "../src/documents/tex/log.js";

describe("parseTexLog", () => {
  it("extracts file:line errors with the source excerpt", () => {
    const log = [
      "(./resume.tex",
      "./resume.tex:42: Undefined control sequence.",
      "l.42 \\resumeItm",
      "               {Built things}",
    ].join("\n");
    expect(parseTexLog(log)).toEqual([
      {
        severity: "error",
        kind: "error",
        message: "Undefined control sequence. [at: \\resumeItm]",
        file: "resume.tex",
        line: 42,
      },
    ]);
  });

  it("classifies missing files and fonts", () => {
    const log = [
      "! LaTeX Error: File `moderncv.cls' not found.",
      "",
      '! Package fontspec Error: The font "Garamond Premier" cannot be found.',
      "l.12 \\setmainfont{Garamond Premier}",
    ].join("\n");
    const d = parseTexLog(log);
    expect(d.map((x) => x.kind)).toEqual(["missing-file", "missing-font"]);
    expect(d[1]?.line).toBe(12);
  });

  it("reports overfull boxes, missing glyphs and multi-line package warnings", () => {
    const log = [
      "Overfull \\hbox (14.2pt too wide) in paragraph at lines 88--90",
      "Underfull \\hbox (badness 1200) in paragraph at lines 3--4",
      "Missing character: There is no ✓ (U+2713) in font [SourceSans3-Regular.otf]:mapping=tex-text;!",
      "Package hyperref Warning: Token not allowed in a PDF string (Unicode):",
      "(hyperref)                removing `\\\\' on input line 20.",
      "LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.",
    ].join("\n");
    const d = parseTexLog(log);
    expect(d).toContainEqual(
      expect.objectContaining({ kind: "overfull", line: 88, message: "Overfull \\hbox (14.2pt too wide)" }),
    );
    expect(d.find((x) => x.kind === "underfull")).toBeUndefined();
    expect(d).toContainEqual(expect.objectContaining({ kind: "missing-glyph" }));
    expect(d).toContainEqual(
      expect.objectContaining({
        kind: "warning",
        line: 20,
        message: expect.stringContaining("hyperref: Token not allowed"),
      }),
    );
    expect(d).toContainEqual(expect.objectContaining({ kind: "rerun", severity: "info" }));
  });

  it("orders errors before warnings", () => {
    const d = parseTexLog("Overfull \\hbox (1.0pt too wide) in paragraph at lines 1--1\n! Emergency stop.");
    expect(d[0]?.severity).toBe("error");
  });
});
