import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Solo le variabili VITE_* finiscono nel bundle (briefing §2.3).
  envPrefix: 'VITE_',
  server: { port: 5173, strictPort: true },
});
