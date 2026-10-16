import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests',testMatch:'**/*.spec.ts',workers:1,fullyParallel:false,
 use:{baseURL:'http://127.0.0.1:4173',headless:true,launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']},trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'npx tsx tests/preview.ts',url:'http://127.0.0.1:4173/api/health',reuseExistingServer:false,timeout:30000},
 reporter:[['list']],
});
