"""Сборка metrics.js — ширины символов Times New Roman 12 pt (16 px) для переноса строк.

Зачем: число строк в ячейке таблицы должно считаться по реальной ширине текста,
а не по «среднему символу» и не задаваться руками. Ширины снимаются с настоящего
файла шрифта, поэтому редактор (браузер) и проверка без браузера (Node) считают
одинаково.

Запуск:

    python tools\\make_metrics.py

Пишет metrics.js рядом с app.js. Формат: по каждому диапазону кодпоинтов —
строка из трёхзначных hex-чисел, ширина в 1/64 px (0x040 = 1 px).
"""

import io
import json
import os

from PIL import ImageFont

FONT = os.environ.get("DS_FONT", r"C:\Windows\Fonts\times.ttf")
SIZE = 16  # 12 pt при 96 dpi
SCALE = 64  # точность 1/64 px
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "metrics.js")

# Диапазоны, которые реально встречаются в листах: латиница, кириллица,
# пунктуация, типографика, единицы измерения и математические знаки.
RANGES = [
    (0x0020, 0x007E),  # ASCII
    (0x00A0, 0x00FF),  # NBSP, °, ±, ×, µ, ¼…
    (0x0400, 0x045F),  # кириллица
    (0x0490, 0x0491),  # Ґ ґ
    (0x2010, 0x2015),  # дефис, тире
    (0x2018, 0x201E),  # кавычки
    (0x2020, 0x2026),  # †, ‡, •, …, ‰
    (0x2030, 0x2030),
    (0x2032, 0x2033),  # ′ ″
    (0x2039, 0x203A),
    (0x2070, 0x2079),  # надстрочные
    (0x2080, 0x2089),  # подстрочные
    (0x20AC, 0x20AC),  # €
    (0x2116, 0x2116),  # №
    (0x2122, 0x2122),
    (0x2190, 0x2193),  # стрелки
    (0x2212, 0x2212),  # минус
    (0x2264, 0x2265),  # ≤ ≥
    (0x2260, 0x2260),
    (0x00D8, 0x00D8),
    (0x03A9, 0x03A9),  # Ω
    (0x03BC, 0x03BC),  # μ
]


