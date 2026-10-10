import { PanelApp } from "@ezapply/ui/panel";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { portTransport } from "./transport.js";
import "@ezapply/ui/base.css";
import "@ezapply/ui/panel.css";

// MV3 forbids eval; stop zod (the protocol's checks run in the panel) from probing for it.
z.config({ jitless: true });

const root = document.getElementById("root");
if (root) createRoot(root).render(<PanelApp transport={portTransport()} />);
