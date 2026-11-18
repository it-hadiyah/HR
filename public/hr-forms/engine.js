// محرك قوالب نماذج الموارد البشرية (يعمل في المتصفح وفي الاختبارات).
// الصيغة: {{متغير}} · {{متغير|مرشّح}} · {{خيار.خاصية}} · {{#if متغير}}…{{else}}…{{/if}} · {{#each قائمة}}{{this|date}}{{/each}}
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const pad = n => String(n).padStart(2, '0');

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 ? d : null;
}
export const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };

const plural = n => (n === 1 ? 'يوم الغياب' : n === 2 ? 'يومي الغياب' : `أيام الغياب (${n} ${n <= 10 ? 'أيام' : 'يوماً'})`);

/** المرشّحات المتاحة داخل القوالب */
export const FILTERS = {
  date: v => { const d = parseISO(v); return d ? `${DAYS[d.getUTCDay()]}، ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}م` : String(v ?? ''); },
  date_num: v => { const d = parseISO(v); return d ? `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : String(v ?? ''); },
  weekday: v => { const d = parseISO(v); return d ? DAYS[d.getUTCDay()] : String(v ?? ''); },
  month_ar: v => { const m = /^(\d{4})-(\d{2})$/.exec(String(v ?? '')); return m && +m[2] >= 1 && +m[2] <= 12 ? `${MONTHS[+m[2] - 1]} ${m[1]}م` : String(v ?? ''); },
  days_construct: v => { const n = Array.isArray(v) ? v.length : Number(v); return Number.isFinite(n) && n > 0 ? plural(n) : 'أيام الغياب'; },
  count: v => String(Array.isArray(v) ? v.length : 0),
  list_ar: v => (Array.isArray(v) ? v.join('، ') : String(v ?? '')),
};

const TAG = /\{\{\s*([^{}]+?)\s*\}\}/g;

function parse(src) {
  // ينقل وسوم الكتل التي تشغل سطراً كاملاً بلا أسطر فارغة زائدة
  const text = src.replace(/\r\n/g, '\n').replace(/^[ \t]*(\{\{\s*(?:#if|#each|else|\/if|\/each)[^{}]*\}\})[ \t]*\n/gm, '$1');
  const root = { kind: 'root', children: [] };
  const stack = [{ node: root, branch: root.children }];
  let last = 0, m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(text))) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.branch.push({ kind: 'text', text: text.slice(last, m.index) });
    last = TAG.lastIndex;
    const tag = m[1];
    if (tag.startsWith('#if ') || tag.startsWith('#each ')) {
      const node = tag.startsWith('#if ') ? { kind: 'if', path: tag.slice(4).trim(), then: [], otherwise: [] } : { kind: 'each', path: tag.slice(6).trim(), body: [] };
      top.branch.push(node);
      stack.push({ node, branch: node.kind === 'if' ? node.then : node.body });
    } else if (tag === 'else') {
      if (top.node.kind !== 'if') throw new Error('else خارج if');
      top.branch = top.node.otherwise;
    } else if (tag === '/if' || tag === '/each') {
      if (stack.length < 2) throw new Error('وسم إغلاق زائد');
      stack.pop();
    } else {
      const [path, filter] = tag.split('|').map(s => s.trim());
      top.branch.push({ kind: 'var', path, filter });
    }
  }
  if (last < text.length) stack[stack.length - 1].branch.push({ kind: 'text', text: text.slice(last) });
  if (stack.length !== 1) throw new Error('وسم كتلة غير مغلق');
  return root.children;
}

const truthy = v => v !== undefined && v !== null && v !== '' && v !== false && v !== 0 && !(Array.isArray(v) && v.length === 0);

/**
 * يملأ القالب. ctx: { vars, fields, blank }
 *  - المتغير الفارغ يظهر نقاطاً (blank) ليُكمل يدوياً
 */
export function renderTemplate(body, ctx) {
  const { vars = {}, fields = [], blank = '..................' } = ctx;
  const resolve = (path, loop) => {
    if (path === 'this') return loop?.item;
    if (path === '@index1') return (loop?.index ?? 0) + 1;
    const dot = path.indexOf('.');
    if (dot > 0) {
      const base = path.slice(0, dot), prop = path.slice(dot + 1);
      const f = fields.find(x => x.key === base);
      const opt = f?.options?.find(o => o.value === vars[base]);
      return opt ? opt[prop] : undefined;
    }
    return vars[path];
  };
  const run = (nodes, loop) => nodes.map(n => {
    if (n.kind === 'text') return n.text;
    if (n.kind === 'var') {
      const v = resolve(n.path, loop);
      const out = n.filter && FILTERS[n.filter] ? FILTERS[n.filter](v) : (Array.isArray(v) ? v.join('، ') : v);
      return truthy(out) || out === 0 ? String(out) : blank;
    }
    if (n.kind === 'if') return run(truthy(resolve(n.path, loop)) ? n.then : n.otherwise, loop);
    if (n.kind === 'each') { const list = resolve(n.path, loop); return (Array.isArray(list) ? list : []).map((item, index) => run(n.body, { item, index })).join(''); }
    return '';
  }).join('');
  const out = run(parse(body), null);
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** متغيرات الموظف والتاريخ التي تُضاف تلقائياً لكل قالب */
export function buildVars({ employee = {}, values = {}, issueDate } = {}) {
  return {
    ...values,
    employee_name: employee.full_name || '', emp_no: employee.emp_no || '', job_title: employee.job_title || '',
    sector: employee.sector || '', section: employee.section || '',
    department: employee.department || employee.section || employee.sector || '',
    issue_date: issueDate || todayISO(),
  };
}

export function defaultValues(fields) {
  const v = {};
  for (const f of fields) v[f.key] = f.type === 'dates' ? [] : (f.default ?? '');
  return v;
}

/** اقتراح قيمة من حقل آخر (مثل: الشهر التالي لآخر يوم غياب) */
export function suggestValue(field, values) {
  const m = /^next_month_of:(.+)$/.exec(field.suggest || '');
  if (!m) return '';
  const src = values[m[1]];
  const dates = (Array.isArray(src) ? src : [src]).map(parseISO).filter(Boolean).sort((a, b) => a - b);
  if (!dates.length) return '';
  const d = dates[dates.length - 1];
  const y = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  return `${y}-${pad(((d.getUTCMonth() + 1) % 12) + 1)}`;
}

/** أسماء الحقول المطلوبة الفارغة */
export function missingRequired(fields, values) {
  return fields.filter(f => f.required && !truthy(Array.isArray(values[f.key]) ? values[f.key].filter(Boolean) : values[f.key])).map(f => f.label);
}

export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** يحوّل نص النموذج إلى HTML آمن: «# عنوان» عنوان، والباقي فقرات */
export function textToHtml(text) {
  return text.split('\n').map(line => {
    if (line.startsWith('# ')) return `<h2>${escapeHtml(line.slice(2))}</h2>`;
    if (!line.trim()) return '<div class="gap"></div>';
    return `<p>${escapeHtml(line)}</p>`;
  }).join('');
}

/** النص العادي للنسخ (بدون علامة العنوان #) */
export const plainText = text => text.split('\n').map(l => (l.startsWith('# ') ? l.slice(2) : l)).join('\n');
