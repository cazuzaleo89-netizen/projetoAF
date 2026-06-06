const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 420, height: 900 });

  await page.addInitScript(() => {
    const noop = () => {};
    const mockData = {
      todayStats: { resolved: 19, acertos: 14, erros: 5 },
      globalStats: { streak: 6 },
      settings: { dailyGoal: 30, notifications: true, autoReveal: true, targetRate: 70 },
      subjectStats: [
        { materia: 'Direito Tributário', acertos: 22, erros: 8, total: 30 },
        { materia: 'Direito Constitucional', acertos: 18, erros: 4, total: 22 },
        { materia: 'Contabilidade Geral', acertos: 9, erros: 11, total: 20 },
        { materia: 'AFO', acertos: 14, erros: 6, total: 20 },
      ],
      weekStats: [
        { date:'2026-05-31', label:'Dom', resolved: 12, acertos: 7, erros: 5, taxa: 58 },
        { date:'2026-06-01', label:'Seg', resolved: 18, acertos: 11, erros: 7, taxa: 61 },
        { date:'2026-06-02', label:'Ter', resolved: 9,  acertos: 6, erros: 3, taxa: 67 },
        { date:'2026-06-03', label:'Qua', resolved: 21, acertos: 15,erros: 6, taxa: 71 },
        { date:'2026-06-04', label:'Qui', resolved: 15, acertos: 11,erros: 4, taxa: 73 },
        { date:'2026-06-05', label:'Sex', resolved: 17, acertos: 13,erros: 4, taxa: 76 },
        { date:'2026-06-06', label:'Sáb', resolved: 19, acertos: 14,erros: 5, taxa: 74 },
      ],
      sessions: [],
      dueReviews: [
        { qid: 'q1', materia: 'Direito Constitucional', desc: 'Controle de constitucionalidade difuso e concentrado', errorCount: 2, nextReview: '2026-06-05', dificuldade: 'Difícil' },
        { qid: 'q2', materia: 'Direito Tributário', desc: 'Imunidade tributária recíproca dos entes federativos', errorCount: 1, nextReview: '2026-06-06' },
      ],
      hubQueue: [
        { qid: 'h1', materia: 'Contabilidade Geral', desc: 'Variações patrimoniais ativas e passivas', phase: 2, isDue: true, remaining: 0, url:'#' },
        { qid: 'h2', materia: 'AFO', desc: 'Créditos adicionais suplementares e especiais', phase: 1, isDue: false, remaining: 184, url:'#' },
      ],
      activeSession: null,
      timer: { elapsed: 4127, running: true },
      pomodoro: { active: false, state: 'work', count: 1, remaining: 0, workMins: 25, breakMins: 5, longBreakMins: 15 },
      questionBankStats: { total: 142, dominadas: 58, atencao: 47, criticas: 37 },
      hourlyStats: {},
      recentResults: [],
      confusionPatterns: [],
      articleCoverage: {},
    };

    window.chrome = {
      runtime: {
        sendMessage: (msg, cb) => {
          if (msg && msg.type === 'GET_POPUP_DATA') { cb && cb(mockData); return; }
          cb && cb({ ok: true });
        },
        lastError: null,
        onMessage: { addListener: noop },
      },
      tabs: { query: () => Promise.resolve([]), sendMessage: noop, create: noop, update: noop },
      storage: { local: { get: (d, cb) => cb && cb({}), set: (d, cb) => cb && cb(), clear: (cb) => cb && cb() } },
      notifications: { create: noop },
      sidePanel: { setPanelBehavior: () => Promise.resolve() },
      alarms: { create: noop, onAlarm: { addListener: noop } },
    };
  });

  await page.goto('file://' + path.join('/home/user/projetofiscal/chrome-extension', 'sidepanel.html'));
  await page.waitForTimeout(900);
  await page.screenshot({ path: '/home/user/projetofiscal/screenshot_sidepanel.png', clip: { x: 0, y: 0, width: 420, height: 900 } });

  await page.evaluate(() => { document.querySelector('.content').scrollTop = 720; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/home/user/projetofiscal/screenshot_sidepanel_scroll.png', clip: { x: 0, y: 0, width: 420, height: 900 } });

  await page.evaluate(() => { document.querySelector('[data-tab="revisao"]').click(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/home/user/projetofiscal/screenshot_sidepanel_revisao.png', clip: { x: 0, y: 0, width: 420, height: 900 } });

  console.log('Done');
  await browser.close();
})();
