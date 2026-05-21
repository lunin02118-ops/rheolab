import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceDir = path.join(repoRoot, 'docs', 'marketing', 'video-scripts', 'promo-professional-source-photos');
const uiDir = path.join(repoRoot, 'docs', 'marketing', 'video-scripts', 'promo-reference-frames');
const outDir = path.join(repoRoot, 'docs', 'marketing', 'video-scripts', 'promo-professional-reference-frames');
const photos = {
  workstation: 'modern-rheology-workstation.png',
  field: 'field-lab-rugged-laptop.png',
  rd: 'rd-chemistry-lab-team.png',
};

const ui = {
  upload: '01-analysis-upload-empty.png',
  chart: '02-import-chart-result.png',
  table: '03-raw-data-table.png',
  save: '04-save-experiment-context.png',
  library: '05-library-search-filters.png',
  comparison: '06-comparison-three-experiments.png',
  metrics: '07-comparison-metrics-controls.png',
  report: '08-report-export-settings.png',
  settings: '09-settings-data-system.png',
};

async function dataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.svg' ? 'image/svg+xml' : 'image/png';
  const bytes = await fs.readFile(filePath);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

const photoUrls = Object.fromEntries(
  await Promise.all(
    Object.entries(photos).map(async ([key, filename]) => [
      key,
      await dataUrl(path.join(sourceDir, filename)),
    ]),
  ),
);

const uiUrls = Object.fromEntries(
  await Promise.all(
    Object.entries(ui).map(async ([key, filename]) => [
      key,
      await dataUrl(path.join(uiDir, filename)),
    ]),
  ),
);

const css = `
  * { box-sizing: border-box; }
  html, body { width: 1600px; height: 900px; margin: 0; overflow: hidden; }
  body { background: #0f172a; }
  .frame {
    position: relative;
    width: 1600px;
    height: 900px;
    overflow: hidden;
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    color: #f8fafc;
  }
  .photo {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    transform: scale(1.01);
  }
  .vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 72% 42%, transparent 0%, transparent 42%, rgba(2,6,23,0.18) 78%),
      linear-gradient(90deg, rgba(2,6,23,0.50) 0%, rgba(2,6,23,0.10) 42%, rgba(2,6,23,0.28) 100%);
    pointer-events: none;
  }
  .light .vignette {
    background:
      radial-gradient(circle at 70% 40%, transparent 0%, transparent 44%, rgba(15,23,42,0.12) 82%),
      linear-gradient(90deg, rgba(248,250,252,0.06) 0%, rgba(15,23,42,0.06) 44%, rgba(15,23,42,0.20) 100%);
  }
  .ui {
    position: absolute;
    overflow: hidden;
    background: #f8fafc;
    box-shadow: 0 20px 55px rgba(0,0,0,0.28);
  }
  .ui img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }
  .screen-glass::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(115deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.05) 28%, transparent 48%),
      radial-gradient(circle at 80% 12%, rgba(255,255,255,0.20), transparent 22%);
    mix-blend-mode: screen;
  }
  .tag {
    position: absolute;
    left: 64px;
    bottom: 54px;
    max-width: 720px;
    padding: 22px 26px;
    border-radius: 24px;
    background: rgba(15,23,42,0.64);
    border: 1px solid rgba(226,232,240,0.22);
    backdrop-filter: blur(10px);
    box-shadow: 0 24px 70px rgba(0,0,0,0.28);
  }
  .tag h1 {
    margin: 0 0 8px;
    font-size: 34px;
    line-height: 1.08;
    font-weight: 850;
    letter-spacing: 0;
  }
  .tag p {
    margin: 0;
    max-width: 610px;
    font-size: 17px;
    line-height: 1.35;
    color: #dbeafe;
    font-weight: 500;
  }
  .brand {
    position: absolute;
    left: 58px;
    top: 48px;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 18px;
    border-radius: 22px;
    background: rgba(255,255,255,0.86);
    border: 1px solid rgba(148,163,184,0.40);
    box-shadow: 0 18px 45px rgba(15,23,42,0.20);
    color: #0f172a;
    font-weight: 850;
    font-size: 22px;
  }
  .brand img { width: 50px; height: 50px; object-fit: contain; }
  .note {
    position: absolute;
    right: 54px;
    bottom: 48px;
    width: 330px;
    color: rgba(226,232,240,0.92);
    font-size: 13px;
    line-height: 1.42;
    padding: 14px 16px;
    border-radius: 18px;
    background: rgba(15,23,42,0.52);
    border: 1px solid rgba(226,232,240,0.18);
  }
`;

