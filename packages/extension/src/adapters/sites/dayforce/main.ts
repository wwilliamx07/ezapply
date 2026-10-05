import { install } from "../../engine/api.js";
import { dayforce } from "./site.js";

/** Entry for the MAIN-world bundle (dayforce-main.js), injected on demand by the service worker. */
install(dayforce);
