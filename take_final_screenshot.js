const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 340, height: 600 });
  await page.goto('file://' + path.join('/home/user/projetofiscal/chrome-extension', 'popup.html'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/home/user/projetofiscal/screenshot_final_arctic.png', clip: { x: 0, y: 0, width: 340, height: 600 } });
  console.log('Done');
  await browser.close();
})();
