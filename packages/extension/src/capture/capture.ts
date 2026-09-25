/**
 * Runs inside the job posting page via chrome.scripting.executeScript, which serialises the
 * function source. It must be self-contained: no imports, helpers or outer references.
 */
export function capturePage(): {
  url: string;
  pageTitle: string;
  html: string;
  visibleHtml: string;
  visibleText: string;
  jsonLd: string[];
} {
  const body = document.body;
  const clone = body.cloneNode(true) as HTMLElement;

  // Walk the live tree and the clone in lockstep; drop from the clone every element the user
  // could not see (display:none, visibility:hidden, opacity:0, collapsed content).
  const live = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  const copy = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT);
  const skipSubtree = (w: TreeWalker): Node | null => {
    for (;;) {
      const sibling = w.nextSibling();
      if (sibling) return sibling;
      if (!w.parentNode()) return null;
    }
  };
  const hidden: Node[] = [];
  let a = live.nextNode() as Element | null;
  let b = copy.nextNode();
  while (a && b) {
    const invisible =
      typeof a.checkVisibility === "function" &&
      !a.checkVisibility({
        // Old and new spellings; Chrome accepts both.
        checkOpacity: true,
        checkVisibilityCSS: true,
        opacityProperty: true,
        visibilityProperty: true,
      } as CheckVisibilityOptions);
    if (invisible) {
      hidden.push(b);
      a = skipSubtree(live) as Element | null;
      b = skipSubtree(copy);
    } else {
      a = live.nextNode() as Element | null;
      b = copy.nextNode();
    }
  }
  for (const n of hidden) (n as Element).remove();

  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
    (s) => s.textContent ?? "",
  );

  return {
    url: location.href,
    pageTitle: document.title,
    html: body.innerHTML,
    visibleHtml: clone.innerHTML,
    visibleText: body.innerText,
    jsonLd,
  };
}
