import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              output: { format: 'cjs', entryFileNames: 'preload.cjs' },
            },
          },
        },
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // gsap 体积较大且与业务代码无耦合，独立成块便于浏览器缓存
        manualChunks(id) {
          if (id.includes('node_modules/gsap')) return 'gsap'
        },
      },
    },
  },
})
