// Shared headless-browser launch settings for the tools (smoke, play, shots, measurements).
// Picks a Chrome/Chromium binary per platform (override with CHROME_PATH) and the matching GPU flags:
// macOS uses the real GPU through ANGLE/Metal; Linux containers usually have no GPU, so WebGL runs on SwiftShader
// (software: frame rates there are only good for before/after comparisons on the same machine, never absolute).
import { existsSync } from 'node:fs';

const CANDIDATES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'],
  linux: ['/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
};

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const hit = (CANDIDATES[process.platform] || []).find((p) => existsSync(p));
  if (!hit) throw new Error('no Chrome/Chromium found — set CHROME_PATH to the browser binary');
  return hit;
}

// GPU flags for WebGL. `software` forces SwiftShader everywhere (reproducible numbers across machines).
export function gpuArgs({ software = process.platform === 'linux' } = {}) {
  if (software) return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  if (process.platform === 'darwin') return ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
  return ['--enable-gpu', '--ignore-gpu-blocklist'];
}

// Containers run as root, where Chrome refuses to start with its sandbox on.
export function sandboxArgs() {
  return process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [];
}

// Everything a tool needs for puppeteer.launch(); extra args are appended.
export function launchOptions({ width = 1600, height = 900, extraArgs = [], software } = {}) {
  return {
    executablePath: chromePath(),
    headless: 'new',
    args: [...gpuArgs({ software }), ...sandboxArgs(), '--autoplay-policy=no-user-gesture-required', `--window-size=${width},${height}`, ...extraArgs],
    defaultViewport: { width, height, deviceScaleFactor: 1 },
  };
}

// Device profiles shared by the mobile smoke and the load/fps measurements.
// "mobile" ≈ a mid-range Android phone held landscape: 3× DPR touch screen, 4× slower CPU, DevTools "Fast 4G".
export const PROFILES = {
  desktop: { width: 1600, height: 900, dpr: 1, mobile: false, touch: false, cpuThrottle: 1, network: null },
  mobile: {
    width: 844, height: 390, dpr: 3, mobile: true, touch: true, cpuThrottle: 4,
    network: { latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  },
};

// Apply a profile to a fresh page (viewport, touch, UA, CPU + network throttling). Returns the CDP session.
export async function applyProfile(page, profile) {
  const p = typeof profile === 'string' ? PROFILES[profile] : profile;
  if (!p) throw new Error('unknown profile ' + profile);
  await page.setViewport({ width: p.width, height: p.height, deviceScaleFactor: p.dpr, isMobile: p.mobile, hasTouch: p.touch, isLandscape: p.width > p.height });
  if (p.userAgent) await page.setUserAgent(p.userAgent);
  const cdp = await page.createCDPSession();
  if (p.cpuThrottle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpuThrottle });
  if (p.network) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...p.network });
  }
  return cdp;
}
