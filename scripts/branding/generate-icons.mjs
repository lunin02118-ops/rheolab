import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceLogoPath = join(repoRoot, 'src', 'assets', 'brand', 'rheolab-logo.svg');
const appIconSvgPath = join(repoRoot, 'src', 'assets', 'brand', 'rheolab-app-icon.svg');
const publicFaviconSvgPath = join(repoRoot, 'public', 'favicon.svg');
const publicFaviconIcoPath = join(repoRoot, 'public', 'favicon.ico');
const tauriIconPath = join(repoRoot, 'src-tauri', 'icons', 'icon.ico');
const previewDir = join(repoRoot, 'outputs', 'logo-preview');
const previewPngPath = join(previewDir, 'app-icon-white-circle-256.png');

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildAppIconSvg(logoSvg) {
  const viewBoxMatch = logoSvg.match(/\bviewBox="([^"]+)"/i);
  if (!viewBoxMatch) {
    throw new Error(`Missing viewBox in ${sourceLogoPath}`);
  }

  const [viewBoxX, viewBoxY, viewBoxWidth] = viewBoxMatch[1]
    .trim()
    .split(/\s+/)
    .map(Number);

  if (![viewBoxX, viewBoxY, viewBoxWidth].every(Number.isFinite) || viewBoxWidth <= 0) {
    throw new Error(`Invalid viewBox in ${sourceLogoPath}: ${viewBoxMatch[1]}`);
  }

  const innerSvg = logoSvg
    .replace(/^[\s\S]*?<svg\b[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
    .trim();

  const canvasSize = 2048;
  const logoBox = 1740;
  const logoOffset = (canvasSize - logoBox) / 2;
  const logoScale = logoBox / viewBoxWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}" aria-label="RheoLab app icon" role="img">
  <circle cx="1024" cy="1024" r="988" fill="#FFFFFF"/>
  <circle cx="1024" cy="1024" r="988" fill="none" stroke="#DCEAF5" stroke-width="40"/>
  <g transform="translate(${logoOffset} ${logoOffset}) scale(${logoScale}) translate(${-viewBoxX} ${-viewBoxY})">
${innerSvg}
  </g>
</svg>
`;
}

async function renderSvgToPng(svg, size, page) {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body {
        width: ${size}px;
        height: ${size}px;
        margin: 0;
        padding: 0;
        background: transparent;
        overflow: hidden;
      }
      img {
        display: block;
        width: ${size}px;
        height: ${size}px;
      }
    </style>
  </head>
  <body><img alt="RheoLab icon" src="${dataUrl}"></body>
</html>`);
  return await page.screenshot({ omitBackground: true, type: 'png' });
}

function buildIco(pngImages) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngImages.length, 4);

  const directory = Buffer.alloc(pngImages.length * 16);
  let offset = header.length + directory.length;

  pngImages.forEach(({ size, png }, index) => {
    const entryOffset = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(png.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...pngImages.map(({ png }) => png)]);
}

async function main() {
  const logoSvg = await readFile(sourceLogoPath, 'utf8');
  const appIconSvg = buildAppIconSvg(logoSvg);

  await mkdir(dirname(appIconSvgPath), { recursive: true });
  await mkdir(dirname(publicFaviconSvgPath), { recursive: true });
  await mkdir(dirname(tauriIconPath), { recursive: true });
  await mkdir(previewDir, { recursive: true });

  await writeFile(appIconSvgPath, appIconSvg, 'utf8');
  await writeFile(publicFaviconSvgPath, appIconSvg, 'utf8');

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
    const pngImages = [];
    for (const size of ICON_SIZES) {
      const png = await renderSvgToPng(appIconSvg, size, page);
      pngImages.push({ size, png });
      if (size === 256) {
        await writeFile(previewPngPath, png);
      }
    }

    const ico = buildIco(pngImages);
    await writeFile(tauriIconPath, ico);
    await writeFile(publicFaviconIcoPath, ico);
  } finally {
    await browser.close();
  }

  console.log(`Generated ${appIconSvgPath}`);
  console.log(`Generated ${publicFaviconSvgPath}`);
  console.log(`Generated ${publicFaviconIcoPath}`);
  console.log(`Generated ${tauriIconPath}`);
  console.log(`Generated ${previewPngPath}`);
}

await main();
