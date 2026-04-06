/**
 * QQ Bot API client — manages access tokens and provides HTTP wrappers
 * for the QQ Bot v2 API.
 */

let accessToken = null;
let tokenExpiresAt = 0;

const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const API_BASE = 'https://api.sgroup.qq.com';

let _appId = null;
let _appSecret = null;

export function initQQApi(appId, appSecret) {
  _appId = appId;
  _appSecret = appSecret;
}

async function refreshToken() {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: _appId, clientSecret: _appSecret }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Token 获取失败: ${JSON.stringify(data)}`);
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + (parseInt(data.expires_in, 10) - 60) * 1000;
  console.log(`✓ Token 已获取 (expires_in=${data.expires_in}s)`);
}

export async function getToken() {
  if (!accessToken || Date.now() >= tokenExpiresAt) await refreshToken();
  return accessToken;
}

export function authHeaders() {
  return { Authorization: `QQBot ${accessToken}`, 'Content-Type': 'application/json' };
}

export async function apiCall(method, path, body = null) {
  await getToken();
  const opts = { method, headers: authHeaders() };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${API_BASE}${path}`, opts);
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: resp.status }; }
}

export async function replyToGroupMessage(groupOpenId, msgId, content, msgSeq = 1) {
  return apiCall('POST', `/v2/groups/${groupOpenId}/messages`, {
    msg_type: 2, markdown: { content }, msg_id: msgId, msg_seq: msgSeq,
  });
}

export async function replyToC2CMessage(userOpenId, msgId, content, msgSeq = 1) {
  return apiCall('POST', `/v2/users/${userOpenId}/messages`, {
    msg_type: 2, markdown: { content }, msg_id: msgId, msg_seq: msgSeq,
  });
}

export async function sendActiveC2CMessage(userOpenId, content, keyboard = null) {
  const body = { msg_type: 2, markdown: { content } };
  if (keyboard) body.keyboard = keyboard;
  return apiCall('POST', `/v2/users/${userOpenId}/messages`, body);
}

export async function sendWakeupC2CMessage(userOpenId, content, keyboard = null) {
  const body = { msg_type: 2, markdown: { content }, is_wakeup: true };
  if (keyboard) body.keyboard = keyboard;
  return apiCall('POST', `/v2/users/${userOpenId}/messages`, body);
}

export async function sendActiveGroupMessage(groupOpenId, content, keyboard = null) {
  const body = { msg_type: 2, markdown: { content } };
  if (keyboard) body.keyboard = keyboard;
  return apiCall('POST', `/v2/groups/${groupOpenId}/messages`, body);
}

export async function sendArkC2CMessage(userOpenId, ark, msgId, msgSeq) {
  const body = { msg_type: 3, ark };
  if (msgId) { body.msg_id = msgId; body.msg_seq = msgSeq; }
  return apiCall('POST', `/v2/users/${userOpenId}/messages`, body);
}

export async function sendArkGroupMessage(groupOpenId, ark, msgId, msgSeq) {
  const body = { msg_type: 3, ark };
  if (msgId) { body.msg_id = msgId; body.msg_seq = msgSeq; }
  return apiCall('POST', `/v2/groups/${groupOpenId}/messages`, body);
}

export async function uploadMedia(targetId, buffer, isGroup = false) {
  await getToken();
  const base64Data = buffer.toString('base64');
  const endpoint = isGroup
    ? `/v2/groups/${targetId}/files`
    : `/v2/users/${targetId}/files`;
  return apiCall('POST', endpoint, {
    file_type: 1,
    file_data: base64Data,
    srv_send_msg: false,
  });
}

export async function uploadMediaByUrl(targetId, imageUrl, isGroup = false) {
  const endpoint = isGroup
    ? `/v2/groups/${targetId}/files`
    : `/v2/users/${targetId}/files`;
  return apiCall('POST', endpoint, {
    file_type: 1,
    url: imageUrl,
    srv_send_msg: false,
  });
}

export async function sendMediaReply(targetId, fileInfo, msgId, msgSeq, isGroup = false) {
  const path = isGroup
    ? `/v2/groups/${targetId}/messages`
    : `/v2/users/${targetId}/messages`;
  const body = { msg_type: 7, media: { file_info: fileInfo } };
  if (msgId) { body.msg_id = msgId; body.msg_seq = msgSeq; }
  return apiCall('POST', path, body);
}

export async function sendActiveMediaC2C(userOpenId, fileInfo) {
  return apiCall('POST', `/v2/users/${userOpenId}/messages`, {
    msg_type: 7, media: { file_info: fileInfo },
  });
}

export async function getGatewayUrl() {
  await getToken();
  const resp = await fetch(`${API_BASE}/gateway`, { headers: authHeaders() });
  const data = await resp.json();
  return data.url;
}

export { API_BASE };
