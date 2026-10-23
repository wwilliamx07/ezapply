import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { stringify } from "yaml";
import type { Services } from "../services.js";
import type { TemplateKind } from "../templates/service.js";
import { exists } from "../util/fs.js";
import type { MergeInput } from "./pdf/toolkit.js";
import { pdfCompress, pdfInfo } from "./pdf/toolkit.js";

/** The section of notes.md the application requirements go under (EZAPPLY.md). */
const REQUIREMENTS = /^##\s+Application requirements\s*$/m;

/** Each document's file in the posting folder. */
export const DOCUMENT_FILE: Record<TemplateKind, string> = { resume: "resume.tex", cover: "cover.tex" };

/**
 * Set a posting's resume or cover letter up and hand back what writing it draws on, in one call. The skills had the
 * agent read the posting, its notes, the profile, the claims, the template and its `template.json`, copy the main file
 * and its content files, and set the status: five to seven calls, the same every time, each re-sending the
 * conversation so far.
 *
 * The template is copied only when the posting has no such document yet, so a revision keeps its edits. The status
 * moves from `captured` to `drafting`, never back. The brief leaves out `preferences.md` (already in the agent's
 * context through `EZAPPLY.md`) and the profile's EEO answers, which no document uses.
 */
export async function startDocument(s: Services, postingId: string, kind: TemplateKind) {
  const meta = await s.postings.get(postingId);
  const folder = s.postings.folder(postingId);
  const main = await s.templates.templateMain(kind);
  const template = await s.templates.templateMeta(kind);
  if (!main || !template) {
    throw new EzError(
      ErrorCode.NotFound,
      `No ${kind === "resume" ? "resume" : "cover letter"} template is set up.`,
      "Ask the user to finish the template step on the setup page (onboarding { step }), or run ezapply init for the default.",
    );
  }
  const dest = join(folder, DOCUMENT_FILE[kind]);
  const existed = await exists(dest);
  const copied: string[] = [];
  if (!existed) {
    await copyFile(main, dest);
    copied.push(DOCUMENT_FILE[kind]);
    // The content files sit beside the copy as beside the main file: the posting folder comes first on TeX's
    // search path, so the copies are the ones built, and they're where the bullets live.
    for (const rel of template.contentFiles ?? []) {
      const to = join(folder, rel);
      if (await exists(to)) continue;
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(dirname(main), rel), to);
      copied.push(rel.split("\\").join("/"));
    }
  }
  if (meta.status === "captured") await s.postings.updateMeta(postingId, { status: "drafting" });

  const notes = await readFile(join(folder, "notes.md"), "utf8").catch(() => "");
  const posting = await readFile(join(folder, "posting.md"), "utf8").catch(() => "");
  const profile = await s.profile.rawProfile();
  const { eeo: _eeo, ...forDocuments } = profile ?? {};
  const format =
    kind === "cover"
      ? await readFile(s.workspace.path("templates", "cover", "format.md"), "utf8").catch(() => null)
      : null;
  return {
    posting: {
      id: meta.id,
      ...(meta.company ? { company: meta.company } : {}),
      ...(meta.role ? { role: meta.role } : {}),
      ...(meta.reqId ? { reqId: meta.reqId } : {}),
      ...(meta.bundleRequired ? { bundleRequired: true } : {}),
    },
    document: {
      path: `postings/${postingId}/${DOCUMENT_FILE[kind]}`,
      ...(existed ? { existing: true } : { copied }),
      ...(template.contentFiles?.length ? { contentFiles: template.contentFiles } : {}),
      attachMode: await s.reviews.attachMode(),
    },
    ...(REQUIREMENTS.test(notes)
      ? {}
      : {
          requirementsMissing:
            "notes.md has no ## Application requirements yet: write it first from the posting (EZAPPLY.md).",
        }),
    notes: notes || null,
    postingText: posting,
    profile: profile ? stringify(forDocuments, { lineWidth: 0 }) : null,
    claims: await s.repos.allClaims(),
    ...(format ? { coverFormat: format } : {}),
  };
}

/** A section of the bundle: a file and, optionally, its pages and bookmark label. */
export interface BundleInput {
  path: string;
  pages?: string;
  label?: string;
}

/**
 * Build a posting's single-PDF bundle: by default its cover letter (when it has one), then its resume, then the given
 * `library/` extras. A resume or cover letter whose `.tex` is newer than its PDF is compiled first. The bundle gets a
 * bookmark per section, the page sizes of its first page, the title "<Name>: Application for <Role>", the user's name
 * as author, and the name `<Last>_<First>_<Company>_Application.pdf`. It is checked for one page size and a
 * one-page resume, compressed to `maxBytes` (else `pdf.defaultMaxBytes`) when larger, and the posting gets
 * `bundleRequired`. What was a skill of fixed steps is one call; deciding that a bundle is needed, the posting's own
 * order, and which extras stay the agent's.
 */
