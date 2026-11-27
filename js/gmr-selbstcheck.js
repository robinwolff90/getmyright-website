/* GetMyRight – Selbstcheck „Kann ich mein Geld zurückholen?“
 * Läuft komplett im Browser, überträgt nichts. Das Ergebnis führt zu /spieler/fall.html und belegt dort
 * passende Antworten vor (sessionStorage statt URL-Parameter: nichts landet in Adresszeile oder Logs). */
(function () {
  'use strict';
  var d = document;
  var box = d.querySelector('[data-sc-fragen]');
  if (!box) return;
  function $(s) { return d.querySelector(s); }
  function wert(name) { var el = d.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; }
  var fehlerBox = $('[data-sc-fehler]');
  function fehler(t) { fehlerBox.textContent = t || ''; fehlerBox.hidden = !t; if (t) fehlerBox.scrollIntoView({ block: 'nearest' }); }

  var jahr = new Date().getFullYear();
  Array.prototype.forEach.call(d.querySelectorAll('[data-jahre]'), function (sel) {
    sel.innerHTML = '<option value="">Bitte wählen</option>';
    for (var y = jahr; y >= 2000; y--) sel.insertAdjacentHTML('beforeend', '<option value="' + y + '">' + y + '</option>');
  });

  function li(t) { var e = d.createElement('li'); e.textContent = t; return e; }
  $('[data-sc-auswerten]').addEventListener('click', function () {
    var a = { lizenz: wert('lizenz'), von: Number($('#sc-von').value), bis: Number($('#sc-bis').value), verlust: wert('verlust'), oasis: wert('oasis'), anbieter: $('#sc-anbieter').value.trim().slice(0, 80) };
    if (!a.lizenz) return fehler('Bitte beantworten Sie Frage 1.');
    if (!a.von || !a.bis || a.von > a.bis) return fehler('Bitte wählen Sie bei Frage 2 einen gültigen Zeitraum.');
    if (!a.verlust) return fehler('Bitte beantworten Sie Frage 3.');
    if (!a.oasis) return fehler('Bitte beantworten Sie Frage 4.');
    fehler('');
    var punkte = $('[data-sc-punkte]');
    punkte.innerHTML = '';
    $('[data-sc-titel]').textContent = a.lizenz === 'ja' ? 'Eine Prüfung ist trotzdem möglich' : 'Eine Prüfung kann sich lohnen';
    if (a.lizenz === 'nein') punkte.appendChild(li('Sie haben bei einem Anbieter ohne deutsche Erlaubnis gespielt. Fälle dieser Art prüfen unsere Partnerkanzleien.'));
    else if (a.lizenz === 'unbekannt') punkte.appendChild(li('Ob der Anbieter damals eine deutsche Erlaubnis hatte, klärt die Kanzlei. Die amtliche Liste erlaubter Anbieter führt die Gemeinsame Glücksspielbehörde der Länder (GGL).'));
    else punkte.appendChild(li('Bei Anbietern mit deutscher Erlaubnis ist eine Rückforderung meist schwieriger. Ob in Ihrem Fall trotzdem etwas möglich ist, kann nur eine Kanzlei beurteilen.'));
    punkte.appendChild(li('Ansprüche können verjähren. Eine frühe Prüfung ist deshalb sinnvoll – besonders bei Verlusten, die schon einige Jahre zurückliegen.'));
    if (a.verlust === 'unbekannt') punkte.appendChild(li('Die genaue Summe müssen Sie nicht kennen. Sie ergibt sich später aus Ihren Kontoauszügen.'));
    if (a.oasis === 'ja') punkte.appendChild(li('Eine OASIS-Sperre kann für die Prüfung wichtig sein. Halten Sie die OASIS-Auskunft bereit – Sie können sie im Fall hochladen.'));
    else if (a.oasis === 'unbekannt') punkte.appendChild(li('Ob Sie gesperrt waren, können Sie mit einer kostenlosen OASIS-Selbstauskunft herausfinden.'));
    try {
      sessionStorage.setItem('gmr_fall_prefill', JSON.stringify({ anbieter: a.anbieter, von: a.von, bis: a.bis, verlust: a.verlust }));
    } catch (e) { /* ohne sessionStorage: Fall-Formular startet einfach leer */ }
    box.hidden = true;
    var erg = $('[data-sc-ergebnis]');
    erg.hidden = false; erg.focus();
    erg.scrollIntoView({ block: 'start' });
  });
  $('[data-sc-aendern]').addEventListener('click', function () {
    $('[data-sc-ergebnis]').hidden = true; box.hidden = false; box.querySelector('input').focus();
  });
})();
