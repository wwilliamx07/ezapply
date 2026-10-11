// @vitest-environment jsdom
import type { ReviewPageFile } from "@ezapply/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { itemsOf, joinItems } from "../src/lib/text.js";
import { changesSince } from "../src/review/changes.js";
import { answerOf, type DocDraft, decisionOf } from "../src/review/draft.js";
import { Panel } from "../src/review/Panel.js";
import { expandToWords, mergeRects } from "../src/review/selection.js";

afterEach(cleanup);

describe("the page text and its items", () => {
  const items = [
    { str: "Led a team", hasEOL: false },
    { str: " of six", hasEOL: true },
    { str: "engineers.", hasEOL: false },
  ];

  it("joins items as the companion's pdf_text does, keeping where each starts", () => {
    expect(joinItems(items)).toEqual({ text: "Led a team of six\nengineers.", itemStarts: [0, 10, 18] });
  });

  it("maps a stretch of the text to the parts of the items it covers, skipping line breaks", () => {
    const { itemStarts } = joinItems(items);
    expect(itemsOf(items, itemStarts, 7, 17)).toEqual([
      [0, 7, 10],
      [1, 0, 7],
    ]);
    expect(itemsOf(items, itemStarts, 14, 22)).toEqual([
      [1, 4, 7],
      [2, 0, 4],
    ]);
  });
});

describe("changes since the last review", () => {
  it("marks the words put in on each page they fall on, with what they replaced", () => {
    const marks = changesSince(["Led a team of four.", "Skills: Go"], ["Led a team of six.", "Skills: Go, Rust"]);
    expect(marks).toEqual([
      {
        id: "c0",
        change: { page: 1, removed: "four.", added: "six.", before: "Led a team of" },
        added: [{ page: 0, start: 14, end: 18 }],
      },
      {
        id: "c1",
        change: { page: 2, removed: "Go", added: "Go, Rust", before: "Skills:" },
        added: [{ page: 1, start: 8, end: 16 }],
      },
    ]);
  });

  it("places a removal before the word that follows it, or after the last word", () => {
    const [middle] = changesSince(["one two three"], ["one three"]);
    expect(middle?.removedAt).toEqual({ page: 0, offset: 4, after: false });
    const [end] = changesSince(["one two"], ["one"]);
    expect(end?.removedAt).toEqual({ page: 0, offset: 3, after: true });
  });

  it("finds nothing in text that only reflowed", () => {
    expect(changesSince(["a b\nc"], ["a\nb c"])).toEqual([]);
  });
});

describe("a selection", () => {
  it("joins touching boxes on a line and keeps lines apart", () => {
    expect(
      mergeRects([
        { x: 0.1, y: 0.2, w: 0.1, h: 0.02 },
        { x: 0.2, y: 0.2005, w: 0.15, h: 0.02 },
        { x: 0.1, y: 0.23, w: 0.2, h: 0.02 },
      ]),
    ).toEqual([
      { x: 0.1, y: 0.2, w: 0.25, h: 0.0205 },
      { x: 0.1, y: 0.23, w: 0.2, h: 0.02 },
    ]);
  });

  it("takes whole words when it starts or ends inside one", () => {
    const p = document.createElement("p");
    p.textContent = "building the billing pipeline";
    document.body.append(p);
    const text = p.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 15);
    expandToWords(range);
    expect(range.toString()).toBe("building the billing");
    // At a word's edge already: unchanged, and never into the next word.
    range.setStart(text, 9);
    range.setEnd(text, 12);
    expandToWords(range);
    expect(range.toString()).toBe("the");
  });
});

describe("the answer", () => {
  const draft = (request: string, notes: string[] = [], approved?: boolean): DocDraft => ({
    request,
    comments: notes.map((note, i) => ({ id: `m${i}`, page: 1, quote: "q", note, rects: [] })),
    ...(approved === undefined ? {} : { approved }),
  });

  it("leaves a document undecided until it's approved, and a request or comment asks for changes over an approval", () => {
    expect(
      [draft("  "), draft("", [], true), draft("Shorter.", [], true), draft("", ["Name it."])].map(decisionOf),
    ).toEqual(["open", "approved", "changes", "changes"]);
  });

  it("approves a document with no request and no comment, and sends the others' with their places", () => {
    const drafts = [draft("  ", [], true), draft("Shorter.", ["Name the manager."])];
    expect(answerOf(3, (i) => drafts[i] ?? draft(""))).toEqual({
      documents: [
        { index: 0 },
        { index: 1, request: "Shorter.", comments: [{ page: 1, quote: "q", note: "Name the manager.", rects: [] }] },
        { index: 2 },
      ],
    });
  });
});

