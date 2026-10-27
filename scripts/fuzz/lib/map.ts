import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";

/**
 * The UI map (`references/ui-map/`), read as the fuzzer's input: one page per screen or state, each with the
 * selector that tells it's on screen (its marker) and a table of its controls, each with where pressing it leads.
 * The page's format is in the map's README.
 */
export const MAP_DIR = join(import.meta.dirname, "..", "..", "..", "references", "ui-map");

/** Where a press leads. */
export type Target =
  | { kind: "page"; pages: string[] }
  /** The same screen, changed: a press that changes nothing and calls nothing is a dead control. */
  | { kind: "stays" }
  /** The same screen, possibly unchanged: the press may do nothing when the state is already what it asks. */
  | { kind: "same" }
  | { kind: "tab" }
  | { kind: "download" }
  | { kind: "files" };

export interface MapControl {
  label: string;
  /** Empty: always on its screen. Otherwise when it is, as the map says it. */
  when: string;
  /** A Playwright selector. */
  selector: string;
  /** Pressed by a triple click (selecting a line of text) rather than a click. */
  tripleClick: boolean;
  does: string;
  target: Target;
  /** Its line in the page's file, for reports. */
  line: number;
}

export interface MapPage {
  /** "panel/list": the section's directory and the file's name. */
  id: string;
  title: string;
  /** The file, relative to the repo. */
  file: string;
  marker: string;
  controls: MapControl[];
}

export interface UiMap {
  pages: Map<string, MapPage>;
  /** What's wrong with the map itself: a page without a marker, a link to no page, a table cell unread. */
  problems: string[];
}

export function readMap(dir = MAP_DIR): UiMap {
  const pages = new Map<string, MapPage>();
  const problems: string[] = [];
  for (const section of readdirSync(dir, { withFileTypes: true })) {
    if (!section.isDirectory()) continue;
    for (const f of readdirSync(join(dir, section.name))) {
      if (!f.endsWith(".md") || f === "README.md") continue;
      const id = `${section.name}/${f.slice(0, -3)}`;
      const page = parsePage(id, readFileSync(join(dir, section.name, f), "utf8"), problems);
      page.file = relative(join(dir, "..", ".."), join(dir, section.name, f)).replaceAll("\\", "/");
      pages.set(id, page);
    }
  }
  for (const p of pages.values())
    for (const c of p.controls)
      if (c.target.kind === "page")
        for (const t of c.target.pages)
          if (!pages.has(t)) problems.push(`${p.id}:${c.line}: "${c.label}" leads to ${t}, which has no page`);
  return { pages, problems };
}

export function parsePage(id: string, text: string, problems: string[] = []): MapPage {
  const lines = text.split(/\r?\n/);
  const title =
    lines
      .find((l) => l.startsWith("# "))
      ?.slice(2)
      .trim() ?? id;
  const markerLine = lines.find((l) => /^\*\*Marker:\*\*/.test(l));
  const marker = markerLine ? (/`([^`]+)`/.exec(markerLine)?.[1] ?? "") : "";
  if (!marker) problems.push(`${id}: no **Marker:** line with a selector`);
  const controls: MapControl[] = [];
  let header: string[] | null = null;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith("|")) {
      header = null;
      return;
    }
    const cells = splitRow(line);
    if (!header) {
      header = cells.map((c) => c.toLowerCase());
      return;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) return;
    const cell = (name: string) => cells[(header as string[]).indexOf(name)] ?? "";
    if (!(header as string[]).includes("selector")) return;
    const selectorCell = cell("selector");
    // A `|` in a table cell is written `\|`, even in code (GitHub splits the row on it otherwise).
    const selector = (/`([^`]+)`/.exec(selectorCell)?.[1] ?? "").replaceAll("\\|", "|");
    const target = targetOf(cell("leads to"), id);
    if (!selector || !target) {
      problems.push(`${id}:${i + 1}: a control needs a selector in backticks and a target (a link, stays, same, …)`);
      return;
    }
    controls.push({
      label: plain(cell("control")),
      when: plain(cell("when")),
      selector,
      tripleClick: /triple-click/i.test(selectorCell.replace(/`[^`]+`/, "")),
      does: plain(cell("does")),
      target,
      line: i + 1,
    });
  });
  return { id, title, file: id, marker, controls };
}

/** A table row's cells, with `|` inside backticks kept (a selector may hold one). */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let code = false;
  let prev = "";
  for (const ch of line.slice(1, line.endsWith("|") ? -1 : undefined)) {
    if (ch === "`") code = !code;
    const escaped = prev === "\\";
    prev = ch;
    if (ch === "|" && !code && !escaped) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function targetOf(cell: string, from: string): Target | null {
  const links = [...cell.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)].map((m) =>
    posix.normalize(posix.join(dirname(from), (m[1] as string).replace(/\.md$/, ""))),
  );
  if (links.length) return { kind: "page", pages: links };
  const word = plain(cell).toLowerCase();
  if (word.startsWith("stays")) return { kind: "stays" };
  if (word.startsWith("same")) return { kind: "same" };
  if (word.startsWith("a new tab")) return { kind: "tab" };
  if (word.startsWith("a download")) return { kind: "download" };
  if (word.startsWith("the file chooser")) return { kind: "files" };
  return null;
}

/** A cell's words without Markdown's marks. */
function plain(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}
