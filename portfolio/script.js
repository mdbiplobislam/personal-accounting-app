(function () {
  var toggle = document.querySelector('.nav__toggle');
  var menu = document.getElementById('menu');
  toggle.addEventListener('click', function () {
    var open = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
  menu.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.getElementById('year').textContent = new Date().getFullYear();

  // Scroll reveal, skill bars, counters
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.card,.project,.quote,.plan,.about__card,.head').forEach(function (el) {
    el.classList.add('reveal');
  });
  function count(el) {
    var target = +el.dataset.count;
    if (reduce) { el.textContent = target; return; }
    var start = null;
    (function step(t) {
      start = start || t;
      var p = Math.min((t - start) / 1200, 1);
      el.textContent = Math.round(target * p);
      if (p < 1) requestAnimationFrame(step);
    })(performance.now());
  }
  var io = 'IntersectionObserver' in window && new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      if (en.target.dataset.count) count(en.target);
      io.unobserve(en.target);
    });
  }, { threshold: 0.15 });
  var targets = document.querySelectorAll('.reveal,.bar,[data-count]');
  if (io) targets.forEach(function (el) { io.observe(el); });
  else targets.forEach(function (el) { el.classList.add('in'); if (el.dataset.count) el.textContent = el.dataset.count; });

  // Contact form: validates, then opens the visitor's email client.
  var form = document.getElementById('contact-form');
  var status = form.querySelector('.form__status');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form.elements, ok = true;
    ['name', 'email', 'message'].forEach(function (n) {
      var bad = !f[n].value.trim() || (n === 'email' && !f[n].validity.valid && !/^\S+@\S+\.\S+$/.test(f[n].value));
      f[n].setAttribute('aria-invalid', bad);
      if (bad) ok = false;
    });
    status.className = 'form__status';
    if (!ok) { status.textContent = 'Please fill in all fields with a valid email.'; status.classList.add('err'); return; }
    var body = 'Name: ' + f.name.value + '\nEmail: ' + f.email.value + '\n\n' + f.message.value;
    window.location.href = 'mailto:biplobislam38@gmail.com?subject=' +
      encodeURIComponent('Portfolio inquiry from ' + f.name.value) + '&body=' + encodeURIComponent(body);
    status.textContent = 'Opening your email app… thank you!';
    status.classList.add('ok');
    form.reset();
  });
})();
