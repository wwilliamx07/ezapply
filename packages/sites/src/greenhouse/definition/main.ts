import { install } from "@ezapply/engine/api";
import { greenhouse } from "./site.js";

/** Entry for the MAIN-world bundle (greenhouse-main.js), injected on demand by the service worker. */
install(greenhouse);