def main() -> None:
    font = ImageFont.truetype(FONT, SIZE)
    default = round(font.getlength(" ") * SCALE)  # ширина для символов вне таблицы

    groups = []
    for start, end in RANGES:
        codes = []
        data = []
        for code in range(start, end + 1):
            ch = chr(code)
            try:
                w = font.getlength(ch)
            except Exception:  # noqa: BLE001 - символ без глифа
                w = font.getlength(" ")
            if w <= 0:
                w = font.getlength(" ")
            data.append("%03x" % max(1, min(0xFFF, round(w * SCALE))))
            codes.append(code)
        if codes:
            groups.append({"from": start, "to": end, "w": "".join(data)})

    payload = {
        "font": os.path.basename(FONT),
        "size": SIZE,
        "scale": SCALE,
        "space": default,
        "ranges": groups,
    }

    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    text = (
        "/* Data_Sheet_Editor — ширины символов Times New Roman 12 pt (16 px).\n"
        "   Файл собран автоматически: python tools\\make_metrics.py\n"
        "   Нужен, чтобы число строк в ячейке считалось по реальной ширине текста. */\n"
        "(function (root) {\n"
        '  "use strict";\n'
        "  const DATA = " + body + ";\n"
        "  const SCALE = DATA.scale;\n"
        "  const SPACE = DATA.space / SCALE;\n"
        "  const W = new Float32Array(0x3000).fill(-1);\n"
        "  DATA.ranges.forEach((r) => {\n"
        "    for (let code = r.from; code <= r.to; code += 1) {\n"
        "      const i = (code - r.from) * 3;\n"
        "      W[code] = parseInt(r.w.slice(i, i + 3), 16) / SCALE;\n"
        "    }\n"
        "  });\n"
        "\n"
        "  function charWidth(ch) {\n"
        "    const code = ch.codePointAt(0);\n"
        "    const w = code < W.length ? W[code] : -1;\n"
        "    return w > 0 ? w : SPACE;\n"
        "  }\n"
        "\n"
        "  /* Ширина строки в px. Табуляция и NBSP считаются как пробел. */\n"
        "  function measure(text) {\n"
        "    const value = String(text == null ? \"\" : text).replace(/[\\t\\u00a0]/g, \" \");\n"
        "    let total = 0;\n"
        "    for (const ch of value) total += charWidth(ch);\n"
        "    return total;\n"
        "  }\n"
        "\n"
        "  /* Перенос по словам, как в Excel: пробелы (в том числе красная строка из\n"
        "     восьми пробелов) занимают место в строке, пробел на месте переноса — нет,\n"
        "     слово длиннее строки рвётся по символам. Пустой абзац — одна строка.\n"
        "\n"
        "     Допуска нет (было 2 %): он разрешал строке быть шире ячейки, и Excel,\n"
        "     который меряет текст чуть иначе, переносил её позже — на листе строка\n"
        "     вылезала за границу и «не влезала». Теперь строка обязана влезть в ширину\n"
        "     ячейки, поэтому такие места получают лишнюю строку высоты. */\n"
        "  const TOLERANCE = 1;\n"
        "  function wrapLines(text, widthPx) {\n"
        "    const width = Math.max(8, Number(widthPx) || 8) * TOLERANCE;\n"
        "    const value = String(text == null ? \"\" : text).replace(/\\r/g, \"\");\n"
        "    let total = 0;\n"
        "    value.split(\"\\n\").forEach((paragraph) => {\n"
        "      let lines = 1;\n"
        "      let used = 0;    // занято на текущей строке\n"
        "      let spaces = 0;  // пробелы после последнего слова\n"
        "      let word = \"\";\n"
        "\n"
        "      /* Поставить слово: если не влезает — перенос перед ним, пробелы на\n"
        "         месте переноса не учитываются; слово шире строки рвётся по символам.\n"
        "         Если на строке пока ничего нет (первое слово и без отступа), строка\n"
        "         не тратится: слово начинает её и рвётся по символам. */\n"
        "      const put = (text) => {\n"
        "        let rest = text;\n"
        "        let w = measure(rest);\n"
        "        if (used + spaces + w <= width) {\n"
        "          used += spaces + w;\n"
        "          spaces = 0;\n"
        "          return;\n"
        "        }\n"
        "        if (used || spaces) lines += 1;\n"
        "        used = 0;\n"
        "        spaces = 0;\n"
        "        while (w > width) {\n"
        "          let cut = 0;\n"
        "          let acc = 0;\n"
        "          for (const ch of rest) {\n"
        "            const cw = charWidth(ch);\n"
        "            if (acc + cw > width) break;\n"
        "            acc += cw;\n"
        "            cut += ch.length;\n"
        "          }\n"
        "          if (!cut) break;\n"
        "          rest = rest.slice(cut);\n"
        "          w = measure(rest);\n"
        "          if (rest) { lines += 1; used = 0; }\n"
        "        }\n"
        "        used = w;\n"
        "      };\n"
        "\n"
        "      for (const ch of paragraph) {\n"
        "        if (ch === \" \" || ch === \"\\t\" || ch === \"\\u00a0\") {\n"
        "          if (word) { put(word); word = \"\"; }\n"
        "          spaces += SPACE;\n"
        "        } else {\n"
        "          word += ch;\n"
        "        }\n"
        "      }\n"
        "      if (word) put(word);\n"
        "      total += lines;\n"
        "    });\n"
        "    return Math.max(1, total);\n"
        "  }\n"
        "\n"
        "  root.DSFont = { measure, lines: wrapLines, space: SPACE };\n"
        "})(typeof window !== \"undefined\" ? window : globalThis);\n"
    )
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print("metrics.js:", len(text), "байт,", sum(g["to"] - g["from"] + 1 for g in groups), "символов")


if __name__ == "__main__":
    main()
