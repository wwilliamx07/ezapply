import { Fragment, type ReactNode } from "react";

/**
 * The agent's text as a little Markdown: paragraphs, bullet and numbered lists, headings, `code`, **bold**,
 * *italics*, fenced code. Built as React elements from the text, never as HTML, so nothing in the text (a
 * posting's words quoted back, an injection) can become markup. Links stay text: the panel opens nothing on its own.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++;
      blocks.push(<pre key={key++}>{body.join("\n")}</pre>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={key++} className="ez-md-heading">
          {inline(heading[1] ?? "")}
        </p>,
      );
      i++;
      continue;
    }
    const bullet = /^\s*[-*•]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? numbered : bullet).test(lines[i] ?? "")) {
        let item = (lines[i] ?? "").replace(ordered ? numbered : bullet, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i] ?? "")) item += ` ${(lines[i++] ?? "").trim()}`;
        items.push(item);
      }
      // biome-ignore lint/suspicious/noArrayIndexKey: a list's items are fixed once its text is
      const children = items.map((it, n) => <li key={n}>{inline(it)}</li>);
      blocks.push(ordered ? <ol key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() &&
      !/^(```|#{1,6}\s|\s*[-*•]\s|\s*\d+[.)]\s)/.test(lines[i] ?? "")
    ) {
      para.push((lines[i++] ?? "").trim());
    }
    blocks.push(<p key={key++}>{inline(para.join(" "))}</p>);
  }
  return <div className="ez-md">{blocks}</div>;
}

/** `code`, **bold**, *italics* and _italics_, as elements. */
export function inline(text: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    if (token.startsWith("`")) out.push(<code key={n++}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={n++}>{token.slice(2, -2)}</strong>);
    else out.push(<em key={n++}>{token.slice(1, -1)}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}
