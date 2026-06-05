import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const repo = '/Users/yem/Documents/my-project/demo/dom-design';
const extPath = path.join(repo, 'packages/extension');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Loupe manual auth test</title></head><body style="font:16px system-ui;padding:40px"><h1 id="hero-heading">Loupe manual auth test</h1><button id="target-button">Target button</button><p>Unauthorized origin should show Loupe auth CTA before toolbar grant.</p></body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, {'content-type':'text/html'}); res.end(html); });
await new Promise(resolve => server.listen(5992, '127.0.0.1', resolve));
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loupe-real-pw-profile-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extPath}`,
    `--load-extension=${extPath}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
const page = await context.newPage();
const logs = [];
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
await page.goto('http://127.0.0.1:5992/');
await page.waitForTimeout(1500);
const state = await page.evaluate(() => ({
  title: document.title,
  surfaceRoot: !!document.querySelector('#loupe-surface-root'),
  authMarker: !!document.querySelector('#loupe-extension-root'),
  body: document.body.innerText,
}));
const shot = '/tmp/loupe-real-browser-auth-before-click.png';
await page.screenshot({ path: shot, fullPage: false });
console.log(JSON.stringify({ url: page.url(), state, logs, screenshot: shot, userDataDir }, null, 2));
console.log('Browser kept open. Ctrl-C this process when done.');
await new Promise(() => {});
