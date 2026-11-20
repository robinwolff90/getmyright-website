/* Weiterleitung alter Adressen auf die neue Seitenstruktur */
(function () {
  var s = document.currentScript, t = s && s.getAttribute('data-target');
  if (t && t.charAt(0) === '/') location.replace(t + location.hash);
})();
