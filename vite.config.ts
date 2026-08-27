import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  plugins: [react()],
  // The version is written once, in package.json.
  define: { __VERSION__: JSON.stringify(pkg.version) },
  // Capacitor loads the assets over file://: relative paths are mandatory.
  base: './',
  server: { host: true },
})
