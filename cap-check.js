// cap-check.js — BUILD 03
// Charter Member cap check. Loaded by index.html with defer.
// If cap reached, hides waitlist forms and shows closed message.
(function () {
  fetch('/api/check-capacity')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || data.open !== false) return;
      var forms = document.querySelectorAll('.form-wrap');
      var msg   = '<div style="background:rgba(159,143,239,.08);border:1px solid rgba(159,143,239,.25);border-radius:14px;padding:20px 24px;text-align:center;font-family:var(--mono,monospace);font-size:0.78rem;color:#9F8FEF;margin-top:8px;line-height:1.7;">Charter Membership is now closed.<br>Join the waitlist for the next opening.</div>';
      forms.forEach(function (f) {
        f.style.display = 'none';
        var el = document.createElement('div');
        el.innerHTML = msg;
        f.parentNode.insertBefore(el, f);
      });
    })
    .catch(function () { /* silently fail — default open */ });
})();
