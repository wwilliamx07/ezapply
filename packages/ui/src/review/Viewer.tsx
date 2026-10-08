import type { PageRect } from "@ezapply/protocol";
import { type PDFPageProxy, type RenderTask, TextLayer } from "pdfjs-dist";

type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Icon } from "../components/ui.js";
import "./textlayer.css";
import "./viewer.css";
import { itemsOf, type LoadedPage, type LoadedPdf } from "../lib/pdf.js";
import type { ChangeMark } from "./changes.js";
import { expandToWords, mergeRects } from "./selection.js";

export interface CommentMark {
  id: string;
  /** Its number in the panel's list. */
  n: number;
  /** 0-based. */
  page: number;
  rects: PageRect[];
}

/** Text the user selected on one page, to comment on. */
export interface Selected {
  /** 0-based. */
  page: number;
  quote: string;
  rects: PageRect[];
}

export interface Jump {
  /** A mark to bring into view (a change or a comment), else the page. */
  id?: string;
  page: number;
  nonce: number;
}

interface Props {
  pdf: LoadedPdf;
  downloadUrl: string;
  name: string;
  changes: ChangeMark[];
  showChanges: boolean;
  onToggleChanges: (() => void) | null;
  comments: CommentMark[];
  active: string | null;
  jump: Jump | null;
  /** Absent: text can be selected, not commented on (a template's preview). */
  onComment?(sel: Selected, note: string): void;
  onActivate(id: string): void;
}

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const GUTTER = 48;

/**
 * A PDF the way pdf.js draws it: each page on a canvas (drawn once it's near the view, again at a new zoom), with
 * pdf.js's text layer over it, so text can be selected, commented on and found with the browser's own find
 * (every page's text layer is there from the start). Over that, the marks: what changed since the last review,
 * and the user's comments.
 */
