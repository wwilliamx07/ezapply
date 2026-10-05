import { install } from "../../engine/api.js";
import { phenom } from "./site.js";

/** Entry for the MAIN-world bundle (phenom-main.js), injected on demand by the service worker. */
install(phenom);
