import { createRoot } from "react-dom/client";
import "./onboard.css";
import { dropTokenFromUrl } from "../lib/api.js";
import { OnboardApp } from "./App.js";

dropTokenFromUrl();
const root = document.getElementById("root");
if (root) createRoot(root).render(<OnboardApp />);
