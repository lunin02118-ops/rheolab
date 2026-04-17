import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { chromium } from '@playwright/test';

const repoRoot = process.cwd();
const defaultUrl = 'https://rheolab.site';
const outputPath = path.join(repoRoot, 'website', 'outputs', 'scroll-profile.json');

function parseArgs(argv) {
  const args = {
    url: defaultUrl,
    output: outputPath,
    trace: true,
    headless: true,
    durationMs: 5000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--url' && next) {
      args.url = next;
      index += 1;
      continue;
    }

    if (arg === '--output' && next) {
      args.output = path.resolve(repoRoot, next);
      index += 1;
      continue;
    }

    if (arg === '--duration' && next) {
      args.durationMs = Number(next);
      index += 1;
      continue;
    }

    if (arg === '--no-trace') {
      args.trace = false;
      continue;
    }

    if (arg === '--headed') {
      args.headless = false;
    }
  }

  return args;
}

function percentile(values, value) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1));
  return sorted[index];
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Number(value.toFixed(digits));
}

function summarizeTrace(events) {
  if (!events.length) {
    return {
      longTasksOver16ms: [],
      longTasksOver50ms: [],
      totalsByEvent: [],
      paintTotals: [],
      topEvents: [],
    };
  }

  const markerEvents = events.filter((event) => event.name === 'scroll-profile-start' || event.name === 'scroll-profile-end');
  const scrollStartTs = markerEvents.find((event) => event.name === 'scroll-profile-start')?.ts;
  const scrollEndTs = markerEvents.find((event) => event.name === 'scroll-profile-end')?.ts;

  if (!scrollStartTs || !scrollEndTs || scrollEndTs <= scrollStartTs) {
    return {
      longTasksOver16ms: [],
      longTasksOver50ms: [],
      totalsByEvent: [],
      paintTotals: [],
      topEvents: [],
    };
  }

  const rendererThreads = new Set(
    events
      .filter((event) => event.name === 'thread_name' && event.args?.name === 'CrRendererMain')
      .map((event) => `${event.pid}:${event.tid}`),
  );
  const visibleEvents = events.filter((event) => {
    if (event.ph !== 'X' || !event.dur) {
      return false;
    }

    if (event.ts > scrollEndTs || event.ts + event.dur < scrollStartTs) {
      return false;
    }

    return rendererThreads.has(`${event.pid}:${event.tid}`);
  });

  const sortedByDuration = [...visibleEvents].sort((left, right) => right.dur - left.dur);
  const toMs = (event) => round(event.dur / 1000, 2);

  const totalsByEvent = new Map();
  for (const event of visibleEvents) {
    totalsByEvent.set(event.name, (totalsByEvent.get(event.name) ?? 0) + event.dur);
  }

  const paintNames = new Set([
    'Paint',
    'PrePaint',
    'Layerize',
    'CompositeLayers',
    'RasterTask',
    'DrawFrame',
    'UpdateLayoutTree',
    'Layout',
    'UpdateLayer',
    'Commit',
  ]);

  const paintTotals = [...totalsByEvent.entries()]
    .filter(([name]) => paintNames.has(name))
    .map(([name, totalDur]) => ({
      name,
      totalMs: round(totalDur / 1000, 2),
    }))
    .sort((left, right) => right.totalMs - left.totalMs);

  return {
    longTasksOver16ms: sortedByDuration
      .filter((event) => event.dur >= 16000)
      .slice(0, 20)
      .map((event) => ({
        name: event.name,
        durationMs: toMs(event),
        tsMs: round((event.ts - scrollStartTs) / 1000, 2),
      })),
    longTasksOver50ms: sortedByDuration
      .filter((event) => event.dur >= 50000)
      .slice(0, 20)
      .map((event) => ({
        name: event.name,
        durationMs: toMs(event),
        tsMs: round((event.ts - scrollStartTs) / 1000, 2),
      })),
    totalsByEvent: [...totalsByEvent.entries()]
      .map(([name, totalDur]) => ({
        name,
        totalMs: round(totalDur / 1000, 2),
      }))
      .sort((left, right) => right.totalMs - left.totalMs)
      .slice(0, 20),
    paintTotals,
    topEvents: sortedByDuration.slice(0, 20).map((event) => ({
      name: event.name,
      durationMs: toMs(event),
      tsMs: round((event.ts - scrollStartTs) / 1000, 2),
    })),
  };
}

const args = parseArgs(process.argv.slice(2));

const browser = await chromium.launch({
  headless: args.headless,
  args: ['--enable-features=LongAnimationFrameObserver'],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

const page = await context.newPage();

await page.addInitScript(() => {
  const perfState = {
    lcp: 0,
    cls: 0,
    longAnimationFrames: [],
    longTasks: [],
  };

  window.__scrollPerfState = perfState;

  try {
    const lcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perfState.lcp = entry.startTime;
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}

  try {
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          perfState.cls += entry.value;
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
  } catch {}

  try {
    const lafObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perfState.longAnimationFrames.push({
          startTime: entry.startTime,
          duration: entry.duration,
          renderStart: entry.renderStart ?? 0,
          styleAndLayoutStart: entry.styleAndLayoutStart ?? 0,
          blockingDuration: entry.blockingDuration ?? 0,
        });
      }
    });
    lafObserver.observe({ type: 'long-animation-frame', buffered: true });
  } catch {}

  try {
    const longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perfState.longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
        });
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch {}
});

