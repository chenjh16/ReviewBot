/**
 * Media rendering pipeline — HTML-to-image conversion via Puppeteer,
 * then upload/send through QQ Bot API.
 */

import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { markdownToStyledHtml, detectChromePath } from './render.mjs';
import { uploadMedia, sendMediaReply } from '../qq/api.mjs';

let browserInstance = null;
let chromePath = null;

export function initMedia(configChromePath) {
  chromePath = detectChromePath(configChromePath);
}

export async function getBrowser() {
  if (browserInstance?.isConnected()) return browserInstance;
  browserInstance = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

export async function htmlToImage(html, sessionsDir, width = 390) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width, height: 100, deviceScaleFactor: 3 });
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
  const body = await page.$('.card') || await page.$('body');
  const tmpPath = join(sessionsDir, `_render_${Date.now()}.png`);
  await body.screenshot({ type: 'png', path: tmpPath });
  const screenshot = readFileSync(tmpPath);
  try { unlinkSync(tmpPath); } catch {}
  await page.close();
  return screenshot;
}

export async function renderAndSendImage(targetId, content, msgId, msgSeq, isGroup, sessionsDir, rawHtml = false) {
  const html = rawHtml ? content : markdownToStyledHtml(content);
  console.log('   🎨 渲染 HTML → 图片...');
  const imageBuffer = await htmlToImage(html, sessionsDir);
  console.log(`   📐 图片大小: ${imageBuffer.length} bytes`);

  console.log('   📤 上传图片到 QQ Bot...');
  const uploadResult = await uploadMedia(targetId, imageBuffer, isGroup);
  if (!uploadResult.file_info) {
    console.log(`   ⚠ 上传失败:`, JSON.stringify(uploadResult));
    return { ok: false, error: uploadResult };
  }
  console.log(`   ✓ 上传成功: file_uuid=${uploadResult.file_uuid}`);

  const sendResult = await sendMediaReply(targetId, uploadResult.file_info, msgId, msgSeq, isGroup);
  console.log(`   ✓ 图片消息已发送`);
  return { ok: true, result: sendResult, imageSize: imageBuffer.length };
}
