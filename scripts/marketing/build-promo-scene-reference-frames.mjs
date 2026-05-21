import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const uiDir = path.join(repoRoot, 'docs', 'marketing', 'video-scripts', 'promo-reference-frames');
const outDir = path.join(repoRoot, 'docs', 'marketing', 'video-scripts', 'promo-scene-reference-frames');
const logoPath = path.join(repoRoot, 'public', 'logo.svg');

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
  const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  const bytes = await fs.readFile(filePath);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

const uiDataUrls = Object.fromEntries(
  await Promise.all(
    Object.entries(ui).map(async ([key, filename]) => [
      key,
      await dataUrl(path.join(uiDir, filename)),
    ]),
  ),
);

function uiUrl(key) {
  return uiDataUrls[key];
}

const logoUrl = await dataUrl(logoPath);

const baseCss = `
  * { box-sizing: border-box; }
  html, body { width: 1600px; height: 900px; margin: 0; overflow: hidden; }
  body {
    font-family: Inter, "Segoe UI", Arial, sans-serif;
    color: #0f172a;
    background: #eef4f8;
  }
  .frame {
    position: relative;
    width: 1600px;
    height: 900px;
    overflow: hidden;
    background:
      radial-gradient(circle at 16% 20%, rgba(14, 165, 233, 0.18), transparent 30%),
      radial-gradient(circle at 88% 18%, rgba(15, 23, 42, 0.10), transparent 30%),
      linear-gradient(135deg, #f7fbff 0%, #e8f0f6 48%, #d9e5ed 100%);
  }
  .dark-frame {
    color: #eaf4ff;
    background:
      radial-gradient(circle at 15% 16%, rgba(56, 189, 248, 0.18), transparent 24%),
      radial-gradient(circle at 86% 22%, rgba(14, 165, 233, 0.22), transparent 28%),
      linear-gradient(135deg, #0b1220 0%, #102033 46%, #162c3d 100%);
  }
  .lab-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(15, 23, 42, 0.055) 1px, transparent 1px),
      linear-gradient(90deg, rgba(15, 23, 42, 0.055) 1px, transparent 1px);
    background-size: 52px 52px;
    mask-image: linear-gradient(to bottom, transparent 0%, #000 22%, #000 74%, transparent 100%);
  }
  .dark-frame .lab-grid {
    background-image:
      linear-gradient(rgba(148, 163, 184, 0.11) 1px, transparent 1px),
      linear-gradient(90deg, rgba(148, 163, 184, 0.11) 1px, transparent 1px);
  }
  .logo-badge {
    position: absolute;
    top: 48px;
    left: 64px;
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 14px 20px;
    border-radius: 24px;
    background: rgba(255,255,255,0.84);
    border: 1px solid rgba(148,163,184,0.38);
    box-shadow: 0 18px 50px rgba(15, 23, 42, 0.12);
  }
  .dark-frame .logo-badge {
    background: rgba(15, 23, 42, 0.72);
    border-color: rgba(148, 163, 184, 0.18);
    box-shadow: 0 24px 65px rgba(0,0,0,0.35);
  }
  .logo-badge img { width: 54px; height: 54px; object-fit: contain; }
  .logo-title { display: flex; flex-direction: column; gap: 2px; font-weight: 800; letter-spacing: 0; }
  .logo-title span:first-child { font-size: 24px; }
  .logo-title span:last-child { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; }
  .dark-frame .logo-title span:last-child { color: #93c5fd; }
  .headline {
    position: absolute;
    left: 72px;
    bottom: 132px;
    width: 590px;
    font-size: 40px;
    line-height: 1.12;
    font-weight: 850;
    letter-spacing: 0;
  }
  .subhead {
    position: absolute;
    left: 76px;
    bottom: 56px;
    width: 650px;
    color: #475569;
    font-size: 18px;
    line-height: 1.35;
    font-weight: 500;
  }
  .dark-frame .subhead { color: #bfdbfe; }
  .screen {
    position: absolute;
    overflow: hidden;
    background: #f8fafc;
    border: 1px solid rgba(148, 163, 184, 0.65);
    box-shadow:
      0 34px 90px rgba(15, 23, 42, 0.22),
      0 0 0 10px rgba(255,255,255,0.36);
  }
  .dark-frame .screen {
    border-color: rgba(147,197,253,0.28);
    box-shadow:
      0 46px 110px rgba(0,0,0,0.50),
      0 0 0 10px rgba(15,23,42,0.36);
  }
  .screen img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .monitor {
    border-radius: 24px;
  }
  .monitor::after {
    content: "";
    position: absolute;
    left: 41%;
    right: 41%;
    bottom: -54px;
    height: 54px;
    background: linear-gradient(#8fa4b7, #cbd5e1);
    border-radius: 0 0 18px 18px;
    z-index: -1;
  }
  .monitor::before {
    content: "";
    position: absolute;
    left: 30%;
    right: 30%;
    bottom: -78px;
    height: 24px;
    background: #cbd5e1;
    border-radius: 999px;
    z-index: -1;
    box-shadow: 0 22px 40px rgba(15,23,42,0.15);
  }
  .laptop {
    border-radius: 20px 20px 10px 10px;
  }
  .laptop::after {
    content: "";
    position: absolute;
    left: -28px;
    right: -28px;
    bottom: -34px;
    height: 34px;
    background: linear-gradient(180deg, #cbd5e1, #94a3b8);
    border-radius: 0 0 38px 38px;
    z-index: -1;
  }
  .tablet {
    border-radius: 28px;
    box-shadow: 0 32px 70px rgba(15, 23, 42, 0.22), 0 0 0 16px #172033;
  }
  .callout {
    position: absolute;
    padding: 16px 18px;
    border-radius: 18px;
    background: rgba(255,255,255,0.86);
    border: 1px solid rgba(148,163,184,0.42);
    box-shadow: 0 18px 45px rgba(15,23,42,0.14);
    font-size: 18px;
    font-weight: 750;
    color: #0f172a;
  }
  .dark-frame .callout {
    background: rgba(15,23,42,0.78);
    border-color: rgba(147,197,253,0.30);
    color: #e0f2fe;
  }
  .callout small {
    display: block;
    margin-top: 4px;
    color: #64748b;
    font-size: 13px;
    font-weight: 600;
  }
  .dark-frame .callout small { color: #93c5fd; }
  .bench {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -72px;
    height: 200px;
    background: linear-gradient(180deg, rgba(226,232,240,0.82), rgba(148,163,184,0.72));
    transform: skewY(-2deg);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
  }
  .dark-frame .bench {
    background: linear-gradient(180deg, rgba(51,65,85,0.90), rgba(15,23,42,0.95));
  }
  .sample {
    position: absolute;
    width: 72px;
    height: 132px;
    border-radius: 18px 18px 12px 12px;
    background: linear-gradient(90deg, rgba(255,255,255,0.55), rgba(255,255,255,0.12)), linear-gradient(180deg, #dbeafe 0%, #38bdf8 70%);
    border: 1px solid rgba(59,130,246,0.28);
    box-shadow: 0 18px 34px rgba(15,23,42,0.14);
  }
  .sample::before {
    content: "";
    position: absolute;
    left: 18px;
    right: 18px;
    top: -18px;
    height: 22px;
    border-radius: 8px 8px 3px 3px;
    background: #475569;
  }
  .sample.amber {
    background: linear-gradient(90deg, rgba(255,255,255,0.52), rgba(255,255,255,0.10)), linear-gradient(180deg, #fef3c7 0%, #f59e0b 70%);
    border-color: rgba(245,158,11,0.32);
  }
  .sample.green {
    background: linear-gradient(90deg, rgba(255,255,255,0.52), rgba(255,255,255,0.10)), linear-gradient(180deg, #dcfce7 0%, #22c55e 70%);
    border-color: rgba(34,197,94,0.32);
  }
  .file-card {
    position: absolute;
    width: 214px;
    height: 124px;
    padding: 20px;
    border-radius: 18px;
    background: rgba(255,255,255,0.88);
    border: 1px solid rgba(148,163,184,0.42);
    box-shadow: 0 18px 44px rgba(15,23,42,0.16);
    font-weight: 800;
    color: #0f172a;
  }
  .file-card span {
    display: block;
    margin-top: 18px;
    width: 100%;
    height: 10px;
    border-radius: 999px;
    background: #cbd5e1;
    box-shadow: 0 18px 0 #dbeafe, 0 36px 0 #e2e8f0;
  }
`;

