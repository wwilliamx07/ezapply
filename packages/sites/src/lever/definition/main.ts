import { install } from "@ezapply/engine/api";
import { lever } from "./site.js";

/** Entry for the MAIN-world bundle (lever-main.js), injected on demand by the service worker. */
install(lever);