export function Viewer(props: Props) {
  const { pdf, comments, changes, showChanges, active, jump } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<(Selected & { x: number; y: number }) | null>(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");

  const widest = useMemo(() => Math.max(...pdf.pages.map((p) => p.width)), [pdf]);
  const fit = width > 0 ? Math.max(0.3, Math.min(3, (width - GUTTER) / widest)) : 1;
  const scale = zoom === "fit" ? fit : zoom;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      setZoom(() => {
        const next =
          dir > 0 ? ZOOMS.find((z) => z > scale + 0.001) : [...ZOOMS].reverse().find((z) => z < scale - 0.001);
        return next ?? scale;
      });
    },
    [scale],
  );

  const goTo = useCallback((page: number, markId?: string) => {
    const root = scroller.current;
    if (!root) return;
    const mark = markId ? root.querySelector<HTMLElement>(`[data-mark="${markId}"]`) : null;
    const target = mark ?? root.querySelector<HTMLElement>(`[data-page="${page}"]`);
    target?.scrollIntoView({ block: mark ? "center" : "start", behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (jump) goTo(jump.page, jump.id);
  }, [jump, goTo]);

  // Which page is in view: the first whose bottom is below a third of the way down.
  const onScroll = () => {
    const root = scroller.current;
    if (!root) return;
    const line = root.getBoundingClientRect().top + root.clientHeight / 3;
    const pages = root.querySelectorAll<HTMLElement>("[data-page]");
    for (const p of pages) {
      if (p.getBoundingClientRect().bottom > line) {
        setCurrent(Number(p.dataset.page));
        break;
      }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]") || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const next = Math.max(0, Math.min(pdf.pages.length - 1, current + (e.key === "ArrowRight" ? 1 : -1)));
        goTo(next);
        e.preventDefault();
      } else if (e.key === "+" || e.key === "=") {
        step(1);
        e.preventDefault();
      } else if (e.key === "-") {
        step(-1);
        e.preventDefault();
      } else if (e.key === "0") {
        setZoom("fit");
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, pdf, goTo, step]);

  // Text selected on one page offers a comment on it.
  const onSelect = () => {
    if (editing || !props.onComment) return;
    const sel = window.getSelection();
    const wrap = inner.current;
    if (!sel || sel.isCollapsed || !wrap || sel.rangeCount === 0) return setSelected(null);
    const range = sel.getRangeAt(0).cloneRange();
    expandToWords(range);
    sel.removeAllRanges();
    sel.addRange(range);
    const startPage = elementOf(range.startContainer)?.closest<HTMLElement>("[data-page]");
    const endPage = elementOf(range.endContainer)?.closest<HTMLElement>("[data-page]");
    const quote = sel.toString().replace(/\s+/g, " ").trim();
    if (!startPage || startPage !== endPage || !quote) return setSelected(null);
    const box = startPage.getBoundingClientRect();
    const rects = mergeRects(
      [...range.getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => ({
          x: (r.left - box.left) / box.width,
          y: (r.top - box.top) / box.height,
          w: r.width / box.width,
          h: r.height / box.height,
        }))
        .filter((r) => r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= 1.01 && r.y + r.h <= 1.01),
    );
    if (rects.length === 0) return setSelected(null);
    const last = range.getClientRects()[range.getClientRects().length - 1] ?? box;
    const outer = wrap.getBoundingClientRect();
    setSelected({
      page: Number(startPage.dataset.page),
      quote: quote.slice(0, 600),
      rects,
      x: Math.min(last.right - outer.left, outer.width - 300),
      y: last.bottom - outer.top + 6,
    });
  };

  const save = () => {
    if (!selected || !note.trim()) return;
    props.onComment?.({ page: selected.page, quote: selected.quote, rects: selected.rects }, note.trim());
    window.getSelection()?.removeAllRanges();
    setSelected(null);
    setEditing(false);
    setNote("");
  };
  const cancel = () => {
    setSelected(null);
    setEditing(false);
    setNote("");
  };

  return (
    <section className="ez-viewer" aria-label={`${props.name}, ${pdf.pages.length} pages`}>
      <div className="ez-toolbar" role="toolbar" aria-label="Viewer">
        <span className="ez-toolbar-pages" aria-live="polite">
          Page {current + 1} of {pdf.pages.length}
        </span>
        <span className="ez-toolbar-gap" />
        <Button size="icon" variant="ghost" onClick={() => step(-1)} title="Zoom out (−)" aria-label="Zoom out">
          <Icon name="zoomOut" />
        </Button>
        <span className="ez-zoom">{Math.round(scale * 100)}%</span>
        <Button size="icon" variant="ghost" onClick={() => step(1)} title="Zoom in (+)" aria-label="Zoom in">
          <Icon name="zoomIn" />
        </Button>
        <Button
          size="sm"
          variant={zoom === "fit" ? "default" : "ghost"}
          onClick={() => setZoom("fit")}
          title="Fit the page's width (0)"
          aria-pressed={zoom === "fit"}
        >
          <Icon name="fitWidth" size={16} /> Fit width
        </Button>
        {props.onToggleChanges ? (
          <Button
            size="sm"
            variant={showChanges ? "default" : "ghost"}
            onClick={props.onToggleChanges}
            aria-pressed={showChanges}
            title="Mark what changed since you last reviewed it"
          >
            <Icon name="diff" size={16} /> Changes
          </Button>
        ) : null}
        <a className="ez-btn ez-btn-ghost ez-btn-sm" href={props.downloadUrl} download title="Download this version">
          <Icon name="download" size={16} /> Download
        </a>
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: what's acted on is the text selected in it, by mouse or by keyboard (caret browsing) */}
      <div
        className="ez-scroller"
        ref={scroller}
        onScroll={onScroll}
        onMouseUp={onSelect}
        onKeyUp={(e) => e.shiftKey && onSelect()}
      >
        <div className="ez-pages" ref={inner}>
          {pdf.pages.map((page, i) => (
            <PageView
              // biome-ignore lint/suspicious/noArrayIndexKey: pages don't move
              key={i}
              index={i}
              page={page}
              scale={scale}
              root={scroller}
              changes={showChanges ? changes : []}
              comments={comments.filter((c) => c.page === i)}
              pending={selected?.page === i ? selected.rects : null}
              active={active}
              onActivate={props.onActivate}
            />
          ))}
          {selected && !editing ? (
            <button
              type="button"
              className="ez-float ez-btn ez-btn-primary ez-btn-sm"
              style={{ left: selected.x, top: selected.y }}
              onMouseUp={(e) => e.stopPropagation()}
              onClick={() => setEditing(true)}
            >
              <Icon name="comment" size={15} /> Comment
            </button>
          ) : null}
          {selected && editing ? (
            <div
              className="ez-float ez-popover"
              role="dialog"
              aria-label="Comment on the selected text"
              style={{ left: Math.max(8, selected.x - 140), top: selected.y }}
              onMouseUp={(e) => e.stopPropagation()}
            >
              <blockquote className="ez-quote">{selected.quote}</blockquote>
              <label className="ez-sr-only" htmlFor="ez-new-comment">
                What should change here?
              </label>
              <textarea
                id="ez-new-comment"
                className="ez-textarea"
                // biome-ignore lint/a11y/noAutofocus: the user just asked to write this
                autoFocus
                rows={3}
                placeholder="What should change here?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
                  if (e.key === "Escape") cancel();
                }}
              />
              <div className="ez-popover-actions">
                <span className="ez-help">
                  <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to add
                </span>
                <Button size="sm" variant="ghost" onClick={cancel}>
                  Cancel
                </Button>
                <Button size="sm" variant="primary" onClick={save} disabled={!note.trim()}>
                  Add comment
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

interface PageProps {
  index: number;
  page: LoadedPage;
  scale: number;
  root: React.RefObject<HTMLDivElement | null>;
  changes: ChangeMark[];
  comments: CommentMark[];
  /** The selection being commented on: kept highlighted while the user types, when the browser's is gone. */
  pending: PageRect[] | null;
  active: string | null;
  onActivate(id: string): void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const textContents = new WeakMap<LoadedPage, Promise<TextContent>>();

function PageView({ index, page, scale, root, changes, comments, pending, active, onActivate }: PageProps) {
  const el = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(index < 2);
  const [spans, setSpans] = useState<HTMLElement[] | null>(null);
  const [boxes, setBoxes] = useState<{ id: string; kind: "added" | "removed"; title: string; boxes: Box[] }[]>([]);
  const width = Math.floor(page.width * scale);
  const height = Math.floor(page.height * scale);

  // Drawn once near the view.
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      root: root.current,
      rootMargin: "150% 0px",
    });
    io.observe(node);
    return () => io.disconnect();
  }, [root]);

  // The canvas, at the device's pixel ratio so text stays sharp. Each zoom draws on a new canvas and swaps it in
  // when done: pdf.js won't draw twice on one canvas while the first drawing is still being cancelled, and the
  // old one stays on screen meanwhile.
  useEffect(() => {
    const holder = canvas.current;
    if (!near || !holder) return;
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.proxy.getViewport({ scale: scale * ratio });
    const c = document.createElement("canvas");
    c.className = "ez-canvas";
    c.width = Math.floor(viewport.width);
    c.height = Math.floor(viewport.height);
    let task: RenderTask | null = null;
    try {
      task = page.proxy.render({ canvas: c, viewport });
      task.promise.then(
        () => holder.replaceChildren(c),
        () => {},
      );
    } catch {}
    return () => task?.cancel();
  }, [near, page, scale]);

  // pdf.js's text layer: selectable, findable text where the canvas draws it.
  useEffect(() => {
    const container = text.current;
    if (!container) return;
    container.replaceChildren();
    let content = textContents.get(page);
    if (!content) {
      content = page.proxy.getTextContent();
      textContents.set(page, content);
    }
    let layer: TextLayer | null = null;
    let cancelled = false;
    void content.then(async (textContentSource) => {
      if (cancelled) return;
      layer = new TextLayer({ textContentSource, container, viewport: page.proxy.getViewport({ scale }) });
      await layer.render().catch(() => {});
      if (!cancelled) setSpans(layer.textDivs);
    });
    return () => {
      cancelled = true;
      layer?.cancel();
    };
  }, [page, scale]);

  // Where the changes sit, measured on the text layer's spans.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !spans) return setBoxes([]);
    const origin = node.getBoundingClientRect();
    const out: typeof boxes = [];
    for (const mark of changes) {
      const title = mark.change.removed ? `Was: ${mark.change.removed}` : "Added";
      const added = mark.added.filter((s) => s.page === index);
      if (added.length) {
        const bs = added.flatMap((s) => measure(page, spans, s.start, s.end, origin));
        if (bs.length) out.push({ id: mark.id, kind: "added", title, boxes: bs });
      } else if (mark.removedAt?.page === index) {
        const { offset, after } = mark.removedAt;
        const b = measure(page, spans, after ? offset - 1 : offset, after ? offset : offset + 1, origin)[0];
        if (b) {
          out.push({
            id: mark.id,
            kind: "removed",
            title: `Removed: ${mark.change.removed ?? ""}`,
            boxes: [{ left: after ? b.left + b.width : b.left, top: b.top, width: 0, height: b.height }],
          });
        }
      }
    }
    setBoxes(out);
  }, [spans, changes, page, index]);

  return (
    <div
      ref={el}
      className="ez-page"
      data-page={index}
      style={
        {
          width,
          height,
          "--scale-factor": scale,
          "--total-scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
    >
      <div ref={canvas} className="ez-canvas-holder" aria-hidden="true" />
      <div ref={text} className="textLayer" />
      <div className="ez-marks">
        {boxes.map((m) =>
          m.boxes.map((b, j) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a mark's boxes don't move
              key={`${m.id}-${j}`}
              data-mark={j === 0 ? m.id : undefined}
              className={`ez-mark ez-mark-${m.kind}${active === m.id ? " ez-mark-active" : ""}`}
              style={{ left: b.left, top: b.top, width: m.kind === "removed" ? undefined : b.width, height: b.height }}
              title={m.title}
            />
          )),
        )}
        {comments.map((c) => [
          ...c.rects.map((r, j) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a comment's rects don't move
              key={`${c.id}-${j}`}
              data-mark={j === 0 ? c.id : undefined}
              className={`ez-mark ez-mark-comment${active === c.id ? " ez-mark-active" : ""}`}
              style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
              onClick={() => onActivate(c.id)}
              aria-hidden="true"
            />
          )),
          // Its number in the page's left margin, level with the passage, where it covers no text.
          <button
            type="button"
            key={`${c.id}-n`}
            className={`ez-margin-n ez-mark-n${active === c.id ? " ez-mark-active" : ""}`}
            style={{ top: pct(c.rects[0]?.y ?? 0) }}
            onClick={() => onActivate(c.id)}
            aria-label={`Comment ${c.n}`}
          >
            {c.n}
          </button>,
        ])}
        {pending?.map((r, j) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the selection's rects don't move
            key={`pending-${j}`}
            className="ez-mark ez-mark-pending"
            style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
          />
        ))}
      </div>
    </div>
  );
}

/** Boxes of a stretch of the page text, relative to the page, from the spans of the items it covers. */
function measure(page: LoadedPage, spans: HTMLElement[], start: number, end: number, origin: DOMRect): Box[] {
  const out: Box[] = [];
  for (const [i, from, to] of itemsOf(page.items, page.itemStarts, start, end)) {
    const node = spans[i]?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) continue;
    const range = document.createRange();
    const len = node.textContent?.length ?? 0;
    range.setStart(node, Math.min(from, len));
    range.setEnd(node, Math.min(to, len));
    for (const r of range.getClientRects()) {
      if (r.width < 0.5 && r.height < 0.5) continue;
      out.push({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height });
    }
  }
  return out;
}

function pct(n: number): string {
  return `${n * 100}%`;
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}
