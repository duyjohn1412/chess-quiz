import argparse
import json
import re
from pathlib import Path
import pymupdf


def find_question_anchors(doc: pymupdf.Document) -> list[dict]:
    anchors = []
    for page_idx, page in enumerate(doc):
        blocks = page.get_text("blocks")
        for b in sorted(blocks, key=lambda x: (round(x[1], 1), round(x[0], 1))):
            txt = b[4].strip()
            m = re.match(r"Câu\s+(\d+)\b", txt)
            if m:
                base_y0 = float(b[1])
                row_top = base_y0
                for ob in blocks:
                    # Include tall braces/fractions sitting on the exact same question row
                    if ob[1] < base_y0 and ob[3] >= base_y0 + 6 and (base_y0 - ob[1]) < 38:
                        row_top = min(row_top, float(ob[1]))
                anchors.append({
                    "num": int(m.group(1)),
                    "page": page_idx,
                    "y0": row_top,
                    "first_line": txt.splitlines()[0],
                })
    anchors.sort(key=lambda a: (a["page"], a["y0"]))
    return anchors


def stitch_vertical(pix1: pymupdf.Pixmap, pix2: pymupdf.Pixmap) -> pymupdf.Pixmap:
    w = max(pix1.width, pix2.width)
    h = pix1.height + pix2.height
    out = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), False)
    out.set_rect(out.irect, (255, 255, 255))
    # Copy scanlines via PIL-free byte slice when widths match or fallback
    out_buf = bytearray(out.samples)
    row_out = w * 3
    for y in range(pix1.height):
        src_start = y * pix1.width * 3
        dst_start = y * row_out
        out_buf[dst_start : dst_start + pix1.width * 3] = pix1.samples[src_start : src_start + pix1.width * 3]
    for y in range(pix2.height):
        src_start = y * pix2.width * 3
        dst_start = (pix1.height + y) * row_out
        out_buf[dst_start : dst_start + pix2.width * 3] = pix2.samples[src_start : src_start + pix2.width * 3]
    return pymupdf.Pixmap(pymupdf.csRGB, w, h, bytes(out_buf), False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Crop individual questions from PDF")
    parser.add_argument("--pdf", default="private/pdf/gt1.pdf")
    parser.add_argument("--out", default="private/crops")
    parser.add_argument("--prefix", default="gt1")
    parser.add_argument("--dpi", type=int, default=200)
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(args.pdf)
    anchors = find_question_anchors(doc)
    zoom = args.dpi / 72.0
    mat = pymupdf.Matrix(zoom, zoom)

    footer_margin = 34.0
    index_entries = []

    for i, cur in enumerate(anchors):
        p_idx = cur["page"]
        page = doc[p_idx]
        pw, ph = page.rect.width, page.rect.height
        top_y = 40.0 if p_idx == 0 else 12.0
        y_start = max(top_y, cur["y0"] - 4.0)

        nxt = anchors[i + 1] if i + 1 < len(anchors) else None
        if nxt and nxt["page"] == p_idx:
            y_end = max(y_start + 10.0, nxt["y0"] - 4.0)
            clip = pymupdf.Rect(0, y_start, pw, y_end)
            pix = page.get_pixmap(matrix=mat, clip=clip, alpha=False)
            pages = [p_idx + 1]
        elif nxt and nxt["page"] == p_idx + 1:
            y_end1 = ph - footer_margin
            pix1 = page.get_pixmap(matrix=mat, clip=pymupdf.Rect(0, y_start, pw, y_end1), alpha=False)
            next_page = doc[p_idx + 1]
            next_top = 12.0
            y_end2 = max(next_top + 10.0, nxt["y0"] - 4.0)
            if y_end2 > next_top + 12.0:
                pix2 = next_page.get_pixmap(
                    matrix=mat,
                    clip=pymupdf.Rect(0, next_top, next_page.rect.width, y_end2),
                    alpha=False,
                )
                pix = stitch_vertical(pix1, pix2)
                pages = [p_idx + 1, p_idx + 2]
            else:
                pix = pix1
                pages = [p_idx + 1]
        else:
            y_end = ph - footer_margin
            pix = page.get_pixmap(matrix=mat, clip=pymupdf.Rect(0, y_start, pw, y_end), alpha=False)
            pages = [p_idx + 1]

        qid = f"{args.prefix}_{cur['num']:03d}"
        out_path = out_dir / f"{qid}.png"
        pix.save(str(out_path))
        index_entries.append({
            "id": qid,
            "num": cur["num"],
            "pages": pages,
            "image": str(out_path).replace("\\", "/"),
        })

    (out_dir / "crops_index.json").write_text(
        json.dumps(index_entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Cropped {len(index_entries)} questions to {out_dir}")


if __name__ == "__main__":
    main()
