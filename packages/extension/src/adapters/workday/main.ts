import { ADAPTER_VERSION, createWorkdayApi } from "./api.js";

/**
 * Entry for the MAIN-world bundle (workday-main.js). Injected on demand by the service worker;
 * idempotent across repeated injections and SPA navigations.
 */
const w = window as unknown as { __ezapplyWorkday?: { version: string } };
if (w.__ezapplyWorkday?.version !== ADAPTER_VERSION) {
  Object.defineProperty(window, "__ezapplyWorkday", {
    value: createWorkdayApi(document, () => location.href),
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
