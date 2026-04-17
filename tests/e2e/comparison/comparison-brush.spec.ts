import { test, expect, setupBeforeEach } from '../base-test';
import { CHANDLER_SST_63 } from '../fixtures';

setupBeforeEach(test);

test.describe('Comparison — Chart Brush (Zoom Panel)', () => {
  test.setTimeout(90_000);

  test('brush_drag_updates_chart_scale', async ({ dashboard, comparison, page }) => {
    // 1. Upload and save an experiment so we have data to show
    await dashboard.uploadFile(CHANDLER_SST_63);
    await dashboard.waitForAnalysis();
    await dashboard.saveExperiment({ name: `Brush Test ${Date.now()}` });

    // 2. Go to comparison and add the experiment
    await comparison.goto();
    await comparison.expectLoaded();
    await comparison.openSelector();
    await comparison.addExperimentByIndex(0);
    await comparison.expectChartVisible();

    // Wait for the chart and brush to render
    await page.waitForTimeout(1000);

    // 3. Locate the brush container
    // The brush is rendered below the chart. We can find it by looking for the canvas inside the brush container.
    const brushContainer = page.locator('.touch-none').filter({ has: page.locator('canvas') }).first();
    await expect(brushContainer).toBeVisible();

    // 4. Get the initial chart x-axis scale (we can check the DOM for tick labels or just perform the drag and ensure no errors)
    // A better way is to check if the brush handles are present and draggable.
    const leftHandle = brushContainer.locator('.cursor-ew-resize').first();
    const rightHandle = brushContainer.locator('.cursor-ew-resize').last();

    await expect(leftHandle).toBeVisible();
    await expect(rightHandle).toBeVisible();

    // 5. Perform a drag on the left handle to zoom in
    const leftHandleBox = await leftHandle.boundingBox();
    expect(leftHandleBox).not.toBeNull();

    if (leftHandleBox) {
      const startX = leftHandleBox.x + leftHandleBox.width / 2;
      const startY = leftHandleBox.y + leftHandleBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Drag to the right by 100 pixels
      await page.mouse.move(startX + 100, startY, { steps: 10 });
      await page.mouse.up();
    }

    // Wait a moment for the chart to update
    await page.waitForTimeout(500);

    // 6. Verify the brush range text is visible (e.g., "X.Xм")
    // When zoomed, the brush shows the current range text in blue
    const rangeText = brushContainer.locator('.text-blue-300').first();
    await expect(rangeText).toBeVisible();

    // 7. Double click the brush to reset zoom
    await brushContainer.dblclick();
    await page.waitForTimeout(500);

    // The range text should disappear when reset to full range
    await expect(rangeText).not.toBeVisible();
  });
});
