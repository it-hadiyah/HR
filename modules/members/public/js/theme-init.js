// يُنفَّذ قبل رسم الصفحة لتفادي وميض الوضع الفاتح/الداكن
try {
  const t = localStorage.getItem('theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch { /* التخزين غير متاح */ }
