import { install } from "../../engine/api.js";
import { successfactors } from "./site.js";

/** Entry for the MAIN-world bundle (successfactors-main.js), injected on demand by the service worker. */
install(successfactors);
