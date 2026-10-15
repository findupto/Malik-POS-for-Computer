import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron loads the packaged app through file://, so asset URLs must be relative.
export default defineConfig({
  base: './',
  plugins: [react()]
});
