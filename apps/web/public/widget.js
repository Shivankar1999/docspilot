/*
 * DocsPilot chat widget loader.
 *   <script src="https://YOUR-DOCSPILOT/widget.js" data-key="pk_..." defer></script>
 *
 * Adds a floating chat button. The chat itself runs in an iframe served by
 * DocsPilot, so the host page's CSS and JavaScript can't interfere with it (or
 * read it). The iframe is created on first click: pages pay nothing until used.
 * Plain ES5-style JavaScript with no dependencies, so it runs on any site.
 */
(function () {
  var script = document.currentScript;
  var key = script && script.getAttribute('data-key');
  if (!key) {
    console.error('[DocsPilot] Add data-key="pk_..." to the widget script tag.');
    return;
  }
  var docsPilotOrigin = new URL(script.src).origin;
  var open = false;
  var frame = null;

  var CHAT_ICON =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var CLOSE_ICON =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', 'Open support chat');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = CHAT_ICON;
  setStyles(button, {
    position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483000',
    width: '56px', height: '56px', borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: '#4f46e5', boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  button.addEventListener('click', toggle);
  document.body.appendChild(button);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && open) toggle();
  });

  function toggle() {
    if (!frame) frame = createFrame();
    open = !open;
    frame.style.display = open ? 'block' : 'none';
    button.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close support chat' : 'Open support chat');
  }

  function createFrame() {
    var iframe = document.createElement('iframe');
    // The page's own origin is a hint only; the server checks the origin the
    // browser reports to the iframe, and the browser enforces CSP frame-ancestors.
    iframe.src =
      docsPilotOrigin + '/widget?key=' + encodeURIComponent(key) + '&origin=' + encodeURIComponent(location.origin);
    iframe.title = 'Support chat';
    setStyles(iframe, {
      position: 'fixed', right: '20px', bottom: '88px', zIndex: '2147483000',
      width: '380px', height: '560px', maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 108px)',
      border: 'none', borderRadius: '16px', background: '#fff',
      boxShadow: '0 12px 40px rgba(0,0,0,0.2)', display: 'none',
    });
    document.body.appendChild(iframe);
    return iframe;
  }

  function setStyles(element, styles) {
    for (var name in styles) element.style[name] = styles[name];
  }
})();
