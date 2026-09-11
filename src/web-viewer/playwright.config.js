import {defineConfig} from '@playwright/test';
export default defineConfig({testDir: './tests', testMatch: '*.spec.js', workers: 1,
  use: {baseURL: 'http://127.0.0.1:8138'},
  projects: [
    {name: 'chromium', use: {browserName: 'chromium'}},
    {name: 'firefox', testMatch: ['persistence.spec.js', 'inline-comment-regressions.spec.js'], use: {browserName: 'firefox'}},
    {name: 'webkit', testMatch: ['persistence.spec.js', 'inline-comment-regressions.spec.js'], use: {browserName: 'webkit'}},
  ],
  webServer: {command: 'node tests/server.mjs', url: 'http://127.0.0.1:8138', reuseExistingServer: false},
});