const scenes = [
  {
    file: 'professional-01-field-lab-import.png',
    photo: 'field',
    html: `
      <div class="ui screen-glass" style="left: 444px; top: 352px; width: 392px; height: 235px; border-radius: 8px; transform: perspective(840px) rotateX(1deg) rotateY(-4deg) rotateZ(-1.5deg); clip-path: polygon(1% 2%, 99% 0%, 98% 100%, 0% 98%);">
        <img src="${uiUrls.upload}">
      </div>`,
  },
  {
    file: 'professional-02-modern-workstation-chart.png',
    photo: 'workstation',
    html: `
      <div class="ui screen-glass" style="left: 868px; top: 276px; width: 530px; height: 303px; border-radius: 8px; transform: perspective(920px) rotateX(0deg) rotateY(-4deg) rotateZ(0.5deg); clip-path: polygon(0% 4%, 100% 0%, 99% 99%, 1% 96%);">
        <img src="${uiUrls.chart}">
      </div>`,
  },
  {
    file: 'professional-03-rd-lab-comparison.png',
    photo: 'rd',
    html: `
      <div class="ui screen-glass" style="left: 548px; top: 72px; width: 805px; height: 510px; border-radius: 6px; transform: perspective(1200px) rotateY(-1.5deg) rotateZ(0.2deg); clip-path: polygon(0% 1%, 100% 0%, 99.5% 99%, 0% 99%);">
        <img src="${uiUrls.comparison}">
      </div>`,
  },
  {
    file: 'professional-04-rheometer-table-data.png',
    photo: 'workstation',
    html: `
      <div class="ui screen-glass" style="left: 870px; top: 276px; width: 530px; height: 303px; border-radius: 8px; transform: perspective(920px) rotateX(0deg) rotateY(-4deg) rotateZ(0.5deg); clip-path: polygon(0% 4%, 100% 0%, 99% 99%, 1% 96%);">
        <img src="${uiUrls.table}">
      </div>`,
  },
  {
    file: 'professional-05-field-lab-report.png',
    photo: 'field',
    html: `
      <div class="ui screen-glass" style="left: 444px; top: 352px; width: 392px; height: 235px; border-radius: 8px; transform: perspective(840px) rotateX(1deg) rotateY(-4deg) rotateZ(-1.5deg); clip-path: polygon(1% 2%, 99% 0%, 98% 100%, 0% 98%);">
        <img src="${uiUrls.report}">
      </div>`,
  },
  {
    file: 'professional-06-enterprise-local-settings.png',
    photo: 'rd',
    html: `
      <div class="ui screen-glass" style="left: 548px; top: 72px; width: 805px; height: 510px; border-radius: 6px; transform: perspective(1200px) rotateY(-1.5deg) rotateZ(0.2deg); clip-path: polygon(0% 1%, 100% 0%, 99.5% 99%, 0% 99%);">
        <img src="${uiUrls.settings}">
      </div>`,
  },
];

function html(scene) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>${css}</style>
      </head>
      <body>
        <div class="frame">
          <div class="photo" style="background-image:url(${photoUrls[scene.photo]})"></div>
          <div class="vignette"></div>
          ${scene.html}
        </div>
      </body>
    </html>`;
}

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  for (const scene of scenes) {
    await page.setContent(html(scene), { waitUntil: 'load' });
    await page.screenshot({
      path: path.join(outDir, scene.file),
      fullPage: false,
      animations: 'disabled',
    });
    console.log(`wrote ${path.join(outDir, scene.file)}`);
  }
} finally {
  await browser.close();
}
