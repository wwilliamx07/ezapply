/**
 * A small PDF written by hand: Letter pages of Helvetica text, with links where asked. It stands in for a built
 * resume or cover letter, so the review page and onboarding's previews have something real for pdf.js to read, draw
 * and select.
 */
interface PdfPage {
  lines: string[];
  /** A link over a line (0-based): to a web or mail address, or to another page of the document (0-based). */
  links?: ({ line: number; url: string } | { line: number; page: number })[];
}

const TOP = 720;
const LEADING = 16;

export function makePdf(pages: PdfPage[]): Buffer {
  const objects: string[] = [];
  // An object's number is its place in the list, from 1.
  const add = (body: string) => objects.push(body);
  const catalog = add("");
  const tree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  // Each page's number first, so a link can point at a page after its own.
  const kids = pages.map(() => add(""));
  pages.forEach((page, n) => {
    const text = page.lines.map((l, i) => `BT /F1 11 Tf 72 ${TOP - i * LEADING} Td (${pdfString(l)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`);
    const annots = (page.links ?? []).map((l) => {
      const y = TOP - l.line * LEADING;
      const action =
        "url" in l ? `/A << /S /URI /URI (${pdfString(l.url)}) >>` : `/Dest [${kids[l.page]} 0 R /XYZ 0 792 null]`;
      return add(`<< /Type /Annot /Subtype /Link /Rect [72 ${y - 3} 320 ${y + 11}] /Border [0 0 0] ${action} >>`);
    });
    objects[(kids[n] as number) - 1] =
      `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R${
        annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(" ")}]` : ""
      } >>`;
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function pdfString(s: string): string {
  return s.replace(/[\\()]/g, (c) => `\\${c}`);
}
