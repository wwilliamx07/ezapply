export interface TexDiagnostic {
  severity: "error" | "warning" | "info";
  kind:
    | "error"
    | "missing-file"
    | "missing-font"
    | "missing-glyph"
    | "overfull"
    | "underfull"
    | "undefined-reference"
    | "rerun"
    | "warning";
  message: string;
  file?: string;
  line?: number;
}

const MAX_DIAGNOSTICS = 60;

/**
 * Pull the actionable parts out of a TeX log. Expects -file-line-error style and unwrapped lines
 * (max_print_line raised), but tolerates wrapped logs.
 */
export function parseTexLog(log: string): TexDiagnostic[] {
  const lines = log.split(/\r?\n/);
  const out: TexDiagnostic[] = [];
  const seen = new Set<string>();
  const push = (d: TexDiagnostic) => {
    const key = `${d.kind}|${d.file ?? ""}|${d.line ?? ""}|${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // ./resume.tex:42: Undefined control sequence.
    const fileLine = line.match(/^(.{1,260}?\.(?:tex|cls|sty|ltx)):(\d+): (.+)$/);
    if (fileLine?.[1] && fileLine[2] && fileLine[3]) {
      push({
        severity: "error",
        kind: classifyError(fileLine[3]),
        message: withContext(fileLine[3], lines, i),
        file: normalizeFile(fileLine[1]),
        line: Number(fileLine[2]),
      });
      continue;
    }

    // ! LaTeX Error: File `foo.sty' not found.   /   ! Package fontspec Error: ...
    const bang = line.match(/^! (.+)$/);
    if (bang?.[1]) {
      const lineNo = findLineMarker(lines, i);
      push({
        severity: "error",
        kind: classifyError(bang[1]),
        message: withContext(bang[1], lines, i),
        ...(lineNo !== undefined ? { line: lineNo } : {}),
      });
      continue;
    }

    const box = line.match(/^(Overfull|Underfull) \\([hv])box \((.+?)\)(?:.*?lines? (\d+)(?:--(\d+))?)?/);
    if (box?.[1] && box[3]) {
      const over = box[1] === "Overfull";
      if (!over && /badness 10000/.test(box[3]) === false) continue; // ignore mild underfull noise
      push({
        severity: over ? "warning" : "info",
        kind: over ? "overfull" : "underfull",
        message: `${box[1]} \\${box[2]}box (${box[3]})`,
        ...(box[4] ? { line: Number(box[4]) } : {}),
      });
      continue;
    }

    const missingChar = line.match(/^Missing character: There is no (.+?) in font (.+?)!?$/);
    if (missingChar?.[1] && missingChar[2]) {
      push({
        severity: "warning",
        kind: "missing-glyph",
        message: `Font ${missingChar[2]} has no glyph for ${missingChar[1]}`,
      });
      continue;
    }

    const warn = line.match(/^(LaTeX|Package (\S+)|Class (\S+)|LaTeX Font) Warning: (.+)$/);
    if (warn?.[4]) {
      const message = joinContinuation(warn[4], lines, i);
      const lineNo = message.match(/on input line (\d+)/)?.[1];
      push({
        severity: /Rerun/i.test(message) ? "info" : "warning",
        kind: /Rerun/i.test(message)
          ? "rerun"
          : /undefined/i.test(message) && /reference|citation/i.test(message)
            ? "undefined-reference"
            : /Font shape/i.test(message)
              ? "missing-font"
              : "warning",
        message: warn[2] ? `${warn[2]}: ${message}` : warn[3] ? `${warn[3]}: ${message}` : message,
        ...(lineNo ? { line: Number(lineNo) } : {}),
      });
    }
  }

  // Errors first, then warnings, then info; keep the list short enough to act on.
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, MAX_DIAGNOSTICS);
}

function classifyError(msg: string): TexDiagnostic["kind"] {
  if (/File `.+' not found|cannot be found|not found/i.test(msg) && /font/i.test(msg)) return "missing-font";
  if (/File `.+' not found/i.test(msg)) return "missing-file";
  return "error";
}

/** TeX prints "l.42 <source excerpt>" a few lines after an error. */
function findLineMarker(lines: string[], from: number): number | undefined {
  for (let j = from + 1; j < Math.min(lines.length, from + 12); j++) {
    const m = lines[j]?.match(/^l\.(\d+)/);
    if (m?.[1]) return Number(m[1]);
  }
  return undefined;
}

function withContext(msg: string, lines: string[], from: number): string {
  for (let j = from + 1; j < Math.min(lines.length, from + 12); j++) {
    const l = lines[j] ?? "";
    if (/^l\.\d+/.test(l)) return `${msg} [at: ${l.replace(/^l\.\d+\s*/, "").trim()}]`;
  }
  return msg;
}

/** Package warnings continue on lines indented under "(pkgname)". */
function joinContinuation(first: string, lines: string[], from: number): string {
  let msg = first;
  for (let j = from + 1; j < Math.min(lines.length, from + 6); j++) {
    const l = lines[j] ?? "";
    const cont = l.match(/^\([^)]*\)\s+(.*)$/);
    if (!cont?.[1]) break;
    msg += ` ${cont[1]}`;
  }
  return msg.trim();
}

function normalizeFile(f: string): string {
  return f.replace(/^\.\//, "");
}
