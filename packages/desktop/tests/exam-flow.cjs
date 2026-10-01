const assert = require('node:assert/strict');
const path = require('node:path');
const {expect} = require('@playwright/test');

async function readExam(page) {
  return page.evaluate(() => {
    const api = window.hiraiaDesktop;
    const files = api.sync('fs.list', api.info.paths.database).filter(file => /^hiraia-profile-.*\.db$/.test(file.name));
    for (const file of files) {
      const row = api.sync('db.query', file.name, 'first', "SELECT value FROM settings WHERE key LIKE 'assessment.progress.v1.%'");
      if (row) return JSON.parse(row.value);
    }
    return null;
  });
}

/** Real UI, real profile database, and a full process restart in the shipped app. */
async function verifyExam({app, page, launch, output, report}) {
  await page.getByRole('button', {name:'Settings', exact:true}).click();
  await page.getByRole('button', {name:'Quiz time? 12 items only!', exact:true}).click();
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1366,850));
  const rail = () => page.getByTestId('exam-question-carousel');
  const question = number => page.getByTestId(`exam-question-${number}`);
  const options = number => question(number).getByRole('button', {name:/^[1-3]\. /});
  await expect(rail()).toBeVisible();
  const exam = await readExam(page);
  assert.equal(exam.activeSession.items.length, 12);
  const id = exam.activeSession.id;
  await expect(page.getByRole('button', {name:/^[1-3]\. /})).toHaveCount(36);
  // Measure actual clipping, not just the layout constant or DOM card count.
  const geometry = await rail().evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const widths = [...element.querySelectorAll('[data-testid^="exam-question-"]')].map(card => {
      const rect = card.getBoundingClientRect();
      return Math.max(0, Math.min(rect.right, bounds.right - 16) - Math.max(rect.left, bounds.left + 16)) / rect.width;
    });
    return {width:bounds.width, visibleCards:widths.reduce((a,b)=>a+b,0)};
  });
  assert.ok(geometry.width >= 1200, `Wide-window validation needs a desktop viewport: ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.visibleCards-3.5)<0.06, `Expected 3.5 readable cards: ${JSON.stringify(geometry)}`);
  await page.screenshot({path:path.join(output,'exam-question.png')});
  report.checks.push('all twelve exam questions are available with 3.5 cards in the wide viewport');
  const beforeScroll = await rail().evaluate(element => element.scrollLeft);
  await page.getByRole('dialog').getByRole('button',{name:'Next card',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => rail().evaluate(element => element.scrollLeft)).toBeGreaterThan(beforeScroll + 100);
  await rail().hover();
  await page.mouse.wheel(6000, 0);
  await expect(question(12)).toBeInViewport();
  assert.equal((await readExam(page)).activeSession.answers.length,0, 'Browsing must never submit answers');
  report.checks.push('keyboard arrows and trackpad browse the complete exam without submitting');

  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await expect(page.getByTestId('exam-question-list')).toBeVisible();
  for (let number=1;number<=12;number++) {
    for (const option of await options(number).all()) {
      await option.scrollIntoViewIfNeeded();
      await expect(option).toBeInViewport();
      await option.click({trial:true});
    }
  }
  await page.screenshot({path:path.join(output,'exam-zoomed.png')});
  await app.evaluate(({BrowserWindow}) => { const w=BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(1); w.setSize(900,600); });
  await expect(rail()).toBeVisible();
  for (const number of [1,6,12]) {
    for (const option of await options(number).all()) {
      await option.scrollIntoViewIfNeeded();
      await expect(option).toBeInViewport();
      await option.click({trial:true});
    }
  }
  report.checks.push('exam options remain reachable at 200% zoom and in a 900x600 window');
  await app.evaluate(({app:electron}) => electron.setAccessibilitySupportEnabled(true));
  await expect(page.getByTestId('exam-question-list')).toBeVisible();
  await expect(page.getByRole('button',{name:/^[1-3]\. /})).toHaveCount(36);
  await question(12).scrollIntoViewIfNeeded();
  await expect(question(12).getByRole('heading')).toBeInViewport();
  await app.evaluate(({app:electron,BrowserWindow}) => {electron.setAccessibilitySupportEnabled(false); BrowserWindow.getAllWindows()[0].setSize(1366,850);});
  await expect(rail()).toBeVisible();
  report.checks.push('screen-reader mode exposes every question in linear reading order');

  const order = [8,2,12,4,10,1,11,3,9,5,7,6];
  const choose = async (number, keyboard=false) => {
    const item = exam.activeSession.items[number-1];
    const option = number % 3 === 0 ? item.options.find(o=>o.id!==item.correctOptionId) : item.options.find(o=>o.id===item.correctOptionId);
    const index = item.options.findIndex(o=>o.id===option.id);
    const button = options(number).nth(index);
    await button.scrollIntoViewIfNeeded();
    if (keyboard) { await button.focus(); await page.keyboard.press('Enter'); }
    else await button.click();
    await expect.poll(async () => {
      const data = await readExam(page);
      const session = data.activeSession ?? data.history.at(-1)?.session;
      return session?.answers.some(answer => answer.itemId === item.id && answer.optionId === option.id);
    }, {message:`Question ${number} must save after one real click`}).toBe(true);
  };
  for (const number of order.slice(0,3)) {
    await choose(number,number===8);
    await expect(options(number).filter({hasText:'✓'})).toHaveCount(1);
  }
  assert.equal((await readExam(page)).activeSession.answers.length,3);
  await expect(page.getByText('Correct answer', {exact:true})).toHaveCount(0);
  const before = await readExam(page);
  assert.deepEqual(before.activeSession.answers.map(a=>a.itemId),order.slice(0,3).map(n=>exam.activeSession.items[n-1].id));
  await app.close();
  ({app,page} = await launch());
  await expect(page.getByTestId('exam-question-1')).toBeVisible({timeout:90000});
  const resumed = await readExam(page);
  assert.equal(resumed.activeSession.id,id);
  assert.deepEqual(resumed.activeSession.answers,before.activeSession.answers);
  assert.deepEqual(resumed.activeSession.items,before.activeSession.items);
  for (const number of order.slice(0,3)) {
    for (const option of await options(number).all()) await expect(option).toBeDisabled();
  }
  report.checks.push('out-of-order answers and frozen questions survive process restart');
  for (const number of order.slice(3)) await choose(number);
  await expect(page.getByText('Quiz complete!', {exact:true})).toBeVisible();
  const saved = await readExam(page);
  assert.equal(saved.activeSession,null);
  assert.equal(saved.history.length,1);
  const result = saved.history[0];
  assert.equal(result.session.id,id);
  assert.equal(result.session.answers.length,12);
  assert.equal(result.score.total,12);
  assert.equal(result.score.correct,8);
  await page.screenshot({path:path.join(output,'exam-results.png')});
  await page.getByRole('button',{name:'Back to my cards',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'View detailed activity →',exact:true}).click();
  await expect(page.getByText('Hiraia assessment history',{exact:true})).toBeVisible();
  await expect(page.getByText(`Total ${result.score.correct} / 12 · Benchmark`,{exact:false})).toBeVisible();
  assert.equal(await page.getByText('Saved assessments could not be read.',{exact:false}).count(),0);
  await page.screenshot({path:path.join(output,'exam-history.png')});
  report.checks.push('all twelve answers score once and appear in the saved profile history');
  report.exam = {questions:12,completed:true,resumed:true,history:true,keyboard:true,zoom:true,carousel:true,outOfOrder:true,screenReader:true,visibleCards:geometry.visibleCards};
  // A new process returns to the reader, independently of the activity navigation stack.
  await app.close();
  ({app,page} = await launch());
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible({timeout:90000});
  assert.equal((await readExam(page)).history.length,1);
  return {app,page};
}
module.exports = {verifyExam};
