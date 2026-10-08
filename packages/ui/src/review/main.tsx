import { createRoot } from "react-dom/client";
import "./review.css";
import { dropTokenFromUrl } from "../lib/api.js";
import { ReviewApp } from "./App.js";

dropTokenFromUrl();
const root = document.getElementById("root");
if (root) createRoot(root).render(<ReviewApp />);
