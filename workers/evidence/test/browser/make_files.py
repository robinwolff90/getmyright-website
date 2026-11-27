import zlib, struct, os
def png(path, w, h):
    raw = bytearray()
    rnd = os.urandom(w*3*h)
    for y in range(h):
        raw.append(0); raw += rnd[y*w*3:(y+1)*w*3]
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 1)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)
png('gross-foto.png', 2600, 1800)   # Rauschen, ~14 MB -> muss verkleinert werden
png('screenshot.png', 400, 300)
open('auszug-maerz.pdf','wb').write(b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
open('IMG_1234.HEIC','wb').write(b'\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic' + os.urandom(2000))
open('trojaner.pdf','wb').write(b'MZ\x90\x00' + os.urandom(100))
for f in os.listdir('.'): print(f, os.path.getsize(f))
