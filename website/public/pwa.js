/* guIDE / graysoft.dev PWA — SW registration + install banner (bottom) */
(function () {
  if (typeof window === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator.standalone) return;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }

  var _evt = null;
  var _dismissed = false;
  try { _dismissed = localStorage.getItem('pwa-banner-dismissed') === '1'; } catch (e) {}

  function showBanner() {
    if (_dismissed) return;
    var b = document.getElementById('__pwa_banner');
    if (b) b.style.display = 'flex';
  }

  window.addEventListener('load', function () {
    if (_dismissed) return;
    var b = document.createElement('div');
    b.id = '__pwa_banner';
    b.style.cssText = [
      'display:none',
      'position:fixed',
      'bottom:0',
      'left:0',
      'right:0',
      'z-index:9999',
      'background:linear-gradient(135deg,#0a0a0a 0%,#0d1f0d 100%)',
      'color:#fff',
      'padding:12px 16px',
      'align-items:center',
      'gap:12px',
      'box-shadow:0 -2px 20px rgba(0,0,0,0.6)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:14px',
      'animation:__pwa_slide 0.3s ease',
      'border-top:1px solid rgba(34,197,94,0.2)',
    ].join(';');
    b.innerHTML =
      '<style>@keyframes __pwa_slide{from{transform:translateY(100%)}to{transform:translateY(0)}}</style>' +
      '<div style="flex:1;min-width:0">' +
        '<strong>Install guIDE</strong><br>' +
        '<span style="opacity:0.7;font-size:12px">Add the native LLM IDE site to your home screen</span>' +
      '</div>' +
      '<button id="__pwa_install_btn" style="background:#22c55e;color:#000;border:none;border-radius:8px;' +
        'padding:8px 16px;cursor:pointer;font-weight:700;white-space:nowrap;font-size:13px">Install</button>' +
      '<button id="__pwa_dismiss_btn" style="background:none;border:none;color:rgba(255,255,255,0.4);' +
        'cursor:pointer;font-size:22px;padding:0 4px;line-height:1">\u00d7</button>';
    document.body.appendChild(b);

    document.getElementById('__pwa_install_btn').addEventListener('click', function () {
      if (_evt) {
        _evt.prompt();
        _evt.userChoice.then(function (r) {
          if (r.outcome === 'accepted') document.getElementById('__pwa_banner').style.display = 'none';
        });
      }
    });
    document.getElementById('__pwa_dismiss_btn').addEventListener('click', function () {
      document.getElementById('__pwa_banner').style.display = 'none';
      _dismissed = true;
      try { localStorage.setItem('pwa-banner-dismissed', '1'); } catch (e) {}
    });
    if (_evt) showBanner();
  });

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    _evt = e;
    showBanner();
  });

  window.addEventListener('appinstalled', function () {
    var b = document.getElementById('__pwa_banner');
    if (b) b.style.display = 'none';
    _dismissed = true;
    try { localStorage.setItem('pwa-banner-dismissed', '1'); } catch (e) {}
  });
})();
