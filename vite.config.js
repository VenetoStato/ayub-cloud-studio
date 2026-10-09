export default {
  build: { target: 'es2022', rollupOptions: { input: { main: 'index.html', mobile: 'mobile.html' } } },
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } }
}
