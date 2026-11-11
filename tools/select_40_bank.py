import json
from collections import Counter
from pathlib import Path

SELECTED_IDS = [
    # Cực trị & định lý (5)
    "gt1_046",
    "gt1_066",
    "gt1_085",
    "gt1_097",
    "gt1_109",
    # Giới hạn & liên tục (6)
    "gt1_013",
    "gt1_020",
    "gt1_035",
    "gt1_039",
    "gt1_058",
    "gt1_091",
    # Hàm số & hàm ngược (6)
    "gt1_002",
    "gt1_005",
    "gt1_019",
    "gt1_030",
    "gt1_031",
    "gt1_032",
    # Khai triển Maclaurin (4)
    "gt1_003",
    "gt1_011",
    "gt1_067",
    "gt1_092",
    # Tiệm cận & đường cong (5)
    "gt1_065",
    "gt1_088",
    "gt1_105",
    "gt1_106",
    "gt1_112",
    # Vô cùng bé (4)
    "gt1_026",
    "gt1_036",
    "gt1_056",
    "gt1_095",
    # Đạo hàm & vi phân (6)
    "gt1_001",
    "gt1_009",
    "gt1_024",
    "gt1_061",
    "gt1_071",
    "gt1_077",
    # Đạo hàm cấp cao (4)
    "gt1_004",
    "gt1_043",
    "gt1_060",
    "gt1_072",
]


def rotate_options_to_target(options: list[str], old_ans: int, target_ans: int) -> tuple[list[str], int]:
    """Rotate options cleanly so the exact correct option moves to target_ans."""
    if old_ans == target_ans:
        return list(options), target_ans
    correct_text = options[old_ans]
    others = [opt for idx, opt in enumerate(options) if idx != old_ans]
    new_opts = list(others)
    new_opts.insert(target_ans, correct_text)
    assert new_opts[target_ans] == correct_text
    assert set(new_opts) == set(options)
    return new_opts, target_ans


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    src_path = root / "private" / "questions.json"
    dst_path = root / "data" / "questions.gt1_40.json"

    src_bank = json.loads(src_path.read_text(encoding="utf-8"))
    by_id = {q["id"]: q for q in src_bank["questions"]}

    assert len(SELECTED_IDS) == 40
    assert len(set(SELECTED_IDS)) == 40

    # Keep natural PDF order
    ordered_ids = sorted(SELECTED_IDS)
    curated = []
    for idx, qid in enumerate(ordered_ids):
        src_q = dict(by_id[qid])
        target_ans = (idx * 3 + 1) % 4  # exact 10 each across 40 items
        new_opts, new_ans = rotate_options_to_target(src_q["options"], src_q["answer"], target_ans)
        num = int(qid.split("_")[1])
        curated.append(
            {
                "id": src_q["id"],
                "topic": src_q["topic"],
                "difficulty": src_q["difficulty"],
                "question": src_q["question"],
                "options": new_opts,
                "answer": new_ans,
                "explain": src_q.get("explain", ""),
                "source": f"Giải tích 1 (Câu {num})",
                "status": "verified",
            }
        )

    out_bank = {
        "bank": "gt1_curated_40",
        "title": "Giải tích 1 — Bộ chọn lọc (40 câu)",
        "version": 1,
        "questions": curated,
    }

    dst_path.write_text(json.dumps(out_bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote {len(curated)} questions to {dst_path}")
    print("Topics:", dict(Counter(q["topic"] for q in curated)))
    print("Difficulties:", dict(Counter(q["difficulty"] for q in curated)))
    print("Answer slots:", dict(Counter(q["answer"] for q in curated)))


if __name__ == "__main__":
    main()
