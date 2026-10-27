// أدوات نصوص مشتركة
const HONORIFICS = /(^|\s)(معالي|سعادة|الدكتور|الدكتورة|دكتور|الأستاذ|الاستاذ|الأستاذة|المهندس|المهندسة|م\.|د\.|أ\.|المحاسب|الشيخ)(?=\s|$)/g;

/** تطبيع الاسم العربي للمطابقة: يتجاهل التشكيل والهمزات والألقاب والمسافات */
export function normalizeName(s) {
  return String(s || '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(HONORIFICS, ' ')
    .replace(/[.\-_,،]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
