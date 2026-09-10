import {defineConfig} from '@playwright/test';
export default defineConfig({testDir: './tests', testMatch: '*.spec.js', workers: 1,
  use: {baseURL: 'http://127.0.0.1:8138', browserName: 'chromium'},
  webServer: {command: 'node tests/server.mjs', url: 'http://127.0.0.1:8138', reuseExistingServer: false},
});
