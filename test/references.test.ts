// The parts of references/CLAUDE.md's rules a test can check: links and anchors resolve,
// the index lists every page, and every MCP tool, site and skill has its place in the reference.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITES } from "../packages/sites/src/registry.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REFS = join(ROOT, "references");

function markdownIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "dist" ? [] : markdownIn(p);
    return e.name.endsWith(".md") ? [p] : [];
  });
}

/** Every Markdown file an agent working on the repo reads: the references, the todo and the CLAUDE.md files. */
function repoDocs(): string[] {
  const nested = markdownIn(join(ROOT, "packages")).filter(
    (p) => p.endsWith("CLAUDE.md") && !p.includes(`${join("cli", "templates")}`),
  );
  return [
    join(ROOT, "CLAUDE.md"),
    join(ROOT, "README.md"),
    ...markdownIn(REFS),
    ...markdownIn(join(ROOT, "todo")),
    ...nested,
  ];
}

const read = (p: string) => readFileSync(p, "utf8");
const withoutCode = (md: string) => md.replace(/^```[\s\S]*?^```/gm, "");

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered. */
function anchors(md: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const [, heading = ""] of withoutCode(md).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const text = heading.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "");
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

function links(md: string): string[] {
  const text = withoutCode(md).replace(/``[^`]*``|`[^`\n]*`/g, "");
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? "").filter((l) => !/^[a-z]+:/i.test(l));
}

describe("references", () => {
  it("has no broken links or anchors", () => {
    const broken: string[] = [];
    for (const file of repoDocs()) {
      for (const link of links(read(file))) {
        const [path = "", anchor] = link.split("#", 2);
        const target = path ? resolve(dirname(file), decodeURI(path)) : file;
        const where = `${relative(ROOT, file)}: ${link}`;
        let isFile = false;
        try {
          isFile = statSync(target).isFile();
          if (!isFile && !statSync(target).isDirectory()) throw new Error();
        } catch {
          broken.push(`${where} (no such file)`);
          continue;
        }
        if (anchor && isFile && target.endsWith(".md") && !anchors(read(target)).has(anchor)) {
          broken.push(`${where} (no such heading)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("lists every page in its index", () => {
    const index = read(join(REFS, "README.md"));
    const pages = markdownIn(REFS)
      .map((p) => relative(REFS, p).replaceAll("\\", "/"))
      .filter((p) => p !== "README.md" && p !== "CLAUDE.md");
    expect(pages.filter((p) => !index.includes(`](${p})`))).toEqual([]);
  });

  it("documents every MCP tool, and no tool that isn't registered", () => {
    const toolsDir = join(ROOT, "packages", "companion", "src", "mcp", "tools");
    const registered = readdirSync(toolsDir)
      .filter((f) => f.endsWith(".ts"))
      .flatMap((f) => [...read(join(toolsDir, f)).matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1] ?? ""));
    const documented = [...read(join(REFS, "mcp-tools.md")).matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1] ?? "");
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((t) => !documented.includes(t))).toEqual([]);
    expect(documented.filter((t) => !registered.includes(t))).toEqual([]);
  });

  it("gives every registry site its page, titled with its directory, and no other site a page", () => {
    const dir = join(REFS, "components", "sites");
    const pages = readdirSync(dir).map((f) => f.replace(/\.md$/, ""));
    expect(pages.sort()).toEqual(SITES.map((s) => s.id).sort());
    const title = (id: string) => read(join(dir, `${id}.md`)).split("\n")[0] ?? "";
    const titled = (id: string) => /^# /.test(title(id)) && title(id).includes(`(\`packages/sites/src/${id}/\`)`);
    expect(SITES.map((s) => s.id).filter((id) => !titled(id))).toEqual([]);
  });

  it("names every shipped skill on the workspace page", () => {
    const workspace = read(join(REFS, "components", "workspace.md"));
    const skills = readdirSync(join(ROOT, "packages", "cli", "templates", "skills"));
    expect(skills.filter((s) => !workspace.includes(s))).toEqual([]);
  });
});
