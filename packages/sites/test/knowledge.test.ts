import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { SyntaxKind } from "typescript/unstable/ast";
import { createScanner } from "typescript/unstable/ast/scanner";
import { describe, expect, it } from "vitest";
import { SITES } from "../src/registry.js";

/**
 * Everything about a site is in its directory. Code elsewhere asks the registry (or a site's notes, reader or
 * definition through the lists), so no other package's source names a site: not in an identifier, a string or a
 * pattern. Comments may, as examples.
 */

const PACKAGES = join(import.meta.dirname, "..", "..");
const OTHERS = ["protocol", "engine", "companion", "cli", "extension", "ui"];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts") ? [p] : [];
  });
}

/** Tokens after which a `/` is division; after anything else it starts a regular expression. */
const ENDS_EXPRESSION = new Set([
  SyntaxKind.Identifier,
  SyntaxKind.NumericLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.CloseBraceToken,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateTail,
  SyntaxKind.ThisKeyword,
]);
const TRIVIA = new Set([
  SyntaxKind.WhitespaceTrivia,
  SyntaxKind.NewLineTrivia,
  SyntaxKind.SingleLineCommentTrivia,
  SyntaxKind.MultiLineCommentTrivia,
]);

/**
 * The source's tokens without its comments. The scanner alone, without the parser: it rescans where the parser would
 * (a template's continuation after its `}`, a regular expression after a `/`).
 */
function code(text: string): string {
  const scanner = createScanner(false, 0, text);
  const out: string[] = [];
  /** For each template expression open, the brace depth it opened at. */
  const templates: number[] = [];
  let depth = 0;
  let last = SyntaxKind.Unknown;
  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if (kind === SyntaxKind.OpenBraceToken) depth++;
    else if (kind === SyntaxKind.CloseBraceToken) {
      if (templates.at(-1) === depth) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templates.pop();
      } else depth--;
    } else if ((kind === SyntaxKind.SlashToken || kind === SyntaxKind.SlashEqualsToken) && !ENDS_EXPRESSION.has(last)) {
      kind = scanner.reScanSlashToken();
    }
    if (kind === SyntaxKind.TemplateHead) templates.push(depth);
    if (!TRIVIA.has(kind)) last = kind;
    if (kind !== SyntaxKind.SingleLineCommentTrivia && kind !== SyntaxKind.MultiLineCommentTrivia) {
      out.push(scanner.getTokenText());
    }
  }
  return out.join("");
}

describe("site knowledge", () => {
  it("reads code without its comments, strings and patterns kept", () => {
    const template = "`x $" + '{b} "y"`';
    const text = `const a = ${template}; // one\n/** two */ const c = /three/i.test(d) ? 4 / e : "five";`;
    expect(code(text)).toBe(`const a = ${template}; \n const c = /three/i.test(d) ? 4 / e : "five";`);
  });

  it("stays in the sites' directories: no other package's source names a site", () => {
    const names = new RegExp(`\\b(${SITES.map((s) => s.id).join("|")})\\b`, "i");
    const found: string[] = [];
    const files = OTHERS.flatMap((pkg) => sources(join(PACKAGES, pkg, "src")));
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      for (const line of code(readFileSync(file, "utf8")).split("\n")) {
        const m = names.exec(line);
        if (m) found.push(`${relative(PACKAGES, file).replaceAll("\\", "/")}: ${m[0]} in ${line.trim().slice(0, 80)}`);
      }
    }
    expect(found).toEqual([]);
  });
});
