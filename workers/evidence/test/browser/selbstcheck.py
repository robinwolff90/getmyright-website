import sys
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8080'
fails = 0
def ok(c, t):
    global fails
    print(('OK   ' if c else 'FAIL ') + t)
    if not c: fails += 1
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, opts in [('handy', p.devices['iPhone 13']), ('desktop', {'viewport': {'width': 1280, 'height': 900}})]:
        ctx = b.new_context(**opts); pg = ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        for seite in ['/spieler/index.html', '/spieler/fall.html', '/spieler/selbstcheck.html']:
            pg.goto(BASE + seite)
            box = pg.locator('.hilfe-box')
            ok(box.is_visible(), f'[{name}] Hilfe-Box sichtbar auf {seite}')
            ok(box.locator('a[href="tel:+498001372700"]').inner_text() == '0800 1 37 27 00', f'[{name}] Hotline als tel:-Link')
            ok(box.locator('a[href="https://www.check-dein-spiel.de/"]').count() == 1 and 'BIÖG' in box.inner_text(), f'[{name}] Link check-dein-spiel.de (BIÖG)')
            ok('Brauchst du Hilfe beim Aufhören?' in box.inner_text() and 'findest du' in box.inner_text() and ' Sie ' not in box.inner_text(), f'[{name}] Box in Du-Form')
            top = box.bounding_box()['y']
            ok(top < (2200 if name == 'handy' else 1400), f'[{name}] Box weit oben ({int(top)} px)')
            ok(pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), f'[{name}] kein seitliches Scrollen auf {seite}')
        pg.goto(BASE + '/spieler/index.html')
        link = pg.locator('a[href="selbstcheck.html"]').first
        ok(link.is_visible() and 'Selbstcheck' in link.inner_text() and link.bounding_box()['y'] < 900, f'[{name}] Selbstcheck-Button oben auf der Startseite sichtbar')
        link.click(); pg.wait_for_url('**/spieler/selbstcheck.html')
        pg.click('[data-sc-auswerten]')
        ok('Frage 1' in pg.inner_text('[data-sc-fehler]'), f'[{name}] Pflichtfragen geprüft')
        pg.check('input[name=lizenz][value=nein]'); pg.fill('#sc-anbieter', 'Beispiel-Casino')
        pg.select_option('#sc-von', '2018'); pg.select_option('#sc-bis', '2021')
        pg.check('input[name=verlust][value="25000-50000"]'); pg.check('input[name=oasis][value=ja]')
        pg.click('[data-sc-auswerten]')
        erg = pg.inner_text('[data-sc-ergebnis]')
        ok('Eine Prüfung kann sich lohnen' in erg and 'OASIS' in erg and 'keine Zusage' in erg, f'[{name}] Ergebnis mit neutralem Hinweis')
        ok('garant' not in erg.lower() and 'sicher zurück' not in erg.lower(), f'[{name}] keine Rechtsversprechen')
        pg.screenshot(path=f'sc-ergebnis-{name}.png', full_page=True)
        pg.click('[data-sc-weiter]'); pg.wait_for_url('**/spieler/fall.html')
        pg.wait_for_selector('[data-schritt="1"]:not([hidden])')
        vals = [pg.input_value(s) for s in ['#f-anbieter', '#f-von', '#f-bis', '#f-verlust']]
        ok(vals == ['Beispiel-Casino', '2018', '2021', '25000-50000'], f'[{name}] Fall vorbelegt: {vals}')
        pg.screenshot(path=f'sc-fall-vorbelegt-{name}.png', full_page=True)
        pg.reload(); pg.wait_for_selector('[data-schritt="1"]:not([hidden])')
        ok(pg.input_value('#f-anbieter') == '', f'[{name}] Vorbelegung nur einmalig')
        ok(not errs, f'[{name}] keine JS-/CSP-Fehler {errs[:2]}')
        ctx.close()
    b.close()
print('FEHLER:', fails); sys.exit(1 if fails else 0)
