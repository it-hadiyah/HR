/* مكتبة القوالب ونموذج البيانات الموحّد (تعمل في المتصفح وعلى الخادم).
   القالب يحدد الشكل (الغلاف، الألوان، العناوين) والأقسام الافتراضية، أما محتوى التقرير فيُحفظ منفصلاً عنه،
   لذلك يمكن تغيير القالب في أي وقت دون فقدان المحتوى. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RBT = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PALETTES = {
    hadiyah: { a: '#007f73', d: '#005a52', s: '#e0f4f1', x: '#02a999', name: 'هدية' },
    green: { a: '#1f7a5c', d: '#145a43', s: '#e6f4ee', x: '#3cc79a', name: 'أخضر الجمعية' },
    navy: { a: '#23406e', d: '#16294a', s: '#e8eef8', x: '#5b8fd9', name: 'كحلي' },
    teal: { a: '#0f766e', d: '#0b524d', s: '#e0f2f1', x: '#2dd4bf', name: 'تركوازي' },
    sand: { a: '#9a6b12', d: '#6b4a0c', s: '#fbf3e1', x: '#e0b04a', name: 'رملي' },
    plum: { a: '#7a3b6e', d: '#55284c', s: '#f6eaf3', x: '#c77bb8', name: 'برقوقي' },
    slate: { a: '#1e293b', d: '#0f172a', s: '#e9edf3', x: '#38bdf8', name: 'رمادي داكن' },
  };

  const BLOCKS = {
    text: { name: 'نص وعناوين', icon: 'type', desc: 'فقرات، عناوين، قوائم وتنسيق غني' },
    list: { name: 'قائمة نقاط', icon: 'list', desc: 'نقاط مرتبة أو غير مرتبة' },
    table: { name: 'جدول', icon: 'table', desc: 'جدول قابل للتحرير' },
    kpi: { name: 'مؤشرات وبطاقات', icon: 'gauge', desc: 'بطاقات KPI وإحصاءات بارزة' },
    chart: { name: 'رسم بياني', icon: 'chart', desc: 'أعمدة، خط، مساحة، دائري' },
    progress: { name: 'مؤشرات تقدم', icon: 'progress', desc: 'أشرطة نسب الإنجاز' },
    gantt: { name: 'مخطط جانت (جدول المشروع)', icon: 'gantt', desc: 'مهام بتواريخ بداية ونهاية ونسب إنجاز' },
    timeline: { name: 'خط زمني', icon: 'timeline', desc: 'مراحل ومعالم زمنية' },
    image: { name: 'صورة / شعار', icon: 'image', desc: 'رفع صورة مع تعليق' },
    calc: { name: 'حسابات تلقائية', icon: 'calculator', desc: 'أدخل أرقاماً ويُحسب المتبقي والنسب' },
    compare: { name: 'مقارنة بين فترتين', icon: 'compare', desc: 'السنة الماضية مقابل الحالية بنسبة التغيّر' },
    callout: { name: 'ملاحظة بارزة', icon: 'callout', desc: 'تنبيه أو خلاصة مميزة' },
    pagebreak: { name: 'فاصل صفحة', icon: 'pagebreak', desc: 'بدء صفحة جديدة' },
  };

  const TYPES = Object.keys(BLOCKS);

  // وصفات جاهزة لقسم الحسابات (الحروف A, B, C... ثابتة لكل بند وتُستخدم في العمليات)
  const inp = (key, label, extra) => Object.assign({ key, label, kind: 'input', value: '', unit: '', fmt: 'number' }, extra || {});
  const res = (key, label, op, args, extra) => Object.assign({ key, label, kind: 'calc', op, args, formula: '', unit: '', fmt: 'number' }, extra || {});
  const CALC_RECIPES = {
    budget: { name: 'ميزانية مشروع: المتبقي ونسبة الصرف', rows: () => [inp('A', 'التبرعات', { unit: 'ريال' }), inp('B', 'المنفّذ', { unit: 'ريال' }), res('C', 'المتبقي', 'sub', ['A', 'B'], { unit: 'ريال' }), res('D', 'نسبة التنفيذ', 'pct', ['B', 'A'], { fmt: 'percent' })] },
    surplus: { name: 'الإيرادات − المصروفات = الفائض', rows: () => [inp('A', 'الإيرادات', { unit: 'ريال' }), inp('B', 'المصروفات', { unit: 'ريال' }), res('C', 'الفائض / العجز', 'sub', ['A', 'B'], { unit: 'ريال' }), res('D', 'نسبة المصروفات من الإيرادات', 'pct', ['B', 'A'], { fmt: 'percent' })] },
    target: { name: 'المنجز من المستهدف', rows: () => [inp('A', 'المستهدف'), inp('B', 'المنجز'), res('C', 'المتبقي لبلوغ المستهدف', 'sub', ['A', 'B']), res('D', 'نسبة الإنجاز', 'pct', ['B', 'A'], { fmt: 'percent' })] },
    growth: { name: 'نسبة النمو بين فترتين', rows: () => [inp('A', 'الفترة السابقة'), inp('B', 'الفترة الحالية'), res('C', 'الفرق', 'sub', ['B', 'A']), res('D', 'نسبة النمو', 'formula', [], { formula: '(B-A)/A*100', fmt: 'percent' })] },
    yoy: { name: 'مقارنة 3 سنوات ونمو تراكمي', rows: () => [inp('A', 'السنة الأولى'), inp('B', 'السنة الثانية'), inp('C', 'السنة الثالثة'), res('D', 'النمو في السنة الثانية', 'formula', [], { formula: '(B-A)/A*100', fmt: 'percent' }), res('E', 'النمو في السنة الثالثة', 'formula', [], { formula: '(C-B)/B*100', fmt: 'percent' }), res('F', 'النمو التراكمي', 'formula', [], { formula: '(C-A)/A*100', fmt: 'percent' })] },
    forecast: { name: 'توقع الفترة القادمة بنفس معدل النمو', rows: () => [inp('A', 'الفترة السابقة'), inp('B', 'الفترة الحالية'), res('C', 'معدل النمو', 'formula', [], { formula: '(B-A)/A*100', fmt: 'percent' }), res('D', 'التوقع للفترة القادمة', 'formula', [], { formula: 'B*(1+C/100)' })] },
    variance: { name: 'انحراف الميزانية (الفعلي مقابل المخطط)', rows: () => [inp('A', 'المخطط', { unit: 'ريال' }), inp('B', 'الفعلي', { unit: 'ريال' }), res('C', 'الانحراف', 'sub', ['B', 'A'], { unit: 'ريال' }), res('D', 'نسبة الانحراف', 'formula', [], { formula: '(B-A)/A*100', fmt: 'percent' })] },
    avg: { name: 'المتوسط', rows: () => [inp('A', 'القيمة الأولى'), inp('B', 'القيمة الثانية'), inp('C', 'القيمة الثالثة'), res('D', 'المتوسط', 'avg', ['A', 'B', 'C'])] },
    sum: { name: 'مجموع بنود', rows: () => [inp('A', 'البند الأول'), inp('B', 'البند الثاني'), inp('C', 'البند الثالث'), res('D', 'المجموع', 'add', ['A', 'B', 'C'])] },
  };
  const defaultCompare = () => ({ labels: { prev: 'السنة الماضية', curr: 'السنة الحالية' }, rows: [{ label: '', prev: '', curr: '', unit: '', better: 'up' }], chart: true, summary: true, decimals: 1 });
  let seq = 0;
  const uid = () => 's' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

  function emptyContent(type, preset) {
    switch (type) {
      case 'text': return '';
      case 'list': return { ordered: false, items: [''] };
      case 'table': {
        const h = preset && preset.headers ? preset.headers.slice() : ['', '', ''];
        return { headers: h, rows: [Array(h.length).fill(''), Array(h.length).fill('')], zebra: true };
      }
      case 'kpi': return { style: 'cards', items: (preset && preset.labels ? preset.labels : ['', '', '']).map((label) => ({ label, value: '', trend: '', icon: '' })) };
      case 'chart': return { kind: (preset && preset.kind) || 'bar', unit: '', data: [{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }] };
      case 'progress': return { items: (preset && preset.labels ? preset.labels : ['', '']).map((label) => ({ label, value: '' })) };
      case 'timeline': return { items: [{ date: '', title: '', desc: '', status: 'todo' }, { date: '', title: '', desc: '', status: 'todo' }] };
      case 'image': return { src: '', caption: '', fit: 'contain', height: 220 };
      case 'gantt': return { items: [{ name: '', start: '', end: '', progress: '', owner: '' }, { name: '', start: '', end: '', progress: '', owner: '' }, { name: '', start: '', end: '', progress: '', owner: '' }] };
      case 'calc': return { style: 'table', rows: CALC_RECIPES[(preset && preset.recipe) || 'budget'].rows() };
      case 'compare': return defaultCompare();
      case 'callout': return { tone: 'info', text: '' };
      default: return {};
    }
  }

  function makeSection(type, title, o) {
    o = o || {};
    return {
      id: uid(), type, title: title || '', icon: '', visible: true, width: o.width || 'full',
      hint: o.hint || '',
      content: o.sample && o.useSample ? JSON.parse(JSON.stringify(o.sample)) : emptyContent(type, o),
    };
  }

  // اختصار لتعريف قسم داخل قالب
  const sec = (type, title, hint, extra) => Object.assign({ type, title, hint }, extra || {});
  const K = (label, value, trend, icon) => ({ label, value, trend: trend || '', icon: icon || '' });


  // مساعدات لقوالب الحزمة المالية والإدارية والمشاريع (بيانات العينة توضيحية فقط)
  const CI = (key, label, value, unit) => ({ key, label, kind: 'input', value: String(value), unit: unit || 'ريال', fmt: 'number' });
  const CC = (key, label, op, args, extra) => Object.assign({ key, label, kind: 'calc', op, args, formula: '', unit: 'ريال', fmt: 'number' }, extra || {});
  const CP = (key, label, args) => CC(key, label, 'pct', args, { unit: '', fmt: 'percent' });
  const CF = (key, label, formula) => CC(key, label, 'formula', [], { formula, unit: '', fmt: 'percent' });
  const calcS = (rows) => ({ style: 'table', rows });
  const cmpS = (prev, curr, rows, better) => ({ labels: { prev, curr }, rows: rows.map((r) => ({ label: r[0], prev: String(r[1]), curr: String(r[2]), unit: r[3] || '', better: r[4] || better || 'up' })), chart: true, summary: true, decimals: 1 });
  const chS = (kind, data, unit) => ({ kind, unit: unit || '', data: data.map((d) => ({ label: d[0], value: String(d[1]) })) });
  const tbS = (headers, rows) => ({ headers, zebra: true, rows });
  const prS = (items) => ({ items: items.map((i) => ({ label: i[0], value: String(i[1]) })) });
  const kS = (items, style) => ({ style: style || 'cards', items: items.map((i) => K(i[0], i[1], i[2])) });
  const NOTE = 'المصدر وتاريخ آخر تحديث: ';

  const TEMPLATES = [
    {
      coverIcon: 'ornament', id: 'annual', name: 'التقرير السنوي المؤسسي', category: 'إدارية', cover: 'hero', palette: 'hadiyah', head: 'bar',
      desc: 'غلاف راقٍ وإنجازات ومؤشرات ورسوم بيانية لعام كامل.', toc: true, closing: true,
      sampleTitle: 'التقرير السنوي', sampleSub: 'حصاد عام من العطاء',
      sections: [
        sec('text', 'كلمة رئيس مجلس الإدارة', 'اكتب كلمة قصيرة تلخص مسيرة العام ورؤية المرحلة القادمة.', { sample: '<p>شهد هذا العام نمواً ملحوظاً في برامج الجمعية ومستفيديها، ونتطلع لمزيد من العطاء في العام القادم.</p>' }),
        sec('kpi', 'أبرز الأرقام', 'أدخل أهم الأرقام الرئيسية للعام مع نسبة تغيّرها عن العام السابق.', { labels: ['المستفيدون', 'البرامج', 'المتطوعون', 'الشراكات'], sample: { style: 'cards', items: [K('المستفيدون', '12,450', '+18%', 'pilgrims'), K('البرامج', '34', '+6%', 'mushaf'), K('المتطوعون', '860', '+12%', 'hospitality'), K('الشراكات', '27', '+4%', 'madinah')] } }),
        sec('compare', 'مقارنة بالعام الماضي', 'أدخل قيمة كل بند في العام الماضي والحالي وستظهر نسبة الارتفاع أو الانخفاض تلقائياً.', { sample: { labels: { prev: 'العام الماضي', curr: 'العام الحالي' }, rows: [{ label: 'المستفيدون', prev: '10500', curr: '12450', unit: '', better: 'up' }, { label: 'المتطوعون', prev: '760', curr: '860', unit: '', better: 'up' }, { label: 'تكلفة التشغيل', prev: '1250000', curr: '1180000', unit: 'ريال', better: 'down' }], chart: true, summary: true, decimals: 1 } }),
        sec('chart', 'نمو المستفيدين الشهري', 'أدخل عدد المستفيدين لكل شهر أو ربع.', { kind: 'area', width: 'half', sample: { kind: 'area', unit: '', data: [{ label: 'الربع 1', value: '2400' }, { label: 'الربع 2', value: '3100' }, { label: 'الربع 3', value: '3300' }, { label: 'الربع 4', value: '3650' }] } }),
        sec('chart', 'توزيع الإنفاق على البرامج', 'أدخل نسبة أو مبلغ كل برنامج.', { kind: 'donut', width: 'half', sample: { kind: 'donut', unit: '', data: [{ label: 'الرعاية', value: '45' }, { label: 'التعليم', value: '25' }, { label: 'الصحة', value: '20' }, { label: 'أخرى', value: '10' }] } }),
        sec('timeline', 'محطات العام', 'اذكر أهم المحطات والإنجازات مرتبة زمنياً.', { sample: { items: [{ date: 'يناير', title: 'إطلاق الخطة السنوية', desc: '', status: 'done' }, { date: 'يونيو', title: 'اعتماد الشراكة الاستراتيجية', desc: '', status: 'done' }, { date: 'ديسمبر', title: 'ختام العام وتقييم الأثر', desc: '', status: 'active' }] } }),
        sec('text', 'الخطة المستقبلية', 'ما أهم أهداف العام القادم؟', { sample: '<p>توسيع نطاق الخدمات، وتعزيز الشراكات، ورفع كفاءة التشغيل.</p>' }),
      ],
    },
    {
      id: 'executive', name: 'التقرير التنفيذي للإدارة العليا', category: 'إدارية', cover: 'minimal', palette: 'navy', head: 'underline',
      desc: 'ملخص تنفيذي وقرارات وتوصيات مختصرة لاتخاذ القرار.', toc: false, closing: false,
      sampleTitle: 'التقرير التنفيذي', sampleSub: 'ملخص للإدارة العليا',
      sections: [
        sec('callout', 'الخلاصة', 'اكتب الخلاصة في جملتين: أهم ما يجب أن تعرفه الإدارة.', { sample: { tone: 'info', text: 'سارت المشاريع الرئيسية وفق الخطة، مع حاجة لقرار بشأن زيادة الميزانية.' } }),
        sec('kpi', 'مؤشرات رئيسية', 'أدخل أهم 3 إلى 4 مؤشرات.', { labels: ['الإنجاز العام', 'الميزانية المصروفة', 'المخاطر العالية'], sample: { style: 'cards', items: [K('الإنجاز العام', '82%', '+5%'), K('الميزانية المصروفة', '64%', ''), K('المخاطر العالية', '2', '-1')] } }),
        sec('text', 'أبرز الإنجازات', 'لخّص أبرز ما تحقق في الفترة.', { sample: '<ul><li>اكتمال المرحلة الأولى قبل الموعد.</li><li>توقيع اتفاقية جديدة.</li></ul>' }),
        sec('table', 'القرارات المطلوبة', 'اذكر كل قرار مطلوب ومن المسؤول والموعد.', { headers: ['القرار', 'المسؤول', 'الموعد'], sample: { headers: ['القرار', 'المسؤول', 'الموعد'], zebra: true, rows: [['اعتماد زيادة الميزانية', 'الإدارة المالية', 'نهاية الشهر'], ['الموافقة على التوسع', 'الإدارة العليا', 'الربع القادم']] } }),
        sec('text', 'التوصيات', 'ما توصيتك للإدارة؟'),
      ],
    },
    {
      id: 'monthly', name: 'التقرير الشهري للإدارات', category: 'إدارية', cover: 'band', palette: 'teal', head: 'bar',
      desc: 'متابعة شهرية لأداء كل إدارة: مهام، مؤشرات، وتحديات.', toc: false, closing: false,
      sampleTitle: 'التقرير الشهري', sampleSub: 'أداء الإدارة خلال الشهر',
      sections: [
        sec('text', 'ملخص الشهر', 'لخّص الشهر في فقرة قصيرة.', { sample: '<p>أنجزت الإدارة غالبية المهام المخططة مع تحسن في زمن الاستجابة.</p>' }),
        sec('kpi', 'مؤشرات الشهر', 'أدخل أرقام الشهر الرئيسية.', { labels: ['المهام المنجزة', 'قيد التنفيذ', 'متأخرة'], sample: { style: 'cards', items: [K('المهام المنجزة', '42', '+9%'), K('قيد التنفيذ', '11', ''), K('متأخرة', '3', '-2')] } }),
        sec('table', 'المهام والإنجازات', 'سجّل المهام التي عملت عليها وحالتها.', { headers: ['المهمة', 'المسؤول', 'الحالة'], sample: { headers: ['المهمة', 'المسؤول', 'الحالة'], zebra: true, rows: [['تحديث الإجراءات', 'أحمد', 'مكتملة'], ['إعداد التقرير الربعي', 'سارة', 'قيد التنفيذ']] } }),
        sec('progress', 'نسب إنجاز الخطة', 'أدخل نسبة إنجاز كل محور من الخطة.', { labels: ['المحور الأول', 'المحور الثاني', 'المحور الثالث'], sample: { items: [{ label: 'المحور الأول', value: '90' }, { label: 'المحور الثاني', value: '65' }, { label: 'المحور الثالث', value: '40' }] } }),
        sec('list', 'التحديات', 'ما التحديات التي واجهتكم؟'),
        sec('list', 'خطة الشهر القادم', 'ما المخطط تنفيذه الشهر القادم؟'),
      ],
    },
    {
      id: 'kpi', name: 'تقرير الأداء ومؤشرات KPI', category: 'إدارية', cover: 'split', palette: 'sand', head: 'pill',
      desc: 'لوحة مؤشرات أداء مع رسوم ومقارنات.', toc: false, closing: false,
      sampleTitle: 'تقرير الأداء', sampleSub: 'مؤشرات الأداء الرئيسية',
      sections: [
        sec('kpi', 'المؤشرات الرئيسية', 'أدخل أهم مؤشرات الأداء مع تغيّرها.', { labels: ['مؤشر 1', 'مؤشر 2', 'مؤشر 3', 'مؤشر 4'], sample: { style: 'highlights', items: [K('رضا المستفيدين', '94%', '+3%'), K('زمن الاستجابة', '2.1 ساعة', '-12%'), K('تحقيق الأهداف', '88%', '+6%'), K('كفاءة التشغيل', '91%', '+2%')] } }),
        sec('compare', 'مقارنة بالفترة السابقة', 'أدخل قيمة المؤشر في الفترة السابقة والحالية لتظهر نسبة التغيّر.', { sample: { labels: { prev: 'الربع السابق', curr: 'الربع الحالي' }, rows: [{ label: 'رضا المستفيدين', prev: '90', curr: '94', unit: '%', better: 'up' }, { label: 'زمن الاستجابة (ساعة)', prev: '2.4', curr: '2.1', unit: '', better: 'down' }, { label: 'كفاءة التشغيل', prev: '89', curr: '91', unit: '%', better: 'up' }], chart: true, summary: true, decimals: 1 } }),
        sec('chart', 'الأداء مقابل المستهدف', 'أدخل القيمة الفعلية لكل فترة.', { kind: 'bar', width: 'half', sample: { kind: 'bar', unit: '', data: [{ label: 'يناير', value: '70' }, { label: 'فبراير', value: '78' }, { label: 'مارس', value: '85' }, { label: 'أبريل', value: '88' }] } }),
        sec('chart', 'اتجاه الأداء', 'أدخل القيم بالترتيب الزمني.', { kind: 'line', width: 'half', sample: { kind: 'line', unit: '', data: [{ label: 'يناير', value: '70' }, { label: 'فبراير', value: '78' }, { label: 'مارس', value: '85' }, { label: 'أبريل', value: '88' }] } }),
        sec('progress', 'تحقق الأهداف', 'أدخل نسبة تحقق كل هدف.', { labels: ['الهدف 1', 'الهدف 2', 'الهدف 3'] }),
        sec('table', 'جدول المقارنة', 'قارن بين المستهدف والفعلي.', { headers: ['المؤشر', 'المستهدف', 'الفعلي', 'الفرق'] }),
        sec('text', 'تحليل وتوصيات', 'ما قراءتك للأرقام؟ وما توصياتك؟'),
      ],
    },
    {
      id: 'projects', name: 'تقرير المشاريع والمبادرات', category: 'إدارية', cover: 'side', palette: 'plum', head: 'bar',
      desc: 'حالة المشاريع والمبادرات ومراحلها ومخاطرها.', toc: false, closing: false,
      sampleTitle: 'تقرير المشاريع', sampleSub: 'حالة المشاريع والمبادرات',
      sections: [
        sec('text', 'نبذة عن المشروع', 'ما المشروع؟ وما هدفه والجهة المستفيدة؟', { sample: '<p>مشروع لتطوير الخدمات الرقمية للمستفيدين خلال عام.</p>' }),
        sec('kpi', 'مؤشرات المشروع', 'الحالة، نسبة الإنجاز، الميزانية.', { labels: ['الحالة', 'نسبة الإنجاز', 'الميزانية المصروفة'], sample: { style: 'cards', items: [K('الحالة', 'يسير وفق الخطة', ''), K('نسبة الإنجاز', '68%', '+8%'), K('الميزانية المصروفة', '52%', '')] } }),
        sec('calc', 'الموقف المالي للمشروع', 'أدخل التبرعات وما نُفّذ منها، ويُحسب المتبقي ونسبة التنفيذ تلقائياً.', { recipe: 'budget', sample: { style: 'table', rows: [{ key: 'A', label: 'التبرعات', kind: 'input', value: '500000', unit: 'ريال', fmt: 'number' }, { key: 'B', label: 'المنفّذ', kind: 'input', value: '320000', unit: 'ريال', fmt: 'number' }, { key: 'C', label: 'المتبقي', kind: 'calc', op: 'sub', args: ['A', 'B'], formula: '', unit: 'ريال', fmt: 'number' }, { key: 'D', label: 'نسبة التنفيذ', kind: 'calc', op: 'pct', args: ['B', 'A'], formula: '', unit: '', fmt: 'percent' }] } }),
        sec('timeline', 'المراحل والمعالم', 'اذكر المراحل وحالة كل مرحلة.', { sample: { items: [{ date: 'الربع 1', title: 'التخطيط', desc: '', status: 'done' }, { date: 'الربع 2', title: 'التنفيذ', desc: '', status: 'active' }, { date: 'الربع 3', title: 'الإطلاق', desc: '', status: 'todo' }] } }),
        sec('table', 'المهام', 'سجّل مهام المشروع ومن المسؤول عن كل مهمة وحالتها.', { headers: ['المهمة', 'المسؤول', 'الحالة', 'الإنجاز'] }),
        sec('table', 'المخاطر والعوائق', 'ما المخاطر؟ وما إجراء المعالجة؟', { headers: ['الخطر', 'الأثر', 'إجراء المعالجة'] }),
        sec('text', 'الخطوات القادمة', 'ما سيتم عمله في المرحلة التالية؟'),
      ],
    },
    {
      id: 'it', name: 'تقرير تقنية المعلومات', category: 'تقنية', cover: 'band', palette: 'navy', head: 'underline',
      desc: 'التذاكر وجاهزية الأنظمة والمشاريع والأداء.', toc: false, closing: false,
      sampleTitle: 'تقرير تقنية المعلومات', sampleSub: 'الأنظمة والدعم والمشاريع',
      sections: [
        sec('kpi', 'مؤشرات الخدمة', 'أدخل أرقام الدعم الفني وجاهزية الأنظمة.', { labels: ['جاهزية الأنظمة', 'التذاكر المغلقة', 'زمن الحل'], sample: { style: 'cards', items: [K('جاهزية الأنظمة', '99.7%', '+0.2%'), K('التذاكر المغلقة', '318', '+14%'), K('متوسط زمن الحل', '3.2 ساعة', '-9%')] } }),
        sec('chart', 'التذاكر حسب الفئة', 'أدخل عدد التذاكر لكل فئة.', { kind: 'hbar', width: 'half', sample: { kind: 'hbar', unit: '', data: [{ label: 'الشبكات', value: '64' }, { label: 'البرامج', value: '120' }, { label: 'الأجهزة', value: '88' }, { label: 'الحسابات', value: '46' }] } }),
        sec('chart', 'التذاكر الشهرية', 'أدخل عدد التذاكر لكل شهر.', { kind: 'line', width: 'half' }),
        sec('table', 'حالة الأنظمة', 'اذكر كل نظام وحالته وآخر صيانة.', { headers: ['النظام', 'الحالة', 'آخر صيانة'] }),
        sec('table', 'مشاريع التقنية', 'اذكر المشاريع وحالتها.', { headers: ['المشروع', 'الحالة', 'الإنجاز'] }),
        sec('text', 'التحديات والتوصيات', 'ما التحديات؟ وما المطلوب لمعالجتها؟'),
      ],
    },
    {
      id: 'cyber', name: 'تقرير الأمن السيبراني والامتثال', category: 'تقنية', cover: 'hero', palette: 'slate', head: 'bar',
      desc: 'مستوى الامتثال والمخاطر وخطط المعالجة.', toc: false, closing: false,
      sampleTitle: 'تقرير الأمن السيبراني', sampleSub: 'مستوى الامتثال والمخاطر',
      sections: [
        sec('kpi', 'مستوى الامتثال', 'أدخل نسب الامتثال الرئيسية.', { labels: ['نسبة الامتثال', 'الحوادث', 'الثغرات المفتوحة'], sample: { style: 'highlights', items: [K('نسبة الامتثال', '87%', '+4%'), K('الحوادث', '5', '-3'), K('الثغرات المفتوحة', '12', '-6')] } }),
        sec('progress', 'الامتثال حسب المحور', 'أدخل نسبة الامتثال لكل محور.', { labels: ['الحوكمة', 'الحماية', 'الصمود'], sample: { items: [{ label: 'الحوكمة', value: '92' }, { label: 'الحماية', value: '84' }, { label: 'الصمود', value: '78' }] } }),
        sec('chart', 'الحوادث حسب النوع', 'أدخل عدد الحوادث لكل نوع.', { kind: 'donut', width: 'half' }),
        sec('table', 'سجل المخاطر', 'اذكر المخاطر وأولويتها وخطة المعالجة.', { headers: ['الخطر', 'الأولوية', 'خطة المعالجة', 'الموعد'] }),
        sec('text', 'ملاحظات المراجعة', 'أي ملاحظات من المراجعة أو التدقيق.'),
        sec('callout', 'التوصية الرئيسية', 'ما أهم توصية؟'),
      ],
    },
    {
      id: 'finance', name: 'التقرير المالي', category: 'مالية', cover: 'minimal', palette: 'sand', head: 'underline',
      desc: 'الإيرادات والمصروفات والميزانية والتحليل المالي.', toc: false, closing: false,
      sampleTitle: 'التقرير المالي', sampleSub: 'الإيرادات والمصروفات',
      sections: [
        sec('kpi', 'الملخص المالي', 'أدخل الإيرادات والمصروفات والفائض.', { labels: ['الإيرادات', 'المصروفات', 'الفائض'], sample: { style: 'cards', items: [K('الإيرادات', '4.8M', '+12%'), K('المصروفات', '4.1M', '+5%'), K('الفائض', '0.7M', '+31%')] } }),
        sec('calc', 'رصيد الميزانية', 'أدخل المعتمد والمصروف ويُحسب المتبقي ونسبة الصرف.', { recipe: 'budget', sample: { style: 'table', rows: [{ key: 'A', label: 'الميزانية المعتمدة', kind: 'input', value: '4800000', unit: 'ريال', fmt: 'number' }, { key: 'B', label: 'المصروف الفعلي', kind: 'input', value: '4100000', unit: 'ريال', fmt: 'number' }, { key: 'C', label: 'المتبقي', kind: 'calc', op: 'sub', args: ['A', 'B'], formula: '', unit: 'ريال', fmt: 'number' }, { key: 'D', label: 'نسبة الصرف', kind: 'calc', op: 'pct', args: ['B', 'A'], formula: '', unit: '', fmt: 'percent' }] } }),
        sec('compare', 'مقارنة بالعام السابق', 'قارن الإيرادات والمصروفات بين العامين. المصروفات: الانخفاض أفضل.', { sample: { labels: { prev: 'العام السابق', curr: 'العام الحالي' }, rows: [{ label: 'الإيرادات', prev: '4300000', curr: '4800000', unit: 'ريال', better: 'up' }, { label: 'المصروفات', prev: '3900000', curr: '4100000', unit: 'ريال', better: 'down' }], chart: true, summary: true, decimals: 1 } }),
        sec('chart', 'الإيرادات الشهرية', 'أدخل الإيراد لكل شهر.', { kind: 'bar', width: 'half' }),
        sec('chart', 'توزيع المصروفات', 'أدخل مصروف كل بند.', { kind: 'donut', width: 'half' }),
        sec('table', 'الميزانية مقابل الفعلي', 'قارن المعتمد بالفعلي لكل بند.', { headers: ['البند', 'المعتمد', 'الفعلي', 'الفرق'] }),
        sec('text', 'التحليل المالي', 'اشرح أسباب الفروقات الرئيسية.'),
        sec('callout', 'ملاحظة للإدارة', 'أي أمر مالي يحتاج انتباه الإدارة.'),
      ],
    },
    {
      id: 'hr', name: 'تقرير الموارد البشرية', category: 'موارد', cover: 'side', palette: 'teal', head: 'pill',
      desc: 'الموظفون والتوظيف والتدريب والرضا الوظيفي.', toc: false, closing: false,
      sampleTitle: 'تقرير الموارد البشرية', sampleSub: 'الكوادر والتطوير',
      sections: [
        sec('kpi', 'مؤشرات الموارد البشرية', 'عدد الموظفين والتعيينات والدوران.', { labels: ['عدد الموظفين', 'التعيينات', 'معدل الدوران'] }),
        sec('chart', 'الموظفون حسب الإدارة', 'أدخل عدد الموظفين لكل إدارة.', { kind: 'hbar', width: 'half' }),
        sec('chart', 'ساعات التدريب', 'أدخل ساعات التدريب لكل ربع.', { kind: 'bar', width: 'half' }),
        sec('table', 'التوظيف والوظائف الشاغرة', 'اذكر الوظائف وحالة التعيين.', { headers: ['الوظيفة', 'الإدارة', 'الحالة'] }),
        sec('progress', 'الرضا الوظيفي', 'أدخل نسب الرضا لكل محور.', { labels: ['بيئة العمل', 'التطوير', 'التقدير'] }),
        sec('text', 'ملاحظات وتوصيات', 'ما التوصيات؟'),
      ],
    },
    {
      coverIcon: 'hospitality', id: 'programs', name: 'تقرير البرامج والخدمات', category: 'إدارية', cover: 'split', palette: 'hadiyah', head: 'bar',
      desc: 'البرامج المنفذة والمستفيدون ومستوى الجودة.', toc: false, closing: false,
      sampleTitle: 'تقرير البرامج والخدمات', sampleSub: 'الأداء والمستفيدون',
      sections: [
        sec('kpi', 'حصاد البرامج', 'عدد البرامج والمستفيدين والساعات.', { labels: ['البرامج المنفذة', 'المستفيدون', 'ساعات العمل'] }),
        sec('compare', 'مقارنة بالعام الماضي', 'قارن مستفيدي وبرامج هذا العام بالعام الماضي.', { sample: { labels: { prev: 'العام الماضي', curr: 'العام الحالي' }, rows: [{ label: 'عدد المستفيدين', prev: '8200', curr: '9650', unit: '', better: 'up' }, { label: 'البرامج المنفذة', prev: '22', curr: '27', unit: '', better: 'up' }], chart: true, summary: true, decimals: 1 } }),
        sec('chart', 'المستفيدون حسب البرنامج', 'أدخل عدد المستفيدين لكل برنامج.', { kind: 'bar', width: 'half' }),
        sec('chart', 'توزيع المستفيدين', 'أدخل التوزيع حسب الفئة.', { kind: 'donut', width: 'half' }),
        sec('table', 'تفاصيل البرامج', 'اذكر كل برنامج وتاريخه وعدد مستفيديه.', { headers: ['البرنامج', 'التاريخ', 'المستفيدون', 'التقييم'] }),
        sec('text', 'قصص نجاح', 'اذكر قصة أو أكثر تعكس الأثر.'),
        sec('text', 'الدروس المستفادة', 'ما الذي تعلمتموه؟'),
      ],
    },
    {
      coverIcon: 'dua', id: 'impact', name: 'تقرير قياس الأثر', category: 'تأثير', cover: 'hero', palette: 'plum', head: 'underline',
      desc: 'قياس الأثر الاجتماعي بالمدخلات والمخرجات والنتائج.', toc: true, closing: true,
      sampleTitle: 'تقرير قياس الأثر', sampleSub: 'من المخرجات إلى الأثر',
      sections: [
        sec('text', 'منهجية القياس', 'كيف قسّتم الأثر؟ وما الأدوات المستخدمة؟'),
        sec('kpi', 'مؤشرات الأثر', 'أدخل أهم مؤشرات الأثر.', { labels: ['الأثر الرئيسي', 'نسبة التحسن', 'عدد المتأثرين'], sample: { style: 'highlights', items: [K('الأسر المستقرة', '1,240', '+22%', 'dua'), K('نسبة التحسن', '71%', '+9%'), K('المتأثرون', '5,800', '+15%')] } }),
        sec('chart', 'قبل وبعد البرنامج', 'قارن القيم قبل البرنامج وبعده.', { kind: 'bar', width: 'half' }),
        sec('progress', 'تحقق النتائج', 'أدخل نسبة تحقق كل نتيجة.', { labels: ['النتيجة 1', 'النتيجة 2', 'النتيجة 3'], width: 'half' }),
        sec('text', 'قصص الأثر', 'اذكر قصصاً ملهمة بإذن أصحابها.'),
        sec('text', 'التوصيات', 'كيف نضاعف الأثر؟'),
      ],
    },
    {
      coverIcon: 'mushaf', id: 'results', name: 'تقرير الإنجازات والنتائج', category: 'إدارية', cover: 'band', palette: 'hadiyah', head: 'pill',
      desc: 'ما أُنجز من مهام ومبادرات وما تحقق من نتائج.', toc: false, closing: false,
      sampleTitle: 'تقرير الإنجازات والنتائج', sampleSub: 'ما أُنجز وما تحقق',
      sections: [
        sec('text', 'نظرة عامة', 'لخّص الفترة وأبرز ما تحقق فيها.'),
        sec('kpi', 'النتائج بالأرقام', 'أدخل أبرز النتائج المحققة.', { labels: ['مهام منجزة', 'مبادرات', 'نسبة الإنجاز'] }),
        sec('list', 'أبرز الإنجازات', 'اكتب كل إنجاز في سطر مستقل.'),
        sec('timeline', 'خط الإنجاز', 'ضع الإنجازات على خط زمني.'),
        sec('list', 'التحديات', 'ما التحديات؟'),
        sec('text', 'الخطوات القادمة', 'ما التالي؟'),
      ],
    },
    {
      id: 'meeting', name: 'تقرير اجتماع الإدارات', category: 'إدارية', cover: 'minimal', palette: 'teal', head: 'bar',
      desc: 'محضر اجتماع: الحضور والنقاش والقرارات والتوصيات.', toc: false, closing: false,
      sampleTitle: 'تقرير اجتماع', sampleSub: 'محضر اجتماع الإدارات',
      sections: [
        sec('kpi', 'بيانات الاجتماع', 'التاريخ والمكان وعدد الحضور.', { labels: ['التاريخ', 'المكان', 'عدد الحضور'] }),
        sec('list', 'الحضور', 'اكتب اسم كل حاضر في سطر.'),
        sec('list', 'جدول الأعمال', 'ما البنود التي نوقشت؟', { ordered: true }),
        sec('text', 'ملخص النقاش', 'لخّص أهم ما دار في الاجتماع.'),
        sec('table', 'القرارات والتوصيات', 'سجّل القرار والمسؤول والموعد.', { headers: ['القرار', 'المسؤول', 'الموعد'] }),
      ],
    },

    // ===== الحزمة المالية =====
    {
      id: 'fin-revexp', name: 'الإيرادات والمصروفات', category: 'مالية', cover: 'band', palette: 'hadiyah', head: 'bar',
      desc: 'الإيرادات مقابل المصروفات والفائض أو العجز مع نسبة المصروفات.', toc: false, closing: false,
      sampleTitle: 'تقرير الإيرادات والمصروفات', sampleSub: 'الفترة المالية',
      sections: [
        sec('calc', 'الفائض أو العجز', 'أدخل إجمالي الإيرادات والمصروفات ويُحسب الفائض أو العجز ونسبة المصروفات تلقائياً.', { recipe: 'surplus', sample: calcS([CI('A', 'إجمالي الإيرادات', 4200000), CI('B', 'إجمالي المصروفات', 3650000), CC('C', 'الفائض / العجز', 'sub', ['A', 'B']), CP('D', 'نسبة المصروفات من الإيرادات', ['B', 'A'])]) }),
        sec('chart', 'الإيرادات حسب المصدر', 'أدخل مبلغ كل مصدر إيراد.', { kind: 'donut', width: 'half', sample: chS('donut', [['التبرعات', 2600], ['الأوقاف', 900], ['الشراكات', 500], ['أخرى', 200]], 'ألف ريال') }),
        sec('chart', 'المصروفات حسب البند', 'أدخل مبلغ كل بند مصروف.', { kind: 'hbar', width: 'half', sample: chS('hbar', [['البرامج', 2100], ['الرواتب', 900], ['التشغيل', 450], ['التسويق', 200]], 'ألف ريال') }),
        sec('table', 'تفصيل الإيرادات والمصروفات', 'سجّل كل بند ومبلغه.', { headers: ['البند', 'النوع', 'المبلغ'], sample: tbS(['البند', 'النوع', 'المبلغ'], [['تبرعات نقدية', 'إيراد', '2,600,000'], ['رواتب وأجور', 'مصروف', '900,000']]) }),
        sec('text', 'ملاحظات وتحليل', 'اكتب أسباب الفائض أو العجز وأي ملاحظات. ' + NOTE),
      ],
    },
    {
      id: 'fin-budget', name: 'الميزانية: التقديرية مقابل الفعلية', category: 'مالية', cover: 'split', palette: 'teal', head: 'underline',
      desc: 'مقارنة الميزانية التقديرية بالفعلية ونسبة الصرف والانحراف.', toc: false, closing: false,
      sampleTitle: 'الميزانية التقديرية والفعلية', sampleSub: 'متابعة الصرف',
      sections: [
        sec('calc', 'ملخص الميزانية', 'أدخل الميزانية المعتمدة والمصروف الفعلي.', { recipe: 'budget', sample: calcS([CI('A', 'الميزانية المعتمدة', 2000000), CI('B', 'المصروف الفعلي', 1450000), CC('C', 'المتبقي', 'sub', ['A', 'B']), CP('D', 'نسبة الصرف', ['B', 'A']), CF('E', 'نسبة المتبقي', '(A-B)/A*100')]) }),
        sec('chart', 'نسبة الصرف', 'أدخل نسبة الصرف الحالية.', { kind: 'gauge', width: 'half', sample: { kind: 'gauge', unit: '%', max: '100', data: [{ label: 'نسبة الصرف', value: '72.5' }] } }),
        sec('chart', 'التقديري مقابل الفعلي', 'أدخل القيم لكل بند.', { kind: 'bar', width: 'half', sample: chS('bar', [['البرامج', 1200], ['التشغيل', 400], ['الموارد', 300], ['التسويق', 100]], 'ألف ريال') }),
        sec('table', 'تفصيل الميزانية', 'لكل بند: التقديري والفعلي والفرق.', { headers: ['البند', 'التقديري', 'الفعلي', 'الفرق'], sample: tbS(['البند', 'التقديري', 'الفعلي', 'الفرق'], [['البرامج', '1,200,000', '950,000', '250,000'], ['التشغيل', '400,000', '310,000', '90,000']]) }),
        sec('text', 'ملاحظات', 'اذكر تفسير الانحرافات الكبيرة. ' + NOTE),
      ],
    },
    {
      id: 'fin-cashflow', name: 'التدفقات النقدية', category: 'مالية', cover: 'minimal', palette: 'navy', head: 'pill',
      desc: 'الرصيد الافتتاحي والتدفقات الداخلة والخارجة والرصيد الختامي.', toc: false, closing: false,
      sampleTitle: 'تقرير التدفقات النقدية', sampleSub: 'حركة النقد',
      sections: [
        sec('calc', 'ملخص التدفق النقدي', 'أدخل الرصيد الافتتاحي والتدفقات الداخلة والخارجة.', { sample: calcS([CI('A', 'الرصيد الافتتاحي', 800000), CI('B', 'التدفقات الداخلة', 1900000), CI('C', 'التدفقات الخارجة', 1550000), CC('D', 'صافي التدفق', 'sub', ['B', 'C']), CC('E', 'الرصيد الختامي', 'formula', [], { formula: 'A+B-C' })]) }),
        sec('chart', 'الشلال النقدي', 'الأول رصيد افتتاحي، ثم أرقام موجبة (دخل) وسالبة (خرج).', { kind: 'waterfall', sample: chS('waterfall', [['الافتتاحي', 800], ['تبرعات', 1400], ['أوقاف', 500], ['برامج', -1100], ['تشغيل', -450]], 'ألف ريال') }),
        sec('chart', 'الرصيد الشهري', 'أدخل الرصيد في نهاية كل شهر.', { kind: 'line', sample: chS('line', [['يناير', 800], ['فبراير', 920], ['مارس', 1010], ['أبريل', 1150]], 'ألف ريال') }),
        sec('text', 'ملاحظات', 'أي ملاحظات على السيولة. ' + NOTE),
      ],
    },
    {
      id: 'fin-donations', name: 'التبرعات والموارد', category: 'مالية', cover: 'hero', palette: 'hadiyah', head: 'bar',
      desc: 'التبرعات حسب القناة والمشروع ومقارنة بالعام السابق.', toc: false, closing: false,
      sampleTitle: 'تقرير التبرعات', sampleSub: 'الموارد والمتبرعون',
      sections: [
        sec('kpi', 'أبرز الأرقام', 'أدخل أهم أرقام التبرعات.', { labels: ['إجمالي التبرعات', 'عدد المتبرعين', 'متوسط التبرع'], sample: kS([['إجمالي التبرعات', '2.6 مليون', '+12%'], ['عدد المتبرعين', '3,420', '+8%'], ['متوسط التبرع', '760 ريال', '+3%']]) }),
        sec('compare', 'مقارنة بالعام السابق', 'قيمة كل قناة في العام الماضي والحالي.', { sample: cmpS('العام الماضي', 'العام الحالي', [['التبرعات الإلكترونية', 900000, 1300000, 'ريال'], ['التبرعات النقدية', 800000, 750000, 'ريال'], ['الشراكات', 400000, 550000, 'ريال']]) }),
        sec('chart', 'التبرعات حسب القناة', 'أدخل مبلغ كل قناة.', { kind: 'pie', width: 'half', sample: chS('pie', [['إلكتروني', 1300], ['نقدي', 750], ['شراكات', 550]], 'ألف ريال') }),
        sec('chart', 'التبرعات الشهرية', 'أدخل التبرعات لكل شهر.', { kind: 'area', width: 'half', sample: chS('area', [['يناير', 180], ['فبراير', 210], ['مارس', 260], ['أبريل', 240]], 'ألف ريال') }),
        sec('calc', 'التبرعات والمنفّذ لمشروع', 'احسب ما نُفّذ من التبرعات والمتبقي.', { recipe: 'budget', sample: calcS([CI('A', 'التبرعات', 500000), CI('B', 'المنفّذ', 320000), CC('C', 'المتبقي', 'sub', ['A', 'B']), CP('D', 'نسبة التنفيذ', ['B', 'A'])]) }),
        sec('text', 'ملاحظات', NOTE),
      ],
    },
    {
      id: 'fin-multiyear', name: 'مقارنة الأداء المالي لعدة سنوات', category: 'مالية', cover: 'side', palette: 'plum', head: 'underline',
      desc: 'جدول مقارنة لثلاث سنوات ونمو سنوي ونمو تراكمي.', toc: false, closing: false,
      sampleTitle: 'مقارنة الأداء المالي 2023–2025', sampleSub: 'نمو سنوي وتراكمي',
      sections: [
        sec('table', 'جدول المقارنة', 'أدخل القيم لكل سنة.', { headers: ['البند', '2023', '2024', '2025'], sample: tbS(['البند', '2023', '2024', '2025'], [['الإيرادات', '3,100,000', '3,700,000', '4,200,000'], ['المصروفات', '2,900,000', '3,300,000', '3,650,000'], ['الفائض', '200,000', '400,000', '550,000']]) }),
        sec('calc', 'النمو', 'أدخل الإيراد في أول وآخر سنة.', { sample: calcS([CI('A', 'الإيراد 2023', 3100000), CI('B', 'الإيراد 2024', 3700000), CI('C', 'الإيراد 2025', 4200000), CF('D', 'النمو 2024', '(B-A)/A*100'), CF('E', 'النمو 2025', '(C-B)/B*100'), CF('F', 'النمو التراكمي', '(C-A)/A*100')]) }),
        sec('chart', 'اتجاه الإيرادات', 'أدخل الإيراد لكل سنة.', { kind: 'bar', width: 'half', sample: chS('bar', [['2023', 3100], ['2024', 3700], ['2025', 4200]], 'ألف ريال') }),
        sec('chart', 'اتجاه الفائض', 'أدخل الفائض لكل سنة.', { kind: 'line', width: 'half', sample: chS('line', [['2023', 200], ['2024', 400], ['2025', 550]], 'ألف ريال') }),
        sec('text', 'قراءة الأرقام', NOTE),
      ],
    },
    {
      id: 'fin-variance', name: 'تحليل الانحرافات', category: 'مالية', cover: 'minimal', palette: 'sand', head: 'bar',
      desc: 'الانحراف بين المخطط والفعلي لكل بند مع تصنيف الأثر.', toc: false, closing: false,
      sampleTitle: 'تحليل الانحرافات المالية', sampleSub: 'المخطط مقابل الفعلي',
      sections: [
        sec('compare', 'المخطط مقابل الفعلي', 'أدخل المخطط في الخانة الأولى والفعلي في الثانية؛ اختر اتجاه «الأفضل» للمصروف: الأقل أفضل.', { sample: cmpS('المخطط', 'الفعلي', [['البرامج', 1200, 1150, 'ألف', 'down'], ['التشغيل', 400, 460, 'ألف', 'down'], ['الإيرادات', 1900, 2100, 'ألف', 'up']]) }),
        sec('chart', 'الانحراف حسب البند', 'موجب = زيادة، سالب = نقص.', { kind: 'waterfall', sample: chS('waterfall', [['المخطط', 1500], ['البرامج', -50], ['التشغيل', 60], ['التسويق', -20]], 'ألف ريال') }),
        sec('calc', 'انحراف الميزانية', 'احسب الفرق والنسبة.', { sample: calcS([CI('A', 'المخطط', 1500000), CI('B', 'الفعلي', 1490000), CC('C', 'الانحراف', 'sub', ['B', 'A']), CF('D', 'نسبة الانحراف', '(B-A)/A*100')]) }),
        sec('table', 'أسباب الانحرافات', 'اذكر السبب وإجراء المعالجة.', { headers: ['البند', 'السبب', 'الإجراء'] }),
      ],
    },
    {
      id: 'fin-opex', name: 'المصروفات التشغيلية', category: 'مالية', cover: 'band', palette: 'slate', head: 'pill',
      desc: 'المصروفات التشغيلية حسب البند والإدارة ونسبتها من الميزانية.', toc: false, closing: false,
      sampleTitle: 'تقرير المصروفات التشغيلية', sampleSub: 'متابعة الإنفاق',
      sections: [
        sec('calc', 'ملخص التشغيل', '', { recipe: 'budget', sample: calcS([CI('A', 'التبرعات', 500000), CI('B', 'المنفّذ', 320000), CC('C', 'المتبقي', 'sub', ['A', 'B']), CP('D', 'نسبة التنفيذ', ['B', 'A'])]) }),
        sec('chart', 'المصروف حسب البند', 'أدخل مبلغ كل بند.', { kind: 'hbar', width: 'half', sample: chS('hbar', [['رواتب', 900], ['إيجارات', 300], ['خدمات', 150], ['صيانة', 90]], 'ألف ريال') }),
        sec('chart', 'المصروف حسب الإدارة', '', { kind: 'pie', width: 'half' }),
        sec('table', 'تفصيل المصروفات', '', { headers: ['البند', 'الإدارة', 'المبلغ', 'نسبة من الميزانية'] }),
        sec('text', 'ملاحظات', NOTE),
      ],
    },
    {
      id: 'fin-annual', name: 'الأداء المالي السنوي', category: 'مالية', cover: 'hero', palette: 'hadiyah', head: 'bar',
      desc: 'تقرير مالي سنوي شامل: مؤشرات، مقارنة، توزيع، ومركز مالي.', toc: true, closing: true,
      sampleTitle: 'التقرير المالي السنوي', sampleSub: 'الأداء المالي للعام',
      sections: [
        sec('kpi', 'المؤشرات المالية', 'أدخل أهم الأرقام.', { labels: ['الإيرادات', 'المصروفات', 'الفائض', 'الأصول'], sample: kS([['الإيرادات', '4.2 مليون', '+14%'], ['المصروفات', '3.65 مليون', '+10%'], ['الفائض', '550 ألف', '+37%'], ['إجمالي الأصول', '9.8 مليون', '+6%']], 'highlights') }),
        sec('compare', 'مقارنة بالعام الماضي', '', { sample: cmpS('العام الماضي', 'العام الحالي', [['الإيرادات', 3700, 4200, 'ألف'], ['المصروفات', 3300, 3650, 'ألف', 'down'], ['الفائض', 400, 550, 'ألف']]) }),
        sec('chart', 'توزيع الإيرادات', '', { kind: 'donut', width: 'half' }),
        sec('chart', 'توزيع المصروفات', '', { kind: 'donut', width: 'half' }),
        sec('table', 'المركز المالي', 'الأصول والخصوم وصافي الأصول.', { headers: ['البند', 'العام الماضي', 'العام الحالي'], sample: tbS(['البند', 'العام الماضي', 'العام الحالي'], [['إجمالي الأصول', '9,200,000', '9,800,000'], ['إجمالي الخصوم', '1,100,000', '1,000,000'], ['صافي الأصول', '8,100,000', '8,800,000']]) }),
        sec('text', 'تحليل الإدارة المالية', NOTE),
      ],
    },
    // ===== الحزمة الإدارية =====
    {
      id: 'adm-hr', name: 'تقرير الموارد البشرية', category: 'موارد', cover: 'split', palette: 'teal', head: 'underline',
      desc: 'القوى العاملة والتوظيف والتدريب والاستقرار الوظيفي.', toc: false, closing: false,
      sampleTitle: 'تقرير الموارد البشرية', sampleSub: 'القوى العاملة',
      sections: [
        sec('kpi', 'مؤشرات القوى العاملة', '', { labels: ['عدد الموظفين', 'نسبة السعودة', 'الدوران الوظيفي', 'ساعات التدريب'], sample: kS([['عدد الموظفين', '86', '+6'], ['نسبة السعودة', '82%', '+2%'], ['الدوران الوظيفي', '7%', '-2%'], ['ساعات التدريب', '1,240', '+18%']]) }),
        sec('compare', 'مقارنة بالعام الماضي', '', { sample: cmpS('العام الماضي', 'العام الحالي', [['عدد الموظفين', 80, 86, ''], ['الدوران الوظيفي', 9, 7, '%', 'down'], ['ساعات التدريب', 1050, 1240, '']]) }),
        sec('chart', 'الموظفون حسب الإدارة', '', { kind: 'hbar', width: 'half', sample: chS('hbar', [['البرامج', 28], ['المالية', 12], ['التقنية', 10], ['الموارد البشرية', 6]]) }),
        sec('chart', 'التوظيف الشهري', '', { kind: 'bar', width: 'half' }),
        sec('table', 'الوظائف الشاغرة', '', { headers: ['الوظيفة', 'الإدارة', 'الحالة'] }),
      ],
    },
    {
      id: 'adm-risk', name: 'تقرير المخاطر والامتثال', category: 'إدارية', cover: 'minimal', palette: 'slate', head: 'bar',
      desc: 'سجل المخاطر ومصفوفة الأثر والاحتمال وحالة الامتثال.', toc: false, closing: false,
      sampleTitle: 'تقرير المخاطر والامتثال', sampleSub: 'إدارة المخاطر',
      sections: [
        sec('kpi', 'مؤشرات المخاطر', '', { labels: ['مخاطر مرتفعة', 'مخاطر متوسطة', 'نسبة الامتثال'], sample: kS([['مخاطر مرتفعة', '3', '-1'], ['مخاطر متوسطة', '9', '-2'], ['نسبة الامتثال', '91%', '+3%']]) }),
        sec('table', 'مصفوفة المخاطر (خريطة حرارية)', 'أدخل درجة كل خطر (1–5) في كل مجال.', { headers: ['المجال', 'الاحتمال', 'الأثر', 'الدرجة'], sample: Object.assign(tbS(['المجال', 'الاحتمال', 'الأثر', 'الدرجة'], [['تشغيلي', '3', '4', '12'], ['مالي', '2', '5', '10'], ['سمعة', '2', '3', '6'], ['تقني', '4', '4', '16']]), { heat: true }) }),
        sec('table', 'سجل المخاطر', '', { headers: ['الخطر', 'المسؤول', 'خطة المعالجة', 'الموعد'] }),
        sec('chart', 'الامتثال', '', { kind: 'gauge', width: 'half', sample: { kind: 'gauge', unit: '%', max: '100', data: [{ label: 'نسبة الامتثال', value: '91' }] } }),
        sec('text', 'التوصيات', ''),
      ],
    },
    {
      id: 'adm-init', name: 'متابعة المبادرات والخطة الاستراتيجية', category: 'إدارية', cover: 'side', palette: 'navy', head: 'bar',
      desc: 'تقدم المبادرات ومخطط جانت ونسب الإنجاز.', toc: false, closing: false,
      sampleTitle: 'متابعة المبادرات', sampleSub: 'الخطة الاستراتيجية',
      sections: [
        sec('progress', 'إنجاز المبادرات', '', { labels: ['مبادرة 1', 'مبادرة 2', 'مبادرة 3'], sample: prS([['التحول الرقمي', 70], ['تطوير الشراكات', 55], ['رفع الاستدامة المالية', 40]]) }),
        sec('gantt', 'الجدول الزمني', 'أدخل المبادرات بتواريخها ونسب إنجازها.', { sample: { items: [{ name: 'التحول الرقمي', start: '2026-01-01', end: '2026-09-30', progress: '70', owner: 'التقنية' }, { name: 'تطوير الشراكات', start: '2026-02-01', end: '2026-11-30', progress: '55', owner: 'الشراكات' }, { name: 'الاستدامة المالية', start: '2026-04-01', end: '2026-12-31', progress: '40', owner: 'المالية' }] } }),
        sec('table', 'تفاصيل المبادرات', '', { headers: ['المبادرة', 'المسؤول', 'الحالة', 'الإنجاز'] }),
        sec('text', 'التحديات', ''),
      ],
    },
    {
      id: 'adm-dept', name: 'إنجازات الإدارات', category: 'إدارية', cover: 'band', palette: 'plum', head: 'pill',
      desc: 'إنجازات كل إدارة ومؤشراتها خلال الفترة.', toc: false, closing: false,
      sampleTitle: 'إنجازات الإدارات', sampleSub: 'الفترة',
      sections: [
        sec('chart', 'الإنجاز حسب الإدارة', '', { kind: 'radar', sample: chS('radar', [['البرامج', 90], ['المالية', 82], ['التقنية', 75], ['الموارد', 88], ['الشراكات', 70]], '%') }),
        sec('table', 'إنجازات الإدارات', '', { headers: ['الإدارة', 'أبرز الإنجازات', 'نسبة الإنجاز'] }),
        sec('text', 'الخلاصة', ''),
      ],
    },
    {
      id: 'adm-ops', name: 'الخدمات التشغيلية', category: 'إدارية', cover: 'split', palette: 'sand', head: 'underline',
      desc: 'حجم الطلبات وزمن الإنجاز ورضا المستفيدين.', toc: false, closing: false,
      sampleTitle: 'تقرير الخدمات التشغيلية', sampleSub: 'جودة الخدمة',
      sections: [
        sec('kpi', 'مؤشرات الخدمة', '', { labels: ['الطلبات', 'زمن الإنجاز', 'الرضا'], sample: kS([['الطلبات', '5,240', '+11%'], ['زمن الإنجاز', '1.8 يوم', '-15%'], ['الرضا', '93%', '+2%']]) }),
        sec('chart', 'مسار الطلبات', 'من الاستلام إلى الإنجاز.', { kind: 'funnel', width: 'half', sample: chS('funnel', [['مستلمة', 5240], ['قيد المعالجة', 4900], ['مكتملة', 4650]]) }),
        sec('chart', 'الطلبات الشهرية', '', { kind: 'line', width: 'half' }),
        sec('table', 'الخدمات', '', { headers: ['الخدمة', 'الطلبات', 'متوسط الزمن', 'الرضا'] }),
      ],
    },
    // ===== حزمة المشاريع والبرامج =====
    {
      id: 'prj-completion', name: 'نسبة إنجاز المشروع', category: 'مشاريع', cover: 'hero', palette: 'hadiyah', head: 'bar',
      desc: 'إنجاز المشروع والمراحل والمهام والميزانية في صفحة واحدة.', toc: false, closing: false,
      sampleTitle: 'تقرير إنجاز المشروع', sampleSub: 'متابعة المراحل',
      sections: [
        sec('chart', 'نسبة الإنجاز الكلية', '', { kind: 'gauge', width: 'half', sample: { kind: 'gauge', unit: '%', max: '100', data: [{ label: 'الإنجاز', value: '68' }] } }),
        sec('calc', 'الموقف المالي', '', { recipe: 'budget', sample: calcS([CI('A', 'التبرعات', 500000), CI('B', 'المنفّذ', 320000), CC('C', 'المتبقي', 'sub', ['A', 'B']), CP('D', 'نسبة التنفيذ', ['B', 'A'])]) }),
        sec('gantt', 'مراحل المشروع', '', { sample: { items: [{ name: 'التخطيط', start: '2026-01-01', end: '2026-02-28', progress: '100', owner: '' }, { name: 'التنفيذ', start: '2026-03-01', end: '2026-08-31', progress: '60', owner: '' }, { name: 'التسليم', start: '2026-09-01', end: '2026-10-31', progress: '0', owner: '' }] } }),
        sec('table', 'المهام', '', { headers: ['المهمة', 'المسؤول', 'الحالة', 'الإنجاز'] }),
        sec('text', 'المخاطر والخطوات القادمة', ''),
      ],
    },
    {
      id: 'prj-beneficiaries', name: 'المستفيدون والأثر المجتمعي', category: 'تأثير', cover: 'hero', palette: 'hadiyah', head: 'bar',
      desc: 'عدد المستفيدين وتوزيعهم ومؤشرات الأثر ومقارنة بالأعوام.', toc: false, closing: false,
      sampleTitle: 'المستفيدون والأثر', sampleSub: 'أثر البرامج',
      sections: [
        sec('kpi', 'أرقام الأثر', '', { labels: ['المستفيدون', 'البرامج', 'المناطق'], sample: kS([['المستفيدون', '48,200', '+16%'], ['البرامج', '14', '+2'], ['المناطق', '9', '+1']], 'highlights') }),
        sec('chart', 'المستفيدون حسب البرنامج', '', { kind: 'hbar', width: 'half', sample: chS('hbar', [['السقيا', 18000], ['الإرشاد', 14000], ['الضيافة', 9000], ['الرعاية', 7200]]) }),
        sec('chart', 'المستفيدون حسب المنطقة', '', { kind: 'donut', width: 'half' }),
        sec('compare', 'مقارنة بالعام الماضي', '', { sample: cmpS('العام الماضي', 'العام الحالي', [['المستفيدون', 41500, 48200], ['ساعات التطوع', 9800, 12400]]) }),
        sec('text', 'قصص نجاح', ''),
      ],
    },
    {
      id: 'prj-cost', name: 'تكلفة المشروع والمصروفات', category: 'مشاريع', cover: 'band', palette: 'teal', head: 'underline',
      desc: 'ميزانية المشروع والمصروفات حسب البند ومعدل الصرف.', toc: false, closing: false,
      sampleTitle: 'تكلفة المشروع', sampleSub: 'الميزانية والمصروفات',
      sections: [
        sec('calc', 'الميزانية والمصروف', '', { recipe: 'budget', sample: calcS([CI('A', 'التبرعات', 500000), CI('B', 'المنفّذ', 320000), CC('C', 'المتبقي', 'sub', ['A', 'B']), CP('D', 'نسبة التنفيذ', ['B', 'A'])]) }),
        sec('chart', 'المصروف حسب البند', '', { kind: 'pie', width: 'half' }),
        sec('chart', 'الصرف التراكمي', '', { kind: 'area', width: 'half' }),
        sec('table', 'بنود التكلفة', '', { headers: ['البند', 'المخطط', 'الفعلي', 'المتبقي'] }),
      ],
    },
    {
      id: 'prj-hajj', name: 'أداء برنامج موسم الحج والعمرة', category: 'تأثير', cover: 'hero', palette: 'hadiyah', head: 'bar', coverIcon: 'ornament',
      desc: 'أداء البرامج الموسمية: الخدمات والمستفيدون والمتطوعون والميزانية.', toc: true, closing: true,
      sampleTitle: 'أداء برنامج الموسم', sampleSub: 'موسم الحج والعمرة',
      sections: [
        sec('kpi', 'أرقام الموسم', '', { labels: ['الحجاج والمعتمرون', 'المتطوعون', 'الخدمات المقدّمة', 'الرضا'], sample: kS([['المستفيدون', '120,000', '+18%'], ['المتطوعون', '1,450', '+9%'], ['الخدمات', '310,000', '+22%'], ['الرضا', '95%', '+2%']], 'highlights') }),
        sec('compare', 'مقارنة بالموسم السابق', '', { sample: cmpS('الموسم السابق', 'الموسم الحالي', [['المستفيدون', 101500, 120000], ['الخدمات المقدمة', 254000, 310000]]) }),
        sec('chart', 'الخدمات حسب النوع', '', { kind: 'donut', width: 'half', sample: chS('donut', [['سقيا', 120], ['ضيافة', 90], ['إرشاد', 60], ['رعاية', 40]], 'ألف') }),
        sec('chart', 'المستفيدون حسب الأسبوع', '', { kind: 'bar', width: 'half' }),
        sec('calc', 'ميزانية الموسم', '', { recipe: 'budget', sample: calcS([CI('A', 'التبرعات', 500000), CI('B', 'المنفّذ', 320000), CC('C', 'المتبقي', 'sub', ['A', 'B']), CP('D', 'نسبة التنفيذ', ['B', 'A'])]) }),
        sec('timeline', 'محطات الموسم', '', {}),
        sec('text', 'الدروس المستفادة', ''),
      ],
    },
    {
      id: 'prj-compare', name: 'مقارنة المشاريع', category: 'مشاريع', cover: 'split', palette: 'plum', head: 'pill',
      desc: 'مقارنة عدة مشاريع من حيث الميزانية والإنجاز والمستفيدين.', toc: false, closing: false,
      sampleTitle: 'مقارنة المشاريع', sampleSub: 'الميزانية والإنجاز',
      sections: [
        sec('table', 'جدول المقارنة (خريطة حرارية)', '', { headers: ['المشروع', 'الميزانية', 'الإنجاز %', 'المستفيدون'], sample: Object.assign(tbS(['المشروع', 'الميزانية', 'الإنجاز %', 'المستفيدون'], [['السقيا', '800000', '90', '18000'], ['الإرشاد', '500000', '70', '14000'], ['الضيافة', '650000', '55', '9000']]), { heat: true }) }),
        sec('chart', 'الإنجاز حسب المشروع', '', { kind: 'bar', width: 'half', sample: chS('bar', [['السقيا', 90], ['الإرشاد', 70], ['الضيافة', 55]], '%') }),
        sec('chart', 'مقارنة الأبعاد', '', { kind: 'radar', width: 'half' }),
        sec('text', 'التوصيات', ''),
      ],
    },
    {
      id: 'blank', name: 'تقرير فارغ', category: 'عام', cover: 'band', palette: 'hadiyah', head: 'bar',
      desc: 'ابدأ من الصفر وأضف الأقسام التي تحتاجها.', toc: false, closing: false,
      sampleTitle: 'عنوان التقرير', sampleSub: '',
      sections: [sec('text', 'المقدمة', 'اكتب مقدمة قصيرة عن موضوع التقرير.')],
    },
  ];

  const CATEGORIES = ['الكل', 'إدارية', 'مالية', 'مشاريع', 'تأثير', 'تقنية', 'موارد', 'عام'];
  const byId = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[TEMPLATES.length - 1];

  const DEFAULT_OPTIONS = { cover: true, toc: false, closing: false, header: true, pageNumbers: true, margins: 'normal', footerText: '', coverIcon: '' };

  function createReport(templateId, opts) {
    opts = opts || {};
    const t = byId(templateId);
    return {
      version: 2, id: null, template: t.id, sample: !!opts.sample,
      title: opts.sample ? t.sampleTitle : '', subtitle: opts.sample ? t.sampleSub : '',
      period: opts.sample ? 'الفترة: 2026' : '', employee: '', department: '', date: new Date().toISOString().slice(0, 10),
      palette: t.palette,
      options: Object.assign({}, DEFAULT_OPTIONS, { toc: !!t.toc, closing: !!t.closing, coverIcon: t.coverIcon || '' }),
      sections: t.sections.map((s) => makeSection(s.type, s.title, Object.assign({}, s, { useSample: !!opts.sample }))),
    };
  }

  // ترقية بيانات الإصدار الأول (version 1) إلى النموذج الحالي
  function migrate(d) {
    if (d && d.version === 2) return d;
    const r = createReport('blank');
    r.id = d.id || null;
    r.title = d.title || ''; r.employee = d.employee || ''; r.department = d.department || ''; r.date = d.date || r.date;
    r.legacyType = d.type || '';
    r.sections = (d.sections || []).map((s) => {
      const sec2 = makeSection(s.type === 'chart' || s.type === 'kpi' || s.type === 'table' || s.type === 'list' ? s.type : 'text', s.title);
      sec2.width = s.width === 'half' ? 'half' : 'full';
      if (s.type === 'list') sec2.content = { ordered: false, items: Array.isArray(s.content) ? s.content : [] };
      else if (s.type === 'kpi') sec2.content = { style: 'cards', items: Array.isArray(s.content) ? s.content : [] };
      else if (s.type === 'table') sec2.content = { headers: (s.content && s.content.headers) || [], rows: (s.content && s.content.rows) || [], zebra: true };
      else if (s.type === 'chart') sec2.content = { kind: (s.content && s.content.kind) || 'bar', unit: '', data: (s.content && s.content.data) || [] };
      else sec2.content = '<p>' + String(s.content || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\r?\n/g, '<br>') + '</p>';
      return sec2;
    });
    return r;
  }

  return { CALC_RECIPES, defaultCompare, PALETTES, BLOCKS, TYPES, TEMPLATES, CATEGORIES, DEFAULT_OPTIONS, byId, uid, emptyContent, makeSection, createReport, migrate };
});
