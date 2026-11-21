'use strict';
module.exports = {
  membership_status: { active: 'سارية', near_expiry: 'قريبة الانتهاء', expired: 'منتهية', suspended: 'معلقة', cancelled: 'ملغاة', pending: 'لم تُفعَّل بعد' },
  payment_status: { paid: 'مسدد بالكامل', partial: 'مسدد جزئيًا', unpaid: 'غير مسدد', overdue: 'متأخر عن السداد', not_yet_due: 'غير مستحق بعد', exempt: 'معفى من الرسوم' },
  payment_method: { cash: 'نقدًا', bank_transfer: 'حوالة بنكية', card: 'شبكة / بطاقة', cheque: 'شيك', other: 'أخرى', opening_balance: 'رصيد افتتاحي' },
  period_kind: { initial: 'اشتراك أولي', renewal: 'تجديد' },
};
