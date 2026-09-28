import { describe, expect, it } from "vitest";
import type { PageCapture } from "../src/capture/capture.js";
import { chooseFrame, type FrameCapture, unreadableBoard } from "../src/capture/frames.js";

const page = (over: Partial<PageCapture>): PageCapture => ({
  url: "https://careers.acme.com/jobs",
  pageTitle: "Careers at Acme",
  html: "",
  visibleHtml: "",
  visibleText: "",
  jsonLd: [],
  frames: [],
  ...over,
});
const frame = (frameId: number, over: Partial<PageCapture>): FrameCapture => ({ frameId, page: page(over) });
const words = (n: number) => "word ".repeat(n);
const JOB_LD = JSON.stringify({ "@type": "JobPosting", title: "Engineer" });

describe("choosing the frame that holds the posting", () => {
  it("keeps the top frame when it has the posting", () => {
    const top = frame(0, { visibleText: words(50), jsonLd: [JOB_LD] });
    const child = frame(3, { url: "https://boards.greenhouse.io/embed/job_app", visibleText: words(900) });
    expect(chooseFrame([top, child])).toBe(top);
  });

  it("takes an embedded board with JobPosting data, or with more text than the page around it", () => {
    const top = frame(0, { visibleText: words(200) });
    const board = frame(3, {
      url: "https://boards.greenhouse.io/embed/job_app",
      visibleText: words(150),
      jsonLd: [JOB_LD],
    });
    const chat = frame(4, { url: "https://chat.example/widget", visibleText: words(80) });
    expect(chooseFrame([top, board, chat])).toBe(board);

    const bigger = frame(5, { url: "https://jobs.lever.co/acme/1", visibleText: words(900) });
    expect(chooseFrame([top, chat, bigger])).toBe(bigger);
    expect(chooseFrame([top, chat])).toBe(top);
  });

  it("spots a large job board frame it couldn't read", () => {
    const src = "https://boards.greenhouse.io/embed/job_app?for=acme&token=1";
    const top = frame(0, {
      visibleText: words(100),
      frames: [
        { src, width: 800, height: 1200 },
        { src: "https://www.youtube.com/embed/x", width: 800, height: 450 },
      ],
    });
    expect(unreadableBoard(top, [top])).toBe(src);
    expect(unreadableBoard(frame(0, { ...top.page, jsonLd: [JOB_LD] }), [top])).toBeUndefined();
    const tiny = frame(0, { frames: [{ src, width: 300, height: 40 }] });
    expect(unreadableBoard(tiny, [tiny])).toBeUndefined();
  });
});
