// Home-screen / install icons from assets/icons/icon.svg: icon-192.png, icon-512.png (web app manifest) and
// apple-touch-icon.png (180 px, iOS "Add to Home Screen"). Rendered with the same headless Chrome as the other tools.
// usage: node tools/app-icons.mjs   (re-run after editing icon.svg; the committed PNGs were then quantized to 128
// colours with Pillow — Image.quantize(128) + optimize — which cuts them to about a third)
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchOptions } from './browser.mjs';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/icons');
const svg = readFileSync(`${DIR}/icon.svg`, 'utf8');
const browser = await puppeteer.launch(launchOptions({ width: 512, height: 512, software: false }));
const page = await browser.newPage();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: `${DIR}/${name}`, omitBackground: false });
  console.log(`assets/icons/${name}`);
}
await browser.close();
