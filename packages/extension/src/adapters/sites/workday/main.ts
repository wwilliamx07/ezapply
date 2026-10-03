import { install } from "../../engine/api.js";
import { workday } from "./site.js";

/** Entry for the MAIN-world bundle (workday-main.js), injected on demand by the service worker. */
install(workday);
