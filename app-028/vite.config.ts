import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    // 全部资源本地打包，禁止任何外网请求
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
})
