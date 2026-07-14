import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 150000,
  // Run one work at a time: this suite measures load performance, so
  // concurrent runs sharing CPU/network would skew timing measurements.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
});
