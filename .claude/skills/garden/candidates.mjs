// Candidates for /garden: things that look unused or stale. A heuristic, so every hit is checked by hand before
// anything is deleted. Usage: node .claude/skills/garden/candidates.mjs [path prefix]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

const prefix = (process.argv[2] ?? "").replaceAll("\\", "/");
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 << 20 })
  .split("\0")
  .filter(Boolean);

const TEXT = /\.(ts|tsx|mjs|js|json|md|html|css|yaml|yml|tex|txt|toml)$/;
const CODE = /\.(ts|tsx|mjs|js)$/;
const SKIP = /(^|\/)(node_modules|dist)\/|package-lock\.json$|\/goldens?\//;
const texts = tracked.filter((f) => TEXT.test(f) && !SKIP.test(f));
const code = texts.filter((f) => CODE.test(f));
const read = (f) => readFileSync(f, "utf8");
const inScope = (f) => f.startsWith(prefix);

/** Comments with their line numbers. Skips `//` inside URLs; good enough for candidates. */
function comments(src) {
  const out = [];
  for (const m of src.matchAll(/\/\*[\s\S]*?\*\/|(?<![:"'`\\])\/\/[^\n]*/g)) {
    out.push({ text: m[0], line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|(?<![:"'`\\])\/\/[^\n]*/g, " ");

// Which files each identifier-like token appears in, comments left out.
const where = new Map();
const bodies = new Map();
for (const f of code) {
  const body = stripComments(read(f));
  bodies.set(f, body);
  for (const t of new Set(body.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
    if (!where.has(t)) where.set(t, new Set());
    where.get(t).add(f);
  }
}
const pathWords = new Set(tracked.flatMap((f) => f.split(/[/.]/)));
const known = (name) => where.has(name) || pathWords.has(name);

function section(title, lines) {
  console.log(`\n## ${title} (${lines.length})`);
  for (const l of lines) console.log(l);
}

// Exports nothing else uses: "unused" if their own file doesn't use them either.
const unused = [];
const localOnly = [];
for (const f of code.filter((f) => inScope(f) && /^packages\/[^/]+\/src\//.test(f) && !/\.test\./.test(f))) {
  const body = bodies.get(f);
  const names = [
    ...body.matchAll(
      /export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
    ),
  ].map((m) => m[1]);
  for (const m of body.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}(?!\s*from)/g)) {
    names.push(
      ...m[1]
        .split(",")
        .map((s) =>
          s
            .trim()
            .split(/\s+as\s+/)
            .pop(),
        )
        .filter(Boolean),
    );
  }
  for (const name of new Set(names)) {
    if ([...(where.get(name) ?? [])].some((g) => g !== f)) continue;
    const own = body.match(new RegExp(`(?<![\\w$])${name.replace("$", "\\$")}(?![\\w$])`, "g"))?.length ?? 0;
    (own > 1 ? localOnly : unused).push(`${f}: ${name}`);
  }
}
section("Exports nothing uses, not even their own file", unused);
section("Exports used only in their own file (drop the export)", localOnly);

// Tracked files whose name appears in no other tracked text file.
const ROOT_FILES =
  /^[^/]+$|(^|\/)(CLAUDE|README)\.md$|^references\/|^todo\/|package\.json$|tsconfig[^/]*\.json$|\.test\.tsx?$/;
const unreferenced = [];
for (const f of tracked.filter(
  (f) => inScope(f) && !ROOT_FILES.test(f) && !SKIP.test(f) && !/^\.(github|claude)\//.test(f),
)) {
  const name = basename(f);
  const stem = basename(f, extname(f));
  // Code is imported by its stem ("./panel.js"), anything else is named by its file name.
  const refs = CODE.test(f) ? [`/${stem}.js`, `/${stem}.mjs`, `/${stem}"`, `/${stem}'`, name] : [name];
  const named = texts.some((g) => g !== f && refs.some((r) => read(g).includes(r)));
  if (!named) unreferenced.push(f);
}
section("Tracked files nothing names", unreferenced);

// `names` in comments that no code, file or path uses.
const stale = [];
const history = [];
const HISTORY =
  /\b(used to|previously|formerly|no longer|originally|now (?:uses|is|does|we|it)|was (?:changed|renamed|moved|added|removed)|the old|legacy|for now|temporar(?:y|ily)|TODO|FIXME|XXX|HACK)\b|\b20\d\d-\d\d-\d\d\b|\b(?:PR|issue|commit) #?\w+/i;
for (const f of code.filter(inScope)) {
  for (const { text, line } of comments(read(f))) {
    for (const [, inner] of text.matchAll(/`([^`\n]+)`/g)) {
      const ident = inner.replace(/\(.*\)$/, "").match(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/);
      if (ident && inner.length > 2) {
        const parts = ident[0].split(".");
        if (!parts.every(known)) stale.push(`${f}:${line}: \`${inner}\``);
      } else if (!inner.startsWith(".") && /^[\w./-]+\.(md|ts|tsx|mjs|json|html|yaml)(#[\w-]+)?$/.test(inner)) {
        const path = inner.split("#")[0].replace(/^\.\//, "");
        if (!tracked.some((t) => t.endsWith(path))) stale.push(`${f}:${line}: \`${inner}\` (no such file)`);
      }
    }
    const lines = text.split("\n");
    const hit = lines.findIndex((l) => HISTORY.test(l));
    if (hit >= 0) history.push(`${f}:${line + hit}: ${lines[hit].trim().slice(0, 140)}`);
    if (/^\/\/\s*(?:(?:const|let|if|for|return|await|import|export|function)\b|[\w.]+\(.*\);\s*$)/.test(text)) {
      history.push(`${f}:${line}: (commented-out code) ${text.trim().slice(0, 120)}`);
    }
  }
}
section("Comment names that exist nowhere in code", stale);
section("Comments that read like history, TODOs, or commented-out code", history);

const ignored = execFileSync("git", ["ls-files", "-ci", "--exclude-standard"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && inScope(f));
section("Tracked files .gitignore matches", ignored);
