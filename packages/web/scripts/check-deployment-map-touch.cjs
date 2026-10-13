// Browser regression for actual multi-touch input, including gestures over pins.
// Requires Playwright + Chromium and a running website. See deployment-map/README.md.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/googletagmanager.com/**', (route) => route.abort());
    await page.route('**/api/metrics/**', (route) => route.fulfill({ json: { count: 0 } }));
    await page.goto(process.env.MAP_REVIEW_URL || 'http://127.0.0.1:3105', {
      waitUntil: 'networkidle',
    });
    const map = page.getByRole('group', { name: /Interactive deployment map/ });
    // Wait for hydration and the mobile ResizeObserver before sending touches.
    await page.waitForFunction(() =>
      document.querySelector('#archipelago svg[role="group"]')?.getAttribute('viewBox') === '0 0 640 780');
    const land = page.getByTestId('map-land');
    const cdp = await page.context().newCDPSession(page);
    const button = (name) => page.getByRole('button', { name, exact: true });
    const center = async (locator) => {
      const box = await locator.boundingBox();
      assert.ok(box, 'Touch target must be visible');
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const camera = async () => {
      const transform = await land.getAttribute('transform');
      const match = transform.match(/translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/);
      assert.ok(match, transform);
      return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
    };
    const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map((point, id) => ({ ...point, id: id + 1 })),
    });
    const reset = async (mode = 'Direct Downloads') => {
      await button(mode).click();
      await map.scrollIntoViewIfNeeded();
    };
    const background = async () => {
      const box = await map.boundingBox();
      return { x: box.x + 45, y: box.y + 100 };
    };
    const assertHit = async (point, name) => {
      const hit = await page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('[role="button"]')?.getAttribute('aria-label'), point);
      assert.equal(hit, name, 'Gesture must really start on the intended marker');
    };
    const pinch = async (name, a, b) => {
      const before = await camera();
      const scrollBefore = await page.evaluate(() => ({ y: scrollY, scale: visualViewport.scale }));
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const points = (ratio) => [a, b].map((point) => ({
        x: middle.x + (point.x - middle.x) * ratio,
        y: middle.y + (point.y - middle.y) * ratio,
      }));
      await touch('touchStart', [a, b]);
      for (let i = 1; i <= 8; i++) await touch('touchMove', points(1 + i * 0.075));
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const spread = await camera();
      // Translation alone is not evidence of pinch zoom: assert the actual scale.
      assert.ok(Math.abs(spread.scale / before.scale - 1.6) < 0.04, `${name}: spread must zoom in (${before.scale} → ${spread.scale})`);
      for (let i = 1; i <= 8; i++) await touch('touchMove', points(1.6 - i * 0.075));
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const closed = await camera();
      assert.ok(Math.abs(closed.scale / before.scale - 1) < 0.04, `${name}: pinch must zoom out`);
      assert.ok(Math.abs(closed.x - before.x) < 4 && Math.abs(closed.y - before.y) < 4,
        `${name}: returning fingers must restore the map around their midpoint`);
      await touch('touchEnd');
      assert.deepEqual(await page.evaluate(() => ({ y: scrollY, scale: visualViewport.scale })),
        scrollBefore, `${name}: gesture must not zoom or scroll the webpage`);
      console.log(`PASS ${name}: ${before.scale.toFixed(2)} → ${spread.scale.toFixed(2)} → ${closed.scale.toFixed(2)}`);
    };

    await reset();
    const blank = await background();
    await pinch('map background', blank, { x: blank.x + 80, y: blank.y + 30 });

    await reset();
    const cebu = button('Cebu: direct download location');
    const cebuPoint = await center(cebu);
    await assertHit(cebuPoint, 'Cebu: direct download location');
    await pinch('one finger on a download pin', cebuPoint, {
      x: cebuPoint.x + 70, y: cebuPoint.y + 20,
    });
    assert.equal(await page.getByRole('heading', { name: 'Cebu', exact: true }).count(), 0,
      'A pinch must not open pin details');
    await cebu.tap();
    await page.getByRole('heading', { name: 'Cebu', exact: true }).waitFor();

    await reset();
    const palawan = await center(button('Palawan: direct download location'));
    await assertHit(palawan, 'Palawan: direct download location');
    await pinch('both fingers on download pins', palawan, await center(cebu));

    await reset('Pilot sites');
    const pilotPin = button('Open Calapacuan details');
    const pilotPoint = await center(pilotPin);
    await assertHit(pilotPoint, 'Open Calapacuan details');
    await pinch('pilot pin', pilotPoint, await background());
    assert.equal(await page.getByRole('heading', { name: 'Calapacuan', exact: true }).count(), 0);
    await pilotPin.tap();
    await page.getByRole('heading', { name: 'Calapacuan', exact: true }).waitFor();
    const bannerName = 'Calapacuan, Pilot Site (launched 23 Sept 2026), 36 mobile phones donated';
    const bannerPoint = await center(button(bannerName));
    await assertHit(bannerPoint, bannerName);
    await pinch('pilot banner', bannerPoint, await background());

    await reset();
    const start = await center(cebu);
    const beforeDrag = await camera();
    await touch('touchStart', [start]);
    await touch('touchMove', [{ x: start.x + 35, y: start.y + 20 }]);
    await touch('touchEnd');
    const afterDrag = await camera();
    assert.equal(afterDrag.scale, beforeDrag.scale, 'One-finger drag must not zoom');
    assert.ok(Math.abs(afterDrag.x - beforeDrag.x) > 20, 'Dragging from a pin must pan');
    assert.equal(await page.getByRole('heading', { name: 'Cebu', exact: true }).count(), 0);

    await reset();
    const cancelStart = await center(cebu);
    await touch('touchStart', [cancelStart, await background()]);
    await touch('touchCancel');
    await pinch('pinch after cancellation', await center(cebu), await background());
    await cebu.tap();
    await page.getByRole('heading', { name: 'Cebu', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('PASS tap selection, drag, cancellation, viewport stability and browser errors');
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
