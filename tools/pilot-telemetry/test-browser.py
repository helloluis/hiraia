#!/usr/bin/env python3
"""Run against preview-dashboard.py. Requires playwright and an installed Chrome."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).parent/'build';root.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROME_PATH','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),headless=True)
    page=browser.new_page(viewport={'width':1360,'height':1120},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(os.environ.get('PREVIEW_URL','http://127.0.0.1:8138/admin'));page.wait_for_selector('#session-body tr')
    assert page.get_by_text('Every session tells a story.',exact=True).count()==0
    assert page.locator('#refresh').is_visible()
    assert 'Unique App Sessions' in page.locator('[data-metric=sessions]').inner_text()
    for metric in ['cards','apk','models','sessions','profiles','quizzes','correct','persona','website']:
        page.locator('[data-metric='+metric+']').click();page.wait_for_selector('.chart-area svg')
        assert page.locator('[data-metric='+metric+']').get_attribute('aria-expanded')=='true'
        assert page.locator('.metric[aria-expanded=true]').count()==1
        for period in ['1M','3M','1Y','2W']:
            page.locator('.ranges button',has_text=period).click();page.wait_for_selector('.chart-area svg')
            assert page.locator('.ranges button[aria-pressed=true]').inner_text()==period
        if metric in ('cards','quizzes','correct','sessions','profiles'):
            assert 'Grade ' in page.locator('.legend').inner_text()
            assert page.locator('.chart-area svg rect[aria-label*="Grade"]').count()>0
        print('PASS chart',metric,flush=True)
    page.locator('.session-open').first.click();page.wait_for_selector('.event-table tbody tr')
    assert page.locator('.event-table tbody tr').count()>0
    assert page.locator('#session-body').inner_text().count(' · ')>0
    page.locator('.session-open').first.click()
    page.locator('[data-metric=cards]').click();page.wait_for_selector('.chart-area svg');page.wait_for_timeout(300)
    assert page.evaluate("Math.abs(document.getElementById('metric-chart').previousElementSibling.getBoundingClientRect().bottom-document.querySelector('[data-metric=cards]').getBoundingClientRect().bottom)<2")
    page.screenshot(path=str(root/'pilot-dashboard-desktop.png'))
    page.locator('[data-metric=cards]').click();assert page.locator('#metric-chart').is_hidden()
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(150)
    page.locator('[data-metric=persona]').click();page.wait_for_selector('.chart-area svg');page.wait_for_timeout(300)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    assert page.evaluate("document.getElementById('metric-chart').previousElementSibling.dataset.metric")=='persona'
    page.locator('[data-metric=persona]').scroll_into_view_if_needed()
    page.screenshot(path=str(root/'pilot-dashboard-mobile.png'))
    assert not errors,errors
    print('PASS session details, chart collapse/placement, mobile layout, no JS errors')
    browser.close()
