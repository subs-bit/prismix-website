import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      // When opening Vite directly on :5173 during Netlify dev, forward API
      // calls to the Netlify dev server where the real functions run.
      "/api":                  "http://localhost:8888",
      "/.netlify/functions":   "http://localhost:8888",
    },
    watch: {
      usePolling: true,
      interval: 300,
    },
  },
})