const scenes = [
  {
    file: 'scene-01-files-to-rheolab.png',
    html: `
      <div class="frame dark-frame">
        <div class="lab-grid"></div>
        <div class="logo-badge"><img src="${logoUrl}"><div class="logo-title"><span>RheoLab</span><span>Enterprise workflow</span></div></div>
        <div class="file-card" style="left: 735px; top: 130px; transform: rotate(-7deg);">Excel<span></span></div>
        <div class="file-card" style="left: 1008px; top: 205px; transform: rotate(5deg);">CSV<span></span></div>
        <div class="file-card" style="left: 842px; top: 405px; transform: rotate(3deg);">TXT / DAT<span></span></div>
        <div class="screen laptop" style="left: 760px; top: 560px; width: 610px; height: 344px; transform: perspective(900px) rotateX(4deg) rotateY(-8deg);">
          <img src="${uiUrl('upload')}">
        </div>
        <div class="bench"></div>
        <div class="sample amber" style="left: 1240px; bottom: 76px; transform: rotate(6deg);"></div>
        <div class="sample green" style="left: 1340px; bottom: 68px; transform: rotate(-4deg);"></div>
        <div class="headline">Разные файлы и приборы — один рабочий процесс</div>
        <div class="subhead">Файлы, таблицы и расчёты собираются в один понятный маршрут анализа.</div>
      </div>`,
  },
  {
    file: 'scene-02-import-analysis.png',
    html: `
      <div class="frame">
        <div class="lab-grid"></div>
        <div class="screen monitor" style="left: 625px; top: 112px; width: 860px; height: 484px;">
          <img src="${uiUrl('chart')}">
        </div>
        <div class="bench"></div>
        <div class="sample" style="left: 1040px; bottom: 62px;"></div>
        <div class="sample amber" style="left: 1138px; bottom: 52px;"></div>
        <div class="callout" style="right: 135px; top: 635px;">Импорт и график<small>файл распознан, данные построены</small></div>
        <div class="headline">От файла прибора к графику за один проход</div>
        <div class="subhead">Файл распознан, график и расчётные показатели готовы к анализу.</div>
      </div>`,
  },
  {
    file: 'scene-03-unified-method.png',
    html: `
      <div class="frame">
        <div class="lab-grid"></div>
        <div class="screen monitor" style="left: 720px; top: 82px; width: 728px; height: 410px; transform: rotate(1deg);">
          <img src="${uiUrl('table')}">
        </div>
        <div class="screen laptop" style="left: 610px; top: 510px; width: 560px; height: 315px; transform: rotate(-3deg);">
          <img src="${uiUrl('chart')}">
        </div>
        <div class="callout" style="right: 112px; top: 536px;">Сырые данные<small>расчёт по единой логике</small></div>
        <div class="headline">Не просто график — расчёты по исходным данным</div>
        <div class="subhead">Результаты можно проверять и повторять на единой базе исходных данных.</div>
      </div>`,
  },
  {
    file: 'scene-04-experiment-context.png',
    html: `
      <div class="frame dark-frame">
        <div class="lab-grid"></div>
        <div class="screen tablet" style="left: 725px; top: 118px; width: 720px; height: 405px;">
          <img src="${uiUrl('save')}">
        </div>
        <div class="bench"></div>
        <div class="sample green" style="left: 1110px; bottom: 78px;"></div>
        <div class="sample amber" style="left: 1210px; bottom: 68px;"></div>
        <div class="callout" style="right: 138px; top: 585px;">Контекст опыта<small>объект, скважина, вода, реагенты</small></div>
        <div class="headline">Данные сохраняются вместе с условиями испытания</div>
        <div class="subhead">Опыт можно найти и открыть повторно не только по имени файла, но и по условиям работы.</div>
      </div>`,
  },
  {
    file: 'scene-05-local-library.png',
    html: `
      <div class="frame">
        <div class="lab-grid"></div>
        <div class="screen monitor" style="left: 585px; top: 118px; width: 915px; height: 515px;">
          <img src="${uiUrl('library')}">
        </div>
        <div class="callout" style="right: 120px; top: 672px;">Локальная база<small>поиск, фильтры, повторное открытие</small></div>
        <div class="headline">История испытаний вместо папки с файлами</div>
        <div class="subhead">Фильтры и поиск превращают архив измерений в рабочую базу знаний.</div>
      </div>`,
  },
  {
    file: 'scene-06-comparison-engineering.png',
    html: `
      <div class="frame dark-frame">
        <div class="lab-grid"></div>
        <div class="screen monitor" style="left: 500px; top: 90px; width: 1000px; height: 563px;">
          <img src="${uiUrl('comparison')}">
        </div>
        <div class="bench"></div>
        <div class="sample" style="left: 1120px; bottom: 70px;"></div>
        <div class="sample amber" style="left: 1222px; bottom: 60px;"></div>
        <div class="sample green" style="left: 1324px; bottom: 70px;"></div>
        <div class="callout" style="right: 110px; top: 690px;">Сравнение рецептур<small>общие оси и одинаковый формат</small></div>
        <div class="headline">ГРП, бурение, R&D: сравнить серии на одном экране</div>
        <div class="subhead">Рецептуры, партии и режимы испытаний можно увидеть на общих осях.</div>
      </div>`,
  },
  {
    file: 'scene-07-metrics-controls.png',
    html: `
      <div class="frame">
        <div class="lab-grid"></div>
        <div class="screen monitor" style="left: 560px; top: 124px; width: 890px; height: 501px;">
          <img src="${uiUrl('metrics')}">
        </div>
        <div class="callout" style="right: 130px; top: 664px;">Метрики и оси<small>вязкость, температура, сдвиг, давление</small></div>
        <div class="headline">Смотреть не один показатель, а связанное поведение жидкости</div>
        <div class="subhead">Вязкость, температура, сдвиг и давление помогают увидеть поведение жидкости в контексте.</div>
      </div>`,
  },
  {
    file: 'scene-08-report-delivery.png',
    html: `
      <div class="frame">
        <div class="lab-grid"></div>
        <div class="screen laptop" style="left: 690px; top: 118px; width: 780px; height: 439px;">
          <img src="${uiUrl('report')}">
        </div>
        <div class="file-card" style="left: 900px; top: 635px; transform: rotate(-4deg);">PDF<span></span></div>
        <div class="file-card" style="left: 1150px; top: 650px; transform: rotate(5deg);">Excel<span></span></div>
        <div class="headline">Выводы сразу уходят в отчёт</div>
        <div class="subhead">PDF и Excel подходят для заказчика, инженера, руководителя или исследовательской группы.</div>
      </div>`,
  },
  {
    file: 'scene-09-enterprise-local.png',
    html: `
      <div class="frame dark-frame">
        <div class="lab-grid"></div>
        <div class="screen monitor" style="left: 610px; top: 116px; width: 850px; height: 478px;">
          <img src="${uiUrl('settings')}">
        </div>
        <div class="callout" style="right: 135px; top: 640px;">Корпоративная среда<small>локальная база, резервные копии, офлайн-активация</small></div>
        <div class="headline">Работа в закрытом контуре без лишней инфраструктуры</div>
        <div class="subhead">Локальная база, резервные копии и офлайн-сценарии подходят для корпоративных рабочих мест.</div>
      </div>`,
  },
  {
    file: 'scene-10-final-brand.png',
    html: `
      <div class="frame">
        <div class="lab-grid"></div>
        <img src="${logoUrl}" style="position:absolute; left:120px; top:126px; width:270px; height:270px; object-fit:contain;">
        <div style="position:absolute; left:120px; top:430px; font-size:74px; font-weight:900; letter-spacing:0; color:#0f172a;">RheoLab Enterprise</div>
        <div style="position:absolute; left:126px; top:528px; width:720px; font-size:34px; line-height:1.22; font-weight:700; color:#2563eb;">От сырого файла к инженерному решению</div>
        <div style="position:absolute; left:128px; top:642px; padding:22px 34px; border-radius:22px; background:#0ea5e9; color:white; font-size:26px; font-weight:850; box-shadow:0 20px 60px rgba(14,165,233,0.34);">Скачать актуальную версию</div>
        <div class="screen monitor" style="left:900px; top:168px; width:520px; height:293px; transform: rotate(2deg);">
          <img src="${uiUrl('comparison')}">
        </div>
        <div class="screen laptop" style="left:820px; top:548px; width:520px; height:293px; transform: rotate(-3deg);">
          <img src="${uiUrl('chart')}">
        </div>
      </div>`,
  },
];

function documentHtml(scene) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>${baseCss}</style>
      </head>
      <body>${scene.html}</body>
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
    await page.setContent(documentHtml(scene), { waitUntil: 'load' });
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
