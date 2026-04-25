/**
 * Cross-platform bundle audit runner.
 *
 * Vite config enables rollup-plugin-visualizer when ANALYZE is set.
 * Keeping this in Node avoids relying on shell-specific env syntax.
 */
process.env.ANALYZE = 'true';

(async () => {
  const { build } = await import('vite');
  await build({ mode: 'production' });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
