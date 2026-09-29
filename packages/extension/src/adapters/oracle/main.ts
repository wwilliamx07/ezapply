import { ADAPTER_VERSION, createOracleApi } from "./api.js";

/**
 * Entry for the MAIN-world bundle (oracle-main.js). Injected on demand by the background; idempotent across
 * repeated injections and the Candidate Experience's in-page navigation.
 */
const w = window as unknown as { __ezapplyOracle?: { version: string } };
if (w.__ezapplyOracle?.version !== ADAPTER_VERSION) {
  Object.defineProperty(window, "__ezapplyOracle", {
    value: createOracleApi(document, () => location.href),
    configurable: true,
    enumerable: false,
    writable: false,
  });
}