export async function buildBundle(
  s: Services,
  postingId: string,
  opts: { inputs?: BundleInput[]; extras?: BundleInput[]; output?: string; maxBytes?: number },
) {
  const meta = await s.postings.get(postingId);
  const folder = s.postings.folder(postingId);
  const warnings: string[] = [];
  const own = async (name: string, label: string): Promise<BundleInput | null> => {
    const pdf = join(folder, name);
    const tex = join(folder, `${basename(name, ".pdf")}.tex`);
    const [p, t] = await Promise.all([stat(pdf).catch(() => null), stat(tex).catch(() => null)]);
    if (t && (!p || t.mtimeMs > p.mtimeMs)) {
      const r = await s.documents.compile(tex);
      if (!r.ok) {
        throw new EzError(
          ErrorCode.BadRequest,
          `${basename(tex)} doesn't compile, so the bundle can't include it.`,
          r.hint ?? "Fix the build with tex_compile, then build the bundle again.",
        );
      }
    } else if (!p) return null;
    return { path: `postings/${postingId}/${name}`, label };
  };
  let inputs: BundleInput[];
  if (opts.inputs?.length) {
    inputs = [];
    for (const i of opts.inputs) {
      const abs = s.documents.pdfPath(i.path, "read");
      const inPosting = relative(folder, abs);
      // A posting's own document is rebuilt first when its source changed.
      const fresh =
        !inPosting.startsWith("..") && !inPosting.includes("/") && !inPosting.includes("\\")
          ? await own(inPosting, i.label ?? labelOf(inPosting))
          : null;
      inputs.push({ ...i, path: fresh?.path ?? i.path, label: i.label ?? labelOf(abs) });
    }
  } else {
    const cover = await own("cover.pdf", "Cover Letter");
    const resume = await own("resume.pdf", "Resume");
    if (!resume) {
      throw new EzError(
        ErrorCode.NotFound,
        "This posting has no resume yet.",
        "Tailor the resume first (ezapply-resume), or pass inputs.",
      );
    }
    inputs = [...(cover ? [cover] : []), resume];
  }
  for (const e of opts.extras ?? []) inputs.push({ ...e, label: e.label ?? labelOf(e.path) });

  const profile = await s.profile.profile();
  const identity = profile.exists && profile.valid ? profile.value.identity : undefined;
  const name = identity ? `${identity.preferredName ?? identity.firstName} ${identity.lastName}` : undefined;
  const output =
    opts.output ??
    `postings/${postingId}/${[identity?.lastName, identity?.firstName, meta.company]
      .filter((p): p is string => Boolean(p))
      .map(fileWord)
      .join("_")}_Application.pdf`;
  const merged = await s.documents.merge(inputs as MergeInput[], output, {
    bookmarks: true,
    normalize: "auto",
    ...(name && meta.role ? { title: `${name}: Application for ${meta.role}` } : {}),
    ...(name ? { author: name } : {}),
  });

  const resume = merged.sections.find((x) => x.label === "Resume");
  if (resume && resume.lastPage !== resume.firstPage) {
    warnings.push(`The resume takes ${resume.lastPage - resume.firstPage + 1} pages in the bundle: it should be one.`);
  }
  const info = await pdfInfo(merged.output);
  if (info.pageSizes.length > 1) {
    warnings.push(
      `The bundle has ${info.pageSizes.length} page sizes: ${info.pageSizes.map((p) => p.size).join(", ")}.`,
    );
  }
  const limit = opts.maxBytes ?? (await s.workspace.readConfig()).pdf.defaultMaxBytes;
  let bytes = merged.bytes;
  let compressed: Awaited<ReturnType<typeof pdfCompress>> | undefined;
  if (bytes > limit) {
    compressed = await pdfCompress(merged.output, merged.output, limit);
    bytes = compressed.after;
    if (!compressed.metTarget) {
      warnings.push(
        `Still ${(bytes / 1e6).toFixed(1)} MB after compressing, over the ${(limit / 1e6).toFixed(1)} MB limit: say what to drop.`,
      );
    }
  }
  if (!meta.bundleRequired) await s.postings.updateMeta(postingId, { bundleRequired: true });
  return {
    output: relative(s.workspace.root, merged.output).split("\\").join("/"),
    pages: merged.pages,
    bytes,
    sections: merged.sections.map((x) => ({ label: x.label, pages: `${x.firstPage}-${x.lastPage}` })),
    ...(compressed
      ? { compressed: { before: compressed.before, after: compressed.after, method: compressed.method } }
      : {}),
    ...(compressed?.hint ? { hint: compressed.hint } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

/** "transcript_2024.pdf" → "Transcript 2024". */
function labelOf(path: string): string {
  const words = basename(path, extname(path)).replace(/[_-]+/g, " ").trim();
  return words ? words[0]?.toUpperCase() + words.slice(1) : "Document";
}

/** A name as one word of a file name: letters and digits, the rest joined with hyphens. */
function fileWord(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "X"
  );
}
