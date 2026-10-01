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
  await expect(page.getByText('Question 1 / 12', {exact:true})).toBeVisible();
  const exam = await readExam(page);
  assert.equal(exam.activeSession.items.length, 12);
  const id = exam.activeSession.id;
  const options = () => page.getByRole('button', {name:/^[1-3]\. /});
  await expect(options()).toHaveCount(3);
  await page.screenshot({path:path.join(output,'exam-question.png')});
  report.checks.push('12-question exam is available offline from Settings');

  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  for (const option of await options().all()) {
    await option.scrollIntoViewIfNeeded();
    await expect(option).toBeInViewport();
    await option.click({trial:true});
  }
  await page.screenshot({path:path.join(output,'exam-zoomed.png')});
  await app.evaluate(({BrowserWindow}) => { const w=BrowserWindow.getAllWindows()[0]; w.webContents.setZoomFactor(1); w.setSize(900,600); });
  for (const option of await options().all()) {
    await option.scrollIntoViewIfNeeded();
    await expect(option).toBeInViewport();
    await option.click({trial:true});
  }
  report.checks.push('all exam answers remain reachable at 200% zoom and 900x600');
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1366,850));
  await options().first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Question 2 / 12', {exact:true})).toBeVisible();
  for (let i=2;i<=3;i++) {
    await options().first().click();
    await expect(page.getByText(`Question ${i+1} / 12`, {exact:true})).toBeVisible();
  }
  assert.equal((await readExam(page)).activeSession.answers.length,3);
  const before = await readExam(page);
  await app.close();
  ({app,page} = await launch());
  await expect(page.getByText('Question 4 / 12', {exact:true})).toBeVisible({timeout:90000});
  const resumed = await readExam(page);
  assert.equal(resumed.activeSession.id,id);
  assert.deepEqual(resumed.activeSession.answers,before.activeSession.answers);
  assert.deepEqual(resumed.activeSession.items,before.activeSession.items);
  report.checks.push('exam answers, question text and option order survive process restart');
  for (let i=4;i<=12;i++) {
    await expect(page.getByText(`Question ${i} / 12`, {exact:true})).toBeVisible();
    // Select through the actual UI; every answer must persist before advancement.
    await options().first().click();
  }
  await expect(page.getByText('Quiz complete!', {exact:true})).toBeVisible();
  const saved = await readExam(page);
  assert.equal(saved.activeSession,null);
  assert.equal(saved.history.length,1);
  const result = saved.history[0];
  assert.equal(result.session.id,id);
  assert.equal(result.session.answers.length,12);
  assert.equal(result.score.total,12);
  assert.equal(result.score.correct,result.session.items.filter((q,i)=>q.correctOptionId===result.session.answers[i].optionId).length);
  await page.screenshot({path:path.join(output,'exam-results.png')});
  await page.getByRole('button',{name:'Back to my cards',exact:true}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'View detailed activity →',exact:true}).click();
  await expect(page.getByText('Hiraia assessment history',{exact:true})).toBeVisible();
  await expect(page.getByText(`Total ${result.score.correct} / 12 · Benchmark`,{exact:false})).toBeVisible();
  assert.equal(await page.getByText('Saved assessments could not be read.',{exact:false}).count(),0);
  await page.screenshot({path:path.join(output,'exam-history.png')});
  report.checks.push('all twelve answers score once and appear in the saved profile history');
  report.exam = {questions:12,completed:true,resumed:true,history:true,keyboard:true,zoom:true};
  // A new process returns to the reader, independently of the activity navigation stack.
  await app.close();
  ({app,page} = await launch());
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible({timeout:90000});
  assert.equal((await readExam(page)).history.length,1);
  return {app,page};
}
module.exports = {verifyExam};
