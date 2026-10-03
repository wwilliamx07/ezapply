import { install } from "../../engine/api.js";
import { greenhouse } from "./site.js";

/** Entry for the MAIN-world bundle (greenhouse-main.js), injected on demand by the service worker. */
install(greenhouse);
