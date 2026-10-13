// Run against a local preview with a disposable DB and RESEND_API_KEY empty.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const base = process.env.PILOT_REVIEW_URL || 'http://127.0.0.1:3109';
  assert.ok(
    ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
    'Never submit test applications to production'
  );
  const screenshots = path.resolve(__dirname, '../../../build/pilot-application-preview');
  fs.mkdirSync(screenshots, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/googletagmanager.com/**', (r) => r.abort());
    await page.route('**/api/metrics/**', (r) => r.fulfill({ json: { count: 0 } }));
    await page.goto(base, { waitUntil: 'networkidle' });
    const invitation = page.getByRole('region', { name: 'Want to deploy Hiraia in your school?' });
    await invitation.scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(() => {
        const download = document.querySelector('#download');
        const band = document.querySelector('#pilot-invitation-title').closest('section');
        const map = document.querySelector('#archipelago');
        return (
          Boolean(download.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          Boolean(band.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      }),
      true
    );
    await page.evaluate(() =>
      window.scrollTo(
        0,
        document.querySelector('#pilot-invitation-title').getBoundingClientRect().top +
          scrollY -
          300
      )
    );
    await page.screenshot({ path: path.join(screenshots, 'homepage-desktop.png') });
    await page.getByRole('link', { name: 'Apply for a pilot program!' }).click();
    await page.waitForURL('**/pilot');
    await page.getByRole('heading', { name: 'Pilot application', exact: true }).waitFor();
    await page.screenshot({
      path: path.join(screenshots, 'application-desktop.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Send pilot application' }).click();
    await page.locator('#pilot-form').getByRole('alert').waitFor();
    assert.ok((await page.locator('[aria-invalid="true"]').count()) >= 10);
    await page.getByLabel('Full name', { exact: true }).fill('Preview Teacher');
    await page.getByLabel('Role or position', { exact: true }).fill('Science teacher');
    await page.getByLabel('Email address', { exact: true }).fill('preview@example.test');
    await page.getByLabel('Institution name', { exact: true }).fill('Example Pilot School');
    await page.getByLabel('Institution type', { exact: true }).selectOption('Public school');
    await page.getByLabel('City or municipality', { exact: true }).fill('Navotas');
    await page.getByLabel('Province / Metro Manila', { exact: true }).selectOption('Metro Manila');
    const fillClass = async (number, name, grade, students) => {
      const group = page.getByRole('group', { name: `Class ${number}`, exact: true });
      await group.getByLabel('Class / section name', { exact: true }).fill(name);
      await group.getByLabel('Grade level', { exact: true }).selectOption(grade);
      await group.getByLabel('Number of students', { exact: true }).fill(students);
    };
    await fillClass(1, 'Mabini', '4', '40');
    await page.getByRole('button', { name: '+ Add another class', exact: true }).click();
    await fillClass(2, 'Remove this class', '5', '20');
    await page.getByRole('button', { name: '+ Add another class', exact: true }).click();
    await fillClass(3, 'Rizal', '6', '35');
    await page.getByRole('button', { name: 'Remove class 2', exact: true }).click();
    assert.equal(
      await page
        .getByRole('group', { name: 'Class 2', exact: true })
        .getByLabel('Class / section name', { exact: true })
        .inputValue(),
      'Rizal'
    );
    await page
      .getByLabel('What are the needs of your school and students?', { exact: true })
      .fill(
        'Our students need extra science practice and have limited learning materials at home. We share devices at school.'
      );
    await page
      .getByLabel('Why would AI-assisted tutoring help your students?', { exact: true })
      .fill(
        'An offline tutor would help students review ideas after class. Teachers could use their questions to guide the next lesson.'
      );
    await page.getByRole('checkbox').check();
    const requests = [];
    await page.route('**/api/pilot-applications', async (route) => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) {
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort('failed'); // server saved it; browser did not receive the response
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Send pilot application' }).click();
    await page.getByText('We could not confirm your submission.', { exact: false }).waitFor();
    assert.equal(
      await page.getByLabel('Institution name', { exact: true }).inputValue(),
      'Example Pilot School'
    );
    await page.getByRole('button', { name: 'Send pilot application' }).click();
    await page.getByRole('heading', { name: 'Application received' }).waitFor();
    assert.equal(requests.length, 2);
    assert.equal(requests[0].requestId, requests[1].requestId);
    assert.deepEqual(requests[1].classes, [
      { name: 'Mabini', grade: '4', students: 40 },
      { name: 'Rizal', grade: '6', students: 35 },
    ]);
    await page.screenshot({
      path: path.join(screenshots, 'application-success.png'),
      fullPage: true,
    });
    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    mobile.on('pageerror', (e) => errors.push(e.message));
    await mobile.route('**/googletagmanager.com/**', (r) => r.abort());
    await mobile.route('**/api/metrics/**', (r) => r.fulfill({ json: { count: 0 } }));
    await mobile.goto(`${base}/pilot`, { waitUntil: 'networkidle' });
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await mobile.screenshot({
      path: path.join(screenshots, 'application-mobile.png'),
      fullPage: true,
    });
    await mobile.getByRole('button', { name: '+ Add another class', exact: true }).tap();
    await mobile.getByRole('group', { name: 'Class 2', exact: true }).waitFor();
    assert.equal(await mobile.evaluate(() => document.activeElement?.id), 'classes.1.name');
    await mobile.goto(base, { waitUntil: 'networkidle' });
    await mobile
      .getByRole('region', { name: 'Want to deploy Hiraia in your school?' })
      .scrollIntoViewIfNeeded();
    await mobile.evaluate(() =>
      window.scrollTo(
        0,
        document.querySelector('#pilot-invitation-title').getBoundingClientRect().top +
          scrollY -
          180
      )
    );
    await mobile.screenshot({ path: path.join(screenshots, 'homepage-mobile.png') });
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const withoutScripts = await browser.newPage({ javaScriptEnabled: false });
    await withoutScripts.goto(`${base}/pilot`);
    assert.equal(
      await withoutScripts.getByRole('button', { name: 'Send pilot application' }).isDisabled(),
      true
    );
    assert.equal(
      await withoutScripts.locator('#pilot-form').getAttribute('method'),
      'post',
      'No fallback may put private fields in a GET URL'
    );
    // Playwright's text selector deliberately excludes noscript, even with JS disabled.
    await withoutScripts.locator('noscript p').waitFor({ state: 'visible' });
    assert.equal(
      await withoutScripts.locator('noscript p').textContent(),
      'Please enable JavaScript and reload this page to send your application.'
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS: homepage placement, validation, multiple classes, removal, lost-response retry, success, mobile layout and focus.'
    );
    console.log(`Screenshots: ${screenshots}`);
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
