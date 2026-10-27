// إذا انتهت الجلسة (401) يُحوَّل المستخدم تلقائياً لصفحة الدخول مع العودة لنفس الصفحة بعدها
(function () {
  var f = window.fetch;
  window.fetch = function () {
    var a = arguments;
    return f.apply(this, a).then(function (r) {
      var u = String(a[0] && a[0].url ? a[0].url : a[0]);
      if (r.status === 401 && u.indexOf('/report-builder/api/') === 0 && u.indexOf('/report-builder/api/login') !== 0 && u.indexOf('/report-builder/api/auth-info') !== 0) location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search);
      return r;
    });
  };
})();
