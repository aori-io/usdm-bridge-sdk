import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  // The example uses a `file:../..` SDK link. Vite would otherwise try to
  // optimize / prebundle the SDK out of the workspace's node_modules and
  // crash on its CJS+ESM dual exports. Excluding it keeps Vite's optimizer
  // out of our way and lets the SDK load through normal node resolution.
  optimizeDeps: { exclude: ['@aori/usdm-bridge-sdk'] },
});
