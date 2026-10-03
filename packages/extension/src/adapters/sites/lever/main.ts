import { install } from "../../engine/api.js";
import { lever } from "./site.js";

/** Entry for the MAIN-world bundle (lever-main.js), injected on demand by the service worker. */
install(lever);
