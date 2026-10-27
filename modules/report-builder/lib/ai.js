'use strict';
// مساعد الكتابة: يستدعي واجهة Anthropic من الخادم فقط (المفتاح لا يصل المتصفح أبداً).
// القاعدة: لا اختلاق أرقام. تُمرَّر بيانات القسم الفعلية فقط، ويُفحص الناتج: أي رقم غير موجود في البيانات يُعاد كتحذير.
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const cfgm = require('./config');
const store = require('./store');

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const AR = '٠١٢٣٤٥٦٧٨٩';
const normNum = (s) => String(s).replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/[٬,\s]/g, '').replace(/٫/g, '.');

function apiKey() {
  const e = process.env.ANTHROPIC_API_KEY; if (e && e.trim()) return e.trim();
  try { return fs.readFileSync(path.join(store.DATA, 'ai-key.txt'), 'utf8').trim(); } catch (x) { return ''; }
}
const conf = () => Object.assign({ model: 'claude-sonnet-5-5', endpoint: DEFAULT_ENDPOINT }, cfgm.get().ai || {});
const configured = () => !!apiKey();

const ACTIONS = {
  summarize: 'اكتب ملخصاً تنفيذياً من فقرة واحدة إلى فقرتين قصيرتين لهذه البيانات.',
  analyze: 'اكتب تحليلاً موجزاً لما تُظهره البيانات: الاتجاهات، أعلى وأدنى قيمة، والفروق الظاهرة. لا تفسّر الأسباب إن لم تكن مذكورة.',
  recommend: 'اقترح 3 إلى 5 توصيات عملية مبنية على ما تُظهره البيانات فقط، في نقاط قصيرة.',
};
const SYSTEM = [
  'أنت مساعد كتابة تقارير لجمعية خيرية. اكتب بالعربية الفصحى المبسطة وبأسلوب رسمي موجز.',
  'قواعد صارمة: (1) لا تذكر أي رقم أو نسبة أو تاريخ أو اسم غير موجود حرفياً في البيانات المرفقة. (2) لا تحسب أرقاماً جديدة ولا تقرّب؛ انقل الأرقام كما هي. (3) إن كانت البيانات ناقصة أو غير كافية فقل ذلك صراحة ولا تخمّن. (4) لا تضف معلومات من خارج البيانات.',
  'الصيغة: فقرات قصيرة أو نقاط تبدأ بـ "- ". بدون عناوين وبدون Markdown آخر.',
].join('\n');

function post(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({ method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, headers), timeout: 45000 }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; if (d.length > 500000) req.destroy(); }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => req.destroy(new Error('انتهت مهلة الاتصال بخدمة الذكاء الاصطناعي')));
    req.on('error', reject); req.end(body);
  });
}

function numbersIn(text) { return (String(text).match(/[0-9٠-٩]+(?:[.,٬٫][0-9٠-٩]+)*/g) || []).map(normNum).filter(Boolean); }

async function assist({ action, title, section, computed }) {
  if (!ACTIONS[action]) throw new Error('إجراء غير معروف');
  const key = apiKey(); if (!key) throw new Error('لم يُضبط مفتاح الذكاء الاصطناعي على الخادم');
  const data = JSON.stringify({ نوع_القسم: section.type, عنوان_القسم: section.title || '', المحتوى: section.content, المصدر: section.source || '', آخر_تحديث: section.asOf || '', النتائج_المحسوبة: computed || undefined }).slice(0, 8000);
  const c = conf();
  const r = await post(c.endpoint, JSON.stringify({ model: c.model, max_tokens: 800, system: SYSTEM, messages: [{ role: 'user', content: `عنوان التقرير: ${title || ''}\nالمطلوب: ${ACTIONS[action]}\n\nالبيانات (JSON):\n${data}` }] }), { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
  let j; try { j = JSON.parse(r.body); } catch (e) { throw new Error('رد غير مفهوم من خدمة الذكاء الاصطناعي'); }
  if (r.status >= 300) throw new Error('تعذر الحصول على اقتراح: ' + ((j.error && j.error.message) || r.status));
  const text = ((j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n') || '').trim();
  if (!text) throw new Error('لم يُرجع المساعد نصاً');
  const allowed = new Set(numbersIn(data));
  const unverified = Array.from(new Set(numbersIn(text).filter((n) => !allowed.has(n) && !(/^\d{1,2}$/.test(n) && +n <= 10))));
  return { text, unverified, model: c.model };
}

module.exports = { assist, configured, ACTIONS, numbersIn };