describe("the panel", () => {
  const base: ReviewPageFile = {
    index: 0,
    name: "resume.pdf",
    bytes: 1000,
    info: { pages: 2, pageSize: "letter", hasTextLayer: true, encrypted: false },
    pageLimit: 1,
  };
  const props = {
    changes: null,
    comments: [],
    request: "",
    decision: "open" as const,
    active: null,
    onApprove: vi.fn(),
    onRequest: vi.fn(),
    onEditComment: vi.fn(),
    onRemoveComment: vi.fn(),
    onShow: vi.fn(),
  };

  it("checks the page count against a resume's limit and the text layer", () => {
    render(<Panel {...props} file={base} />);
    expect(screen.getByText(/2 pages, over the 1-page limit for a resume/)).toBeTruthy();
    expect(screen.getByText(/can be read by applicant-tracking systems/)).toBeTruthy();
    expect(screen.getByText("Not decided")).toBeTruthy();
    expect(screen.getByText(/first time you're reviewing it/)).toBeTruthy();
  });

  it("says when a file couldn't be read, or hasn't changed since it was approved", () => {
    const { unmount } = render(<Panel {...props} file={{ ...base, info: undefined }} />);
    expect(screen.getByText(/couldn't read this file as a PDF/)).toBeTruthy();
    unmount();
    render(
      <Panel
        {...props}
        file={{ ...base, previous: { at: "2026-10-01T12:00:00Z", reviewId: "r1", same: true, approved: true } }}
      />,
    );
    expect(screen.getByText(/Unchanged since you approved it/)).toBeTruthy();
  });

  it("lists the changes since the last review, each showing its place when pressed", () => {
    const onShow = vi.fn();
    const changes = changesSince(["Led a team of four."], ["Led a team of six."]);
    render(
      <Panel
        {...props}
        onShow={onShow}
        changes={changes}
        file={{
          ...base,
          previous: { at: "2026-10-01T12:00:00Z", reviewId: "r1", same: false, approved: false, pages: [] },
        }}
      />,
    );
    expect(screen.getByText(/1 change since/)).toBeTruthy();
    const change = screen.getByRole("button", { name: /p\. 1/ });
    expect(change.querySelector("del")?.textContent).toBe("four.");
    expect(change.querySelector("ins")?.textContent).toBe("six.");
    fireEvent.click(change);
    expect(onShow).toHaveBeenCalledWith("c0", 0);
  });

  it("approves the document, and undoes it", () => {
    const onApprove = vi.fn();
    const { unmount } = render(<Panel {...props} file={base} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve as shown" }));
    expect(onApprove).toHaveBeenCalledWith(true);
    unmount();
    render(<Panel {...props} file={base} decision="approved" onApprove={onApprove} />);
    expect(screen.getByText("Approved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo approval" }));
    expect(onApprove).toHaveBeenCalledWith(false);
  });

  it("asks for changes once there's a comment, which can be edited and removed", () => {
    const onEditComment = vi.fn();
    const onRemoveComment = vi.fn();
    const comment = { id: "m1", page: 1, quote: "billing pipeline", note: "Say invoicing.", rects: [] };
    render(
      <Panel
        {...props}
        file={base}
        comments={[comment]}
        decision="changes"
        onEditComment={onEditComment}
        onRemoveComment={onRemoveComment}
      />,
    );
    expect(screen.getByText("Changes requested")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Approve as shown" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit comment 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Comment 1" }), {
      target: { value: "Say invoicing, twice." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onEditComment).toHaveBeenCalledWith("m1", "Say invoicing, twice.");
    fireEvent.click(screen.getByRole("button", { name: "Remove comment 1" }));
    expect(onRemoveComment).toHaveBeenCalledWith("m1");
  });

  it("takes a request for the whole document", () => {
    const onRequest = vi.fn();
    render(<Panel {...props} file={base} onRequest={onRequest} />);
    fireEvent.change(screen.getByLabelText("Anything else to change?"), { target: { value: "Shorter." } });
    expect(onRequest).toHaveBeenCalledWith("Shorter.");
  });
});
