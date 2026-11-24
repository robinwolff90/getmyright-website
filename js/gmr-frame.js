/* GetMyRight – Clickjacking-Schutz (Frame-Buster). GitHub Pages kann keine X-Frame-Options/frame-ancestors-Header setzen;
 * deshalb wird die Seite ausgeblendet, sobald sie in einem fremden Rahmen (iframe) geladen wird, und – wenn möglich – als Hauptfenster geöffnet. */
(function () {
  'use strict';
  if (window.self === window.top) return;
  var de = document.documentElement;
  de.style.setProperty('display', 'none', 'important');
  try { window.top.location.replace(window.self.location.href); } catch (e) { /* Sandbox/fremder Ursprung: Seite bleibt ausgeblendet */ }
})();
