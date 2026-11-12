'use strict';
// PayHero (M-Pesa STK push) and Ping Africa (SMS). Credentials come from environment variables only.
const phone254 = (p) => { p = String(p || '').replace(/[^\d]/g, ''); if (p.startsWith('0')) p = '254' + p.slice(1); else if (p.startsWith('7') || p.startsWith('1')) p = '254' + p; return /^254[17]\d{8}$/.test(p) ? p : null; };

async function payheroPush(env, { amount, phone, ref, name, callbackUrl }) {
  if (!env.PAYHERO_BASIC_AUTH) throw new Error('PayHero is not configured on the server');
  const r = await fetch((env.PAYHERO_BASE_URL || 'https://backend.payhero.co.ke') + '/api/v2/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: env.PAYHERO_BASIC_AUTH },
    body: JSON.stringify({ amount, phone_number: phone, channel_id: Number(env.PAYHERO_CHANNEL_ID), provider: 'm-pesa', external_reference: ref, customer_name: name || 'ISP', callback_url: callbackUrl }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(j.error_message || j.message || ('PayHero returned HTTP ' + r.status));
  return j;
}
async function payheroStatus(env, ref) {
  const r = await fetch((env.PAYHERO_BASE_URL || 'https://backend.payhero.co.ke') + '/api/v2/transaction-status?reference=' + encodeURIComponent(ref), { headers: { Authorization: env.PAYHERO_BASIC_AUTH }, signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  const s = String(j.status || j.Status || '').toUpperCase();
  return { state: s === 'SUCCESS' ? 'paid' : (s === 'FAILED' || s === 'CANCELLED') ? 'failed' : 'pending', receipt: j.provider_reference || j.mpesa_receipt_number || j.MpesaReceiptNumber || '', raw: j };
}
async function sendSms(env, to, message) {
  const p = phone254(to); if (!p || !env.PING_AFRICA_API_TOKEN) return { ok: false, error: 'SMS not configured or bad number' };
  const body = { recipient: '+' + p, message }; if (env.PING_AFRICA_SENDER_ID) body.sender_id = env.PING_AFRICA_SENDER_ID;
  try {
    const r = await fetch(env.PING_AFRICA_API_URL || 'https://bulk.ping.africa/api/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + env.PING_AFRICA_API_TOKEN }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, error: e.message }; }
}
module.exports = { phone254, payheroPush, payheroStatus, sendSms };
