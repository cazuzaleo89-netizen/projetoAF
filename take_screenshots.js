const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const mockups = [
    { file: 'mockup_aurora.html', out: 'screenshot_aurora.png', label: 'Aurora' },
    { file: 'mockup_obsidian.html', out: 'screenshot_obsidian.png', label: 'Obsidian' },
    { file: 'mockup_arctic.html', out: 'screenshot_arctic.png', label: 'Arctic' },
  ];

  for (const m of mockups) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 340, height: 600 });
    await page.goto('file://' + path.join(__dirname, m.file));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(__dirname, m.out), clip: { x: 0, y: 0, width: 340, height: 600 } });
    console.log(`Screenshot saved: ${m.out}`);
    await page.close();
  }

  await browser.close();
})();
