/**
 * HTML rendering utilities — markdownToStyledHtml is pure,
 * detectChromePath reads the filesystem but has no side effects on server state.
 */

import { existsSync } from 'fs';
import { marked } from 'marked';

export function markdownToStyledHtml(md) {
  const htmlContent = marked.parse(md);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif;
    padding: 20px; background: linear-gradient(160deg, #e8ecf1, #d5dce6);
    color: #1a1a2e; line-height: 1.75; font-size: 15px;
    min-height: 100vh;
  }
  .card {
    background: #fff; border-radius: 20px; padding: 24px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.05);
  }
  h1 { font-size: 20px; font-weight: 700; color: #1a1a2e; margin-bottom: 14px;
    padding-bottom: 10px; border-bottom: 2px solid #e8ecf1; }
  h2 { font-size: 17px; font-weight: 600; color: #495057; margin: 18px 0 8px; }
  h3 { font-size: 15px; font-weight: 600; color: #495057; margin: 14px 0 6px; }
  p { margin: 8px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; word-break: break-word; }
  th { background: #f1f3f5; font-weight: 600; color: #495057; }
  tr:nth-child(even) { background: #f8f9fa; }
  code { background: #f1f3f5; padding: 2px 5px; border-radius: 4px; font-size: 12px;
    font-family: "SF Mono", Menlo, monospace; word-break: break-all; }
  pre { background: #1e272e; color: #d2dae2; padding: 14px 16px; border-radius: 12px;
    overflow-x: auto; margin: 10px 0; font-size: 12px; line-height: 1.6; }
  pre code { background: none; color: inherit; padding: 0; word-break: normal; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
  ul, ol { padding-left: 20px; margin: 8px 0; }
  li { margin: 3px 0; }
  em { color: #636e72; }
  strong { color: #1a1a2e; }
  blockquote { border-left: 3px solid #667eea; padding: 8px 14px; margin: 10px 0;
    background: #f8f9fa; border-radius: 0 10px 10px 0; color: #636e72; font-size: 14px; }
  a { color: #667eea; text-decoration: none; }
  .footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid #e8ecf1;
    font-size: 11px; color: #b2bec3; text-align: right; }
</style>
</head>
<body>
  <div class="card">
    ${htmlContent}
    <div class="footer">CurBot &middot; ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</div>
  </div>
</body>
</html>`;
}

export function detectChromePath(configPath) {
  if (configPath) return configPath;
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
       '/usr/bin/chromium-browser', '/usr/bin/chromium',
       '/snap/bin/chromium'];
  for (const p of candidates) { if (existsSync(p)) return p; }
  return candidates[0];
}
