import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Netlify / 本機：base 用 './' 或 '/'，部署在根路徑
// GitHub Pages：建構時設 VITE_BASE_PATH=/bees_game/
const base = process.env.VITE_BASE_PATH ?? './'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base,
})
