import re, time, hmac, hashlib, struct, base64, sys
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8080'
codes = []
def on_console(msg):
    m = re.search(r'\[lokal\] Code: (\d{6})', msg.text)
    if m: codes.append(m.group(1))
    if msg.type == 'error': print('CONSOLE-ERROR:', msg.text)
def totp(secret, offset=0):
    key = base64.b32decode(secret.replace(' ', '') + '=' * (-len(secret.replace(' ', '')) % 8))
    ctr = int(time.time() // 30) + offset
    h = hmac.new(key, struct.pack('>Q', ctr), hashlib.sha1).digest()
    o = h[19] & 15
    return '%06d' % ((struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000)
def warte(page, js, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if page.evaluate(js): return True
        except Exception: pass
        time.sleep(0.2)
    raise AssertionError('Timeout: ' + js)
def ok(cond, text):
    print(('OK   ' if cond else 'FAIL ') + text)
    if not cond: ok.fails += 1
ok.fails = 0

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- Spieler am Handy ----------
    ctx = b.new_context(**p.devices['iPhone 13'])
    pg = ctx.new_page(); pg.on('console', on_console)
    pg.goto(BASE + '/spieler/fall.html')
    ok(pg.is_visible('[data-schritt="1"]'), 'Schritt 1 (5 Fragen) sichtbar, kein Registrierungsformular')
    pg.click('[data-weiter="1"]')
    ok('Anbieter' in pg.inner_text('[data-fall-fehler]'), 'Pflichtfelder werden geprüft')
    pg.fill('#f-anbieter', 'Beispiel-Casino'); pg.select_option('#f-spielart', 'online-casino')
    pg.select_option('#f-von', '2019'); pg.select_option('#f-bis', '2022'); pg.select_option('#f-verlust', '10000-25000'); pg.select_option('#f-land', 'NW')
    pg.click('[data-weiter="1"]')
    ok(pg.is_visible('[data-schritt="2"]'), 'Schritt 2 Einwilligung')
    pg.screenshot(path='01-einwilligung.png', full_page=True)
    pg.click('[data-weiter="2"]')
    ok('Einwilligung' in pg.inner_text('[data-fall-fehler]'), 'ohne Einwilligung kein Fall')
    pg.check('#f-einwilligung'); pg.click('[data-weiter="2"]')
    pg.wait_for_selector('[data-schritt="3"]:not([hidden])')
    ok(pg.inner_text('[data-checkliste] [data-item="kontoauszug"] .badge') == 'fehlt', 'Checkliste: Kontoauszug fehlt')
    pg.set_input_files('#d-kontoauszug-wahl', ['auszug-maerz.pdf'])
    warte(pg, "() => document.querySelector('[data-checkliste] [data-item=kontoauszug] .badge').textContent.includes('hochgeladen')")
    ok(True, 'PDF hochgeladen, Status ✓ hochgeladen')
    pg.set_input_files('#d-spielverlauf-wahl', ['gross-foto.png'])
    warte(pg, "() => document.querySelector('[data-checkliste] [data-item=spielverlauf] .badge').textContent.includes('hochgeladen')", 60)
    pg.wait_for_selector('[data-checkliste] [data-fortschritt=spielverlauf] p')
    hinweis = pg.inner_text('[data-checkliste] [data-fortschritt=spielverlauf]')
    ok('verkleinert' in hinweis, '14-MB-Foto automatisch verkleinert: ' + hinweis.strip())
    datei = pg.inner_text('[data-checkliste] [data-item=spielverlauf] .beleg-dateien')
    ok('gross-foto.jpg' in datei and 'umgewandelt' in datei, 'als JPEG gespeichert: ' + datei.strip().splitlines()[0])
    pg.set_input_files('#d-oasis-wahl', ['IMG_1234.HEIC'])
    pg.wait_for_selector('[data-checkliste] [data-fortschritt=oasis] p')
    t = pg.inner_text('[data-checkliste] [data-fortschritt=oasis]')
    ok('Safari' in t, 'HEIC in Chromium: verständlicher Hinweis statt Absturz: ' + t.strip()[:90])
    pg.set_input_files('#d-sonstiges-wahl', ['trojaner.pdf'])
    pg.wait_for_selector('[data-checkliste] [data-fortschritt=sonstiges] p')
    ok('Dateityp' in pg.inner_text('[data-checkliste] [data-fortschritt=sonstiges]'), 'getarnte .exe als .pdf abgewiesen')
    pg.check('[data-checkliste] [data-angefordert=oasis]')
    warte(pg, "() => document.querySelector('[data-checkliste] [data-item=oasis] .badge').textContent.includes('angefordert')")
    ok(True, 'OASIS als „angefordert“ markiert')
    pg.screenshot(path='02-checkliste-handy.png', full_page=True)
    pg.click('[data-weiter="3"]')
    pg.fill('#f-email', 'spieler@example.de'); pg.click('[data-code-senden]')
    pg.wait_for_selector('[data-code-schritt]:not([hidden])')
    time.sleep(0.5)
    ok(len(codes) == 1, 'Bestätigungscode verschickt (lokal protokolliert)')
    pg.fill('#f-code', codes[-1]); pg.click('[data-code-pruefen]')
    pg.wait_for_selector('[data-schritt="5"]:not([hidden])')
    ok('eingereicht' in pg.inner_text('[data-status-text]'), 'Status: Fall eingereicht')
    pg.screenshot(path='03-status-handy.png', full_page=True)

    # ---------- Kanzlei am Desktop ----------
    kctx = b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    kp = kctx.new_page(); kp.on('console', on_console)
    kp.on('dialog', lambda dlg: dlg.accept())
    kp.goto(BASE + '/kanzlei/faelle.html')
    kp.fill('#kf-email', 'alpha@example.de'); kp.click('[data-kf-senden]')
    kp.wait_for_selector('[data-kf-schritt="code"]:not([hidden])'); time.sleep(0.5)
    kp.fill('#kf-code', codes[-1]); kp.click('[data-kf-code]')
    kp.wait_for_selector('[data-kf-einrichten]:not([hidden])')
    ok(kp.eval_on_selector('[data-kf-qr] img', 'i => i.naturalWidth > 0'), 'TOTP-Einrichtung mit QR-Code (Pflicht)')
    kp.screenshot(path='04-kanzlei-totp.png', full_page=True)
    secret = kp.inner_text('[data-kf-secret]')
    kp.fill('#kf-totp', totp(secret)); kp.check('#kf-merken'); kp.click('[data-kf-totp]')
    kp.wait_for_selector('[data-kf-app]:not([hidden])')
    ok(kp.evaluate("!!localStorage.getItem('gmr-kanzlei-geraet')"), '„Gerät 30 Tage merken“ gespeichert')
    offen = kp.inner_text('[data-kf-offen]')
    ok('Beispiel-Casino' in offen and 'spieler@example.de' not in kp.content(), 'offener Fall sichtbar, ohne E-Mail des Spielers')
    kp.screenshot(path='05-kanzlei-liste.png', full_page=True)
    kp.click('[data-kf-uebernehmen]')
    kp.wait_for_selector('[data-kf-detail]:not([hidden]) .beleg-karte')
    warte(kp, "() => [...document.querySelectorAll('[data-kf-vorschau]')].every(i => i.complete && i.naturalWidth > 0)", 20)
    ok(True, 'Bildvorschau über kurzlebigen Link geladen (entschlüsselt)')
    names = kp.inner_text('[data-kf-detail]')
    ok(re.search(r'[0-9a-f]{8}_Kontoauszug_\d{4}-\d\d-\d\d_1\.pdf', names) is not None, 'einheitliche Dateinamen')
    kp.screenshot(path='06-kanzlei-fall.png', full_page=True)
    with kp.expect_download() as dl:
        kp.click('[data-kf-download]')
    path = dl.value.path()
    ok(open(path, 'rb').read() == open('auszug-maerz.pdf', 'rb').read(), 'Download: PDF bytegenau identisch')
    # Gerät merken: neuer Login ohne TOTP
    kp.click('[data-kf-abmelden]'); kp.wait_for_selector('[data-kf-login]:not([hidden])')
    kp.fill('#kf-email', 'alpha@example.de'); kp.click('[data-kf-senden]')
    kp.wait_for_selector('[data-kf-schritt="code"]:not([hidden])'); time.sleep(0.5)
    kp.fill('#kf-code', codes[-1]); kp.click('[data-kf-code]')
    kp.wait_for_selector('[data-kf-app]:not([hidden])')
    ok(True, 'zweiter Login auf gemerktem Gerät ohne TOTP')
    # Spieler sieht Übernahme
    pg.reload(); pg.wait_for_selector('[data-schritt="5"]:not([hidden])')
    ok('Kanzlei Alpha hat Ihren Fall übernommen' in pg.inner_text('[data-status-text]'), 'Spieler sieht: Kanzlei hat übernommen')
    pg.screenshot(path='07-spieler-uebernommen.png', full_page=True)
    b.close()
print('FEHLER:', ok.fails)
sys.exit(1 if ok.fails else 0)
