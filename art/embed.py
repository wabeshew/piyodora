#!/usr/bin/env python3
"""art/*.png（codex で作った背景が透明な絵）の余白を切り抜いて WebP にし、
index.html の SPRITE_SRC（// SPRITES:BEGIN 〜 // SPRITES:END）に埋め込む。
使い方: python3 art/embed.py   （macOS の sips と cwebp を使う）
ファイル名（拡張子なし）がそのまま SPRITE_SRC のキーになる。"""
import base64, pathlib, re, struct, subprocess, tempfile, zlib

ART = pathlib.Path(__file__).parent
HTML = ART.parent / 'index.html'
WIDTH = 264  # ゲームではこの半分くらいの大きさで描くので、高解像度の画面でもくっきり見える


def decode_rgba(data):
    """8bit RGBA の PNG を読んで (幅, 高さ, 行のリスト) を返す"""
    pos, idat = 8, b''
    while pos < len(data):
        n, typ = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if typ == b'IHDR':
            w, h, depth, ct, _, _, interlace = struct.unpack('>IIBBBBB', body)
        elif typ == b'IDAT':
            idat += body
    assert depth == 8 and ct == 6 and not interlace, 'RGBA 8bit の PNG ではない'
    raw, stride, rows, prev, i = zlib.decompress(idat), w * 4, [], bytearray(w * 4), 0
    for _ in range(h):
        f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(line)
        prev = line
    return w, h, rows


def crop_box(png):
    """不透明な部分を囲む四角を、もとの画像のピクセルで返す（縮めた画像で調べるので少し余白をとる）"""
    with tempfile.TemporaryDirectory() as d:
        small = pathlib.Path(d) / 's.png'
        subprocess.run(['sips', '-s', 'format', 'png', '-Z', '256', str(png), '--out', str(small)], check=True, capture_output=True)
        w, h, rows = decode_rgba(small.read_bytes())
    pts = [(x, y) for y, row in enumerate(rows) for x in range(w) if row[x * 4 + 3] > 16]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    if len(pts) > w * h * 0.97:
        print(f'  ！ {png.name}: 背景が透明になっていないかも')
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(png)], check=True, capture_output=True, text=True).stdout
    W, H = map(int, re.findall(r'pixel\w+: (\d+)', out))
    sx, sy = W / w, H / h
    x0, y0 = max(0, int((min(xs) - 1) * sx)), max(0, int((min(ys) - 1) * sy))
    x1, y1 = min(W, int((max(xs) + 2) * sx)), min(H, int((max(ys) + 2) * sy))
    return x0, y0, x1 - x0, y1 - y0


def webp_uri(png):
    x, y, w, h = crop_box(png)
    with tempfile.TemporaryDirectory() as d:
        out = pathlib.Path(d) / 'o.webp'
        subprocess.run(['cwebp', '-quiet', '-q', '85', '-alpha_q', '90', '-crop', str(x), str(y), str(w), str(h),
                        '-resize', str(WIDTH), '0', str(png), '-o', str(out)], check=True)
        data = out.read_bytes()
    print(f'  {png.stem}: {w}x{h} → {len(data) // 1024}KB')
    return 'data:image/webp;base64,' + base64.b64encode(data).decode()


lines = [f"  {p.stem}: '{webp_uri(p)}'," for p in sorted(ART.glob('*.png'))]
html = HTML.read_text()
block = '// SPRITES:BEGIN（art/embed.py が書きかえる）\nconst SPRITE_SRC = {\n' + '\n'.join(lines) + '\n};\n// SPRITES:END'
html, n = re.subn(r'// SPRITES:BEGIN.*?// SPRITES:END', lambda _: block, html, flags=re.S)
assert n == 1, 'index.html に // SPRITES:BEGIN 〜 // SPRITES:END がない'
HTML.write_text(html)
print(f'{len(lines)} まい うめこみました')
