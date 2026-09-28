"""生成主屏幕图标 icon.png（180x180，纯 Python，无依赖）。用法：python3 scripts/make-icon.py icon.png"""
import base64, math, struct, sys, zlib

S, SS = 180, 3  # 尺寸、超采样倍数

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)

def in_tri(px, py, a, b, c):
    def side(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    d1, d2, d3 = side((px, py), a, b), side((px, py), b, c), side((px, py), c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))

TOP, BOTTOM, WHITE = (255, 94, 98), (255, 36, 66), (255, 255, 255)
cx = cy = S / 2
rows = []
for y in range(S):
    row = bytearray([0])
    for x in range(S):
        acc = [0, 0, 0]
        for sy in range(SS):
            for sx in range(SS):
                px, py = x + (sx + .5) / SS, y + (sy + .5) / SS
                c = lerp(TOP, BOTTOM, py / S)
                d = math.hypot(px - cx, py - cy)
                ring = abs(d - 52) < 9
                # 逆时针小箭头缺口：左上角一段不画圆环
                ang = math.degrees(math.atan2(py - cy, px - cx))
                if ring and -160 < ang < -115:
                    ring = False
                arrow = in_tri(px, py, (24, 64), (58, 79), (34, 92))
                hands = seg_dist(px, py, cx, cy, cx, cy - 30) < 7 or seg_dist(px, py, cx, cy, cx + 24, cy + 14) < 7
                if ring or arrow or hands:
                    c = WHITE
                for i in range(3):
                    acc[i] += c[i]
        row += bytes(round(v / SS / SS) for v in acc)
    rows.append(bytes(row))

def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 2, 0, 0, 0)) \
    + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')
if len(sys.argv) > 1:
    open(sys.argv[1], 'wb').write(png)
print(base64.b64encode(png).decode())
