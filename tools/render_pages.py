import argparse
from pathlib import Path
import pymupdf


def main() -> None:
    parser = argparse.ArgumentParser(description="Render PDF pages to PNG")
    parser.add_argument("--pdf", default="private/pdf/gt1.pdf")
    parser.add_argument("--out", default="private/pages")
    parser.add_argument("--dpi", type=int, default=200)
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(args.pdf)
    zoom = args.dpi / 72.0
    mat = pymupdf.Matrix(zoom, zoom)
    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=mat, alpha=False)
        out_path = out_dir / f"p{i:02d}.png"
        pix.save(str(out_path))
    print(f"Rendered {len(doc)} pages to {out_dir}")


if __name__ == "__main__":
    main()
