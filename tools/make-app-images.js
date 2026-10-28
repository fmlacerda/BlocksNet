// Draws the iPhone app icon (1024 px, square: iOS rounds the corners) and the launch screen
// from the Rowbusters mark in icon.svg. Run: node tools/make-app-images.js (needs Playwright).
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'ios/App/App/Assets.xcassets');
const mark = fs.readFileSync(path.join(ROOT, 'icon.svg'), 'utf8').match(/<g transform[\s\S]*<\/g>(?=<\/svg>)/)[0];

const svg = (size, bg, markSize) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  <g transform="translate(${(size - markSize) / 2} ${(size - markSize) / 2}) scale(${markSize / 512})">${mark}</g></svg>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const shoot = async (file, size, bg, markSize) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}</style>${svg(size, bg, markSize)}`);
    await page.screenshot({ path: file, type: 'png' });
    console.log(path.relative(ROOT, file));
  };
  await shoot(path.join(ASSETS, 'AppIcon.appiconset/AppIcon-512@2x.png'), 1024, '#251550', 1024);
  for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
    await shoot(path.join(ASSETS, 'Splash.imageset', f), 2732, '#160B2E', 900);
  await browser.close();
})();
