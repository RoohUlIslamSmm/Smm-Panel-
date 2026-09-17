import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: ['merry-miracle-production-116c.up.railway.app'],
  },
})
