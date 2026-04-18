import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
        // Increase timeout for large PDF uploads + SSE streaming (5 min)
        timeout: 300000,
        configure: (proxy) => {
          // Disable buffering for SSE responses
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['connection'] = 'keep-alive';
              proxyRes.headers['x-accel-buffering'] = 'no';
              // Try to flush headers immediately for streaming
              try { (res as any).flushHeaders?.(); } catch {}
            }
          });
          // Increase timeout on the proxy itself for large uploads
          proxy.on('proxyReq', (proxyReq) => {
            // Remove default timeout on the proxy request
            proxyReq.setTimeout(300000);
          });
          // Handle proxy errors gracefully
          proxy.on('error', (err, _req, res) => {
            console.error('[Vite Proxy Error]', err.message);
            if (res && 'writeHead' in res) {
              try {
                (res as any).writeHead(502, { 'Content-Type': 'application/json' });
                (res as any).end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
              } catch {}
            }
          });
        },
      },
    },
  },
})
