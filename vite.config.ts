import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  plugins: [react()],
  // La version n'est écrite qu'une fois, dans package.json.
  define: { __VERSION__: JSON.stringify(pkg.version) },
  // Capacitor charge les assets depuis file:// au lot 2 : chemins relatifs obligatoires.
  base: './',
  server: { host: true },
})
