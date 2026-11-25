import React from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";
import App from "./App";
import { AccountShell } from "./Accounts";
createRoot(document.getElementById("root")!).render(<AccountShell><App /></AccountShell>);
