import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pure static SPA. The generator writes JSON into public/data/, which Vite serves
// as-is and copies into the build output.
export default defineConfig({
  plugins: [react()],
  server: { port: 5273 },
});
