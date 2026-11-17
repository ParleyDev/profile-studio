import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// A static site: everything happens in the browser, nothing is uploaded anywhere.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5310 },
  preview: { port: 5311 },
})
