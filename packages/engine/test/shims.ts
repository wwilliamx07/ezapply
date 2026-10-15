/**
 * jsdom lacks DataTransfer and DragEvent, which uploads use; the adapter only needs items.add + files, and a
 * drop event that carries them. Installed on the window the adapter reads its constructors from.
 */
export function installDomShims(win: Window): void {
  const w = win as unknown as Record<string, unknown> & { Event: typeof Event };
  w.DataTransfer = class FakeDataTransfer {
    private list: File[] = [];
    items = { add: (f: File) => this.list.push(f) };
    get files() {
      const l = this.list;
      return Object.assign([...l], { item: (i: number) => l[i] ?? null }) as unknown as FileList;
    }
  };
  w.DragEvent = class extends w.Event {
    dataTransfer: unknown;
    constructor(type: string, init: EventInit & { dataTransfer?: unknown } = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer;
    }
  };
}
