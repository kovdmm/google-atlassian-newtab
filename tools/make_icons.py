"""Generates the extension icons (Chrome-style logo) as PNG without third-party libraries."""
import math
import os
import struct
import zlib

RED, YELLOW, GREEN = (234, 67, 53), (251, 188, 4), (52, 168, 83)
BLUE, WHITE = (66, 133, 244), (255, 255, 255)
SS = 4  # supersampling per axis


def color_at(x, y):
    r = math.hypot(x, y)
    if r > 1:
        return None
    if r < 0.36:
        return BLUE
    if r < 0.46:
        return WHITE
    a = math.degrees(math.atan2(y, x)) % 360
    if 30 <= a < 150:
        return RED
    if 150 <= a < 270:
        return GREEN
    return YELLOW


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc, hits = [0, 0, 0], 0
            for sy in range(SS):
                for sx in range(SS):
                    x = ((px + (sx + 0.5) / SS) / size) * 2 - 1
                    y = 1 - ((py + (sy + 0.5) / SS) / size) * 2
                    c = color_at(x * 1.04, y * 1.04)
                    if c:
                        hits += 1
                        for i in range(3):
                            acc[i] += c[i]
            if hits:
                row += bytes([acc[0] // hits, acc[1] // hits, acc[2] // hits, 255 * hits // (SS * SS)])
            else:
                row += bytes(4)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
os.makedirs(out, exist_ok=True)
for s in (16, 32, 48, 128):
    with open(os.path.join(out, f"icon{s}.png"), "wb") as f:
        f.write(render(s))
