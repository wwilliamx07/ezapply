import { text } from "./dom.js";

/**
 * Hard guarantee that nothing but a real user gesture can submit: synthetic (untrusted) events aimed at a
 * submit control are cancelled before the page sees them. Real clicks are always trusted. Installed once per
 * document; `isSubmit` is the adapter's own idea of a submit control. Returns the log of blocked attempts.
 */
export function installSubmitGuard(doc: Document, isSubmit: (el: Element | null) => boolean): string[] {
  const marker = "__ezapplySubmitGuard";
  const holder = doc as unknown as Record<string, string[] | undefined>;
  const existing = holder[marker];
  if (existing) return existing;
  const log: string[] = [];
  holder[marker] = log;
  const block = (e: Event) => {
    if (e.isTrusted) return;
    const target = e.target as Element | null;
    const isKey = e.type === "keydown" || e.type === "keyup";
    if (isKey && !["Enter", " "].includes((e as KeyboardEvent).key)) return;
    if (!isSubmit(target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    log.push(
      `${new Date().toISOString()} blocked synthetic ${e.type} on "${text(target?.closest("button,[role=button],a,input") ?? null)}"`,
    );
  };
  for (const type of ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "submit"]) {
    doc.addEventListener(type, block, true);
  }
  return log;
}
