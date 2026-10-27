// ذاكرة مؤقتة لمركز المؤشرات في المتصفح (لتصيير الرسوم المرتبطة بمؤشر مركزي)
let list = [], map = {};
export const getIndicators = () => list;
export const getIndicatorMap = () => map;
export async function loadIndicators() {
  try { const r = await fetch('/report-builder/api/indicators'); list = r.ok ? await r.json() : []; } catch (e) { list = []; }
  map = Object.fromEntries(list.map((x) => [x.id, { name: x.name, series: x.series, unit: x.unit, source: x.source, asOf: x.asOf }]));
  return list;
}
