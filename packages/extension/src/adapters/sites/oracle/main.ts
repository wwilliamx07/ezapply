import { install } from "../../engine/api.js";
import { oracle } from "./site.js";

/** Entry for the MAIN-world bundle (oracle-main.js), injected on demand by the service worker. */
install(oracle);
