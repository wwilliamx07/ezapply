// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { capturePage, type PageCapture } from "../src/capture/capture.js";
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

  it("passes over a frame that isn't rendered", () => {
    // jsdom renders nothing and has no innerText: stand in for a hidden frame's document and a shown one's.
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const saved = {
      checkVisibility: proto.checkVisibility,
      innerText: Object.getOwnPropertyDescriptor(proto, "innerText"),
    };
    let shown = false;
    proto.checkVisibility = () => shown;
    Object.defineProperty(proto, "innerText", {
      configurable: true,
      get: function (this: HTMLElement) {
        return this.textContent;
      },
    });
    try {
      document.body.innerHTML = "<div>token</div><script>recaptcha.anchor.Main.init('…')</script>";
      const hidden = capturePage();
      expect(hidden.visibleText).toBe("");
      expect(hidden.visibleHtml).toBe("");

      shown = true;
      expect(capturePage().visibleText).toContain("token");

      const top = frame(0, { url: "https://jobs.example.com/view/1", visibleText: words(300) });
      const captcha = frame(7, { ...hidden, url: "https://www.google.com/recaptcha/enterprise/anchor" });
      expect(chooseFrame([top, captcha])).toBe(top);
    } finally {
      proto.checkVisibility = saved.checkVisibility;
      if (saved.innerText) Object.defineProperty(proto, "innerText", saved.innerText);
      else delete proto.innerText;
    }
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
