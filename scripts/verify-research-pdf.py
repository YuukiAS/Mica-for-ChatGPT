import json
import re
import sys
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: verify-research-pdf.py INPUT.pdf OUTPUT.json")
    source = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    reader = PdfReader(source)
    extracted = []
    font_names = set()
    image_count = 0
    for page in reader.pages:
        extracted.append(page.extract_text() or "")
        resources = page.get("/Resources") or {}
        fonts = resources.get("/Font") or {}
        font_names.update(str(name) for name in fonts.keys())
        xobjects = resources.get("/XObject") or {}
        for reference in xobjects.values():
            obj = reference.get_object()
            if obj.get("/Subtype") == "/Image":
                image_count += 1

    text = "\n".join(extracted)
    normalized = re.sub(r"\s+", " ", text)
    edge_violations = []
    highlight_rects = []
    word_count = 0
    with pdfplumber.open(source) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            words = page.extract_words()
            word_count += len(words)
            for word in words:
                if word["x0"] < -0.5 or word["x1"] > page.width + 0.5 or word["top"] < -0.5 or word["bottom"] > page.height + 0.5:
                    edge_violations.append({"page": page_index, "text": word["text"]})
            for rect in page.rects:
                color = rect.get("non_stroking_color")
                if isinstance(color, (tuple, list)) and len(color) >= 3:
                    red, green, blue = color[:3]
                    if red >= 0.85 and green >= 0.75 and blue <= 0.8:
                        highlight_rects.append({"page": page_index, "x0": round(rect["x0"], 2), "top": round(rect["top"], 2), "width": round(rect["width"], 2), "height": round(rect["height"], 2), "color": [round(float(red), 3), round(float(green), 3), round(float(blue), 3)]})

    checks = {
        "page_count_at_least_2": len(reader.pages) >= 2,
        "searchable_title": "Extension answer" in text,
        "searchable_long_text": "Long-form research paragraph 34" in text,
        "searchable_code": "return" in text and "searchable" in text,
        "searchable_table": "Accuracy" in text and "Latency" in text,
        "math_copy_signal_inline": "E=mc" in normalized,
        "math_copy_signal_display": any(token in normalized for token in ["1 3", "1/3", "∫", "dx"]),
        "highlighted_text_present": "evidence with context" in normalized,
        "highlight_background_present": len(highlight_rects) >= 1,
        "font_resources_present": len(font_names) >= 1,
        "math_not_rasterized": image_count == 0,
        "page_boundaries_clean": not edge_violations,
        "word_count_substantial": word_count >= 500,
    }
    report = {
        "schemaVersion": 1,
        "source": str(source),
        "pages": len(reader.pages),
        "wordCount": word_count,
        "textLength": len(text),
        "fontResources": sorted(font_names),
        "imageXObjects": image_count,
        "highlightRects": highlight_rects,
        "edgeViolations": edge_violations,
        "checks": checks,
        "passed": all(checks.values()),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
