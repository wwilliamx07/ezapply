import { install } from "@ezapply/engine/api";
import { ashby } from "./site.js";

/** Entry for the MAIN-world bundle (ashby-main.js), injected on demand by the service worker. */
install(ashby);
