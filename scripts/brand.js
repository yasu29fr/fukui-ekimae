// brand/ の下絵（HTML）から、ファビコン・アイコン・OG 画像を docs/ に書き出す。
//   node scripts/brand.js        （Playwright が必要。フォントはネットから読む）
const path = require('path');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  if (process.env.FONT_PROXY_HOOK) await require(process.env.FONT_PROXY_HOOK)(ctx);   // 手元でネットに出られないとき用
  const p = await ctx.newPage();
  const shot = async (file, sel, out, size, opts = {}) => {
    await p.goto('file://' + path.join(ROOT, 'brand', file), { waitUntil: 'domcontentloaded' });
    if (opts.square) await p.evaluate(() => document.body.classList.add('square'));
    await p.waitForFunction(() => document.documentElement.className.includes('wf-active') || document.documentElement.className.includes('wf-inactive'), null, { timeout: 30000 }).catch(() => {});
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
    const el = await p.$(sel);
    const buf = await el.screenshot({ omitBackground: true });
    if (size) {   // 縮小は canvas で（ImageMagick 不要）
      const data = await p.evaluate(async ({ b64, size }) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, size, size); return c.toDataURL('image/png').split(',')[1]; }, { b64: buf.toString('base64'), size });
      require('fs').writeFileSync(path.join(ROOT, 'docs', out), Buffer.from(data, 'base64'));
    } else require('fs').writeFileSync(path.join(ROOT, 'docs', out), buf);
    console.log('wrote', out);
  };
  await shot('icon.html', '.icon', 'icon-512.png', 512);
  await shot('icon.html', '.icon', 'icon-192.png', 192);
  await shot('icon.html', '.icon', 'favicon-32.png', 32);
  await shot('icon.html', '.icon', 'apple-touch-icon.png', 180, { square: true });
  await shot('og.html', '.og', 'og.png');
  await b.close();
})();