const traceEvents = [];

let client = null;
if (args.trace) {
  client = await context.newCDPSession(page);
  client.on('Tracing.dataCollected', ({ value }) => {
    traceEvents.push(...value);
  });
}

await page.goto(args.url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1200);

const baseline = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paints = performance.getEntriesByType('paint');
  const fcp = paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? 0;
  const resources = performance.getEntriesByType('resource');
  const doc = document.documentElement;

  return {
    title: document.title,
    domNodes: document.querySelectorAll('*').length,
    scrollHeight: doc.scrollHeight,
    viewportHeight: window.innerHeight,
    transferSize: nav?.transferSize ?? 0,
    encodedBodySize: nav?.encodedBodySize ?? 0,
    decodedBodySize: nav?.decodedBodySize ?? 0,
    responseEnd: nav?.responseEnd ?? 0,
    domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
    loadEventEnd: nav?.loadEventEnd ?? 0,
    fcp,
    resourceCounts: resources.reduce((acc, entry) => {
      const kind = entry.initiatorType || 'other';
      acc[kind] = (acc[kind] ?? 0) + 1;
      return acc;
    }, {}),
    fonts: resources
      .filter((entry) => entry.initiatorType === 'css' && entry.name.includes('.woff'))
      .map((entry) => ({
        name: entry.name,
        transferSize: entry.transferSize,
        duration: entry.duration,
      })),
  };
});

if (client) {
  await client.send('Tracing.start', {
    transferMode: 'ReportEvents',
    categories: [
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'toplevel',
      'cc',
      'blink.user_timing',
    ].join(','),
  });
}

const scrollStats = await page.evaluate(async (durationMs) => {
  window.scrollTo(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const rafDeltas = [];
  const scrollSamples = [];
  const start = performance.now();

  let previousTs = start;

  performance.mark('scroll-profile-start');

  await new Promise((resolve) => {
    function step(ts) {
      const elapsed = ts - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) * (1 - progress);
      const nextScroll = Math.round(maxScroll * eased);

      rafDeltas.push(ts - previousTs);
      previousTs = ts;

      window.scrollTo(0, nextScroll);
      scrollSamples.push({ t: elapsed, y: window.scrollY });

      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        resolve();
      }
    }

    window.requestAnimationFrame(step);
  });

  await new Promise((resolve) => setTimeout(resolve, 350));
  performance.mark('scroll-profile-end');

  return {
    startTime: start,
    endTime: performance.now(),
    maxScroll,
    frameCount: rafDeltas.length,
    rafDeltas,
    scrollSamples,
    perfState: window.__scrollPerfState,
  };
}, args.durationMs);

if (client) {
  const tracingComplete = new Promise((resolve) => {
    client.once('Tracing.tracingComplete', resolve);
  });

  await client.send('Tracing.end');
  await tracingComplete;
}

await browser.close();

const frameSamples = scrollStats.rafDeltas.slice(1);
const longAnimationFrames = scrollStats.perfState.longAnimationFrames || [];
const longTasks = scrollStats.perfState.longTasks || [];

const report = {
  url: args.url,
  capturedAt: new Date().toISOString(),
  baseline: {
    ...baseline,
    fcp: round(baseline.fcp, 2),
    responseEnd: round(baseline.responseEnd, 2),
    domContentLoaded: round(baseline.domContentLoaded, 2),
    loadEventEnd: round(baseline.loadEventEnd, 2),
    lcp: round(scrollStats.perfState.lcp, 2),
    cls: round(scrollStats.perfState.cls, 4),
  },
  scroll: {
    durationMs: args.durationMs,
    maxScroll: scrollStats.maxScroll,
    frameCount: scrollStats.frameCount,
    avgFrameMs: round(frameSamples.reduce((sum, value) => sum + value, 0) / Math.max(frameSamples.length, 1), 2),
    p95FrameMs: round(percentile(frameSamples, 0.95), 2),
    maxFrameMs: round(Math.max(...frameSamples, 0), 2),
    framesOver16ms: frameSamples.filter((value) => value > 16.7).length,
    framesOver33ms: frameSamples.filter((value) => value > 33.3).length,
    framesOver50ms: frameSamples.filter((value) => value > 50).length,
    approxDroppedFramePct: round(
      (frameSamples.filter((value) => value > 16.7).length / Math.max(frameSamples.length, 1)) * 100,
      2,
    ),
  },
  longAnimationFrames: {
    count: longAnimationFrames.length,
    maxDurationMs: round(Math.max(...longAnimationFrames.map((entry) => entry.duration), 0), 2),
    top: longAnimationFrames
      .sort((left, right) => right.duration - left.duration)
      .slice(0, 10)
      .map((entry) => ({
        startTimeMs: round(entry.startTime, 2),
        durationMs: round(entry.duration, 2),
        blockingDurationMs: round(entry.blockingDuration, 2),
      })),
  },
  longTasks: {
    count: longTasks.length,
    maxDurationMs: round(Math.max(...longTasks.map((entry) => entry.duration), 0), 2),
    top: longTasks
      .sort((left, right) => right.duration - left.duration)
      .slice(0, 10)
      .map((entry) => ({
        startTimeMs: round(entry.startTime, 2),
        durationMs: round(entry.duration, 2),
    })),
  },
  trace: summarizeTrace(traceEvents),
};

await fs.mkdir(path.dirname(args.output), { recursive: true });
await fs.writeFile(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify(report, null, 2));
