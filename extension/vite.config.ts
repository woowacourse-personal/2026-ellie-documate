import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  // content script가 남의 페이지에서 안정적으로 동작하도록 최신 문법 유지
  build: {
    target: 'esnext',
  },
});
