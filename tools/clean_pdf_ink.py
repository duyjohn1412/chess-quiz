import argparse
import re
import subprocess
import sys
from pathlib import Path
import pymupdf


INK_BLOCK_RE = re.compile(rb"/GOOG:INKIsInker\s+BMC.*?EMC", flags=re.S)


def clean_pdf_ink(src_pdf: Path, dst_pdf: Path) -> dict:
    doc = pymupdf.open(str(src_pdf))
    removed_blocks = 0
    cleaned_pages = []

    for page_idx, page in enumerate(doc):
        page_removed = 0
        for xref in page.get_contents():
            raw = doc.xref_stream(xref)
            if not raw:
                continue
            cleaned, count = INK_BLOCK_RE.subn(b"", raw)
            if count > 0:
                doc.update_stream(xref, cleaned)
                page_removed += count
                removed_blocks += count
        # Also remove any Ink annotations if a PDF contains standard PDF /Annots
        annots_to_delete = [
            annot
            for annot in (page.annots() or [])
            if annot.type[1] in {"Ink", "FreeText", "Polygon", "PolyLine"}
        ]
        for annot in annots_to_delete:
            page.delete_annot(annot)
            page_removed += 1
            removed_blocks += 1

        if page_removed > 0:
            cleaned_pages.append({"page": page_idx + 1, "removed": page_removed})

    dst_pdf.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(dst_pdf), garbage=4, deflate=True)
    doc.close()
    return {"removed_blocks": removed_blocks, "cleaned_pages": cleaned_pages}


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove handwritten pen/ink strokes from PDF and refresh pages & crops")
    parser.add_argument("--src", default="private/pdf/gt1.pdf")
    parser.add_argument("--dst", default="private/pdf/gt1_clean.pdf")
    parser.add_argument("--dpi", type=int, default=200)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    src_pdf = (root / args.src).resolve()
    dst_pdf = (root / args.dst).resolve()

    summary = clean_pdf_ink(src_pdf, dst_pdf)
    print(f"Cleaned PDF written to {dst_pdf}: removed {summary['removed_blocks']} ink blocks across {len(summary['cleaned_pages'])} pages")
    for item in summary["cleaned_pages"]:
        print(f"  - Page {item['page']}: removed {item['removed']} pen strokes")

    # Re-render pages and crops from the cleaned PDF
    subprocess.run(
        [sys.executable, str(root / "tools" / "render_pages.py"), "--pdf", str(dst_pdf), "--out", str(root / "private" / "pages"), "--dpi", str(args.dpi)],
        check=True,
    )
    subprocess.run(
        [sys.executable, str(root / "tools" / "crop_questions.py"), "--pdf", str(dst_pdf), "--out", str(root / "private" / "crops"), "--dpi", str(args.dpi)],
        check=True,
    )


if __name__ == "__main__":
    main()
