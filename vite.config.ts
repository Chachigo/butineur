import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Capacitor charge les assets depuis file:// au lot 2 : chemins relatifs obligatoires.
  base: './',
  server: { host: true },
})
