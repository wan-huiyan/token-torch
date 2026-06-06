import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles-tokens.css";
import { App } from "./App";
import { initReduceMotion } from "./dashboard/reduceMotion";

// Apply the saved reduce-motion preference before the first render so a reload
// with "reduced" saved starts fully static (no flash-then-stop). (#56)
initReduceMotion();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
