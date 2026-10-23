import { install } from "@ezapply/engine/api";
import { generic } from "./site.js";

/** Entry for the MAIN-world bundle (generic-main.js), injected on demand by the service worker. */
install(generic);
