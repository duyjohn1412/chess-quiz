# DECISIONS.md

Ghi lại các quyết định điều chỉnh hoặc bổ sung so với `implementation_spec.md`:

- **2026-11-11 — Cửa sổ Lá chắn (`harmfulPendingSeconds`)**: Chỉnh từ `3` giây xuống **`2` giây** theo yêu cầu trực tiếp của chủ dự án (`"3. 2 giây thôi"`).
- **2026-11-11 — Bộ câu hỏi PDF Giải tích 1 (`gt1.pdf`)**:
  - Bỏ hoàn toàn các nét khoanh bút bi có sẵn (nhiều câu khoanh sai), tự giải độc lập 2 lượt và kiểm tra bằng script toán học.
  - Bỏ các câu có hình vẽ đồ thị (`Câu 42, 47, 68, 74, 76, 78, 107`).
  - Bỏ các câu quá dài, các câu chọn *nhiều* đáp án đúng, và các câu lỗi định dạng thiếu phương án (ví dụ Câu 94 chỉ có 3 đáp án).
  - Các câu 1 đáp án đúng nhưng có 5–6 phương án (`A–E`/`A–F`) được rút gọn về đúng 4 phương án `A–D` (giữ đáp án đúng + 3 phương án nhiễu hợp lý) để khớp giao diện phím tắt `A–D` và thẻ *Ẩn đáp án sai*.
- **2026-11-11 — Chế độ chơi 1 máy (Hot-seat) + P2P LAN/Web**: Hỗ trợ cả P2P (Host/Guest/Khán giả qua PeerJS với mã 6 ký tự, link, QR) lẫn chế độ 1 máy (Hot-seat có màn che chuyển lượt) để test và chơi ngay offline mà chưa cần đẩy lên GitHub.
- **2026-11-11 — Hiển thị kết quả khi 2 bên khác câu**: Trong `RESULT`, mỗi bên thấy đáp án đúng của chính câu mình nhận được, kèm kết quả Đúng/Sai, xu và streak của đối thủ.
- **2026-11-11 — Launcher chạy cục bộ (`PLAY.bat`)**: Build ra thư mục `dist/` (`index.html` + assets + `stockfish/` offline) và kèm `PLAY.bat` bật HTTP server cục bộ để tránh lỗi CORS của trình duyệt với ES modules và Stockfish Web Worker khi mở bằng `file://`.
- **2026-11-11 — Chế độ nạp câu hỏi mặc định khi chạy local**: Ngoài `<input type="file">` chọn `questions.json` và `questions.sample.json` có sẵn, trong bản build local nếu đặt `questions.json` (gitignored) hoặc chọn từ `private/questions.json` sẽ nạp vào IndexedDB ngay; giữ nguyên `.gitignore` để không lộ lên repo public sau này.
- **2026-11-12 — Chuẩn bị phát hành GitHub & bộ 40 câu chọn lọc sạch nét bút**:
  - Xóa toàn bộ 24 khối nét bút tay (`/GOOG:INKIsInker`) trực tiếp trong stream PDF bằng [`tools/clean_pdf_ink.py`](tools/clean_pdf_ink.py) (`gt1_clean.pdf`) và render lại toàn bộ ảnh crop sạch vào `private/crops/`.
  - Tuyển chọn & đóng gói sẵn **40 câu Giải tích 1** (`data/questions.gt1_40.json`, cân bằng 8 chủ đề, đủ mức `M1: 13 / M2: 19 / M3: 8`, đáp án `A–D` đều `10/10/10/10`, xác minh toán học & KaTeX `0` lỗi) làm bộ đề mặc định (`DEFAULT_BANK`) để bản GitHub Pages chơi được ngay không cần upload file.
  - Thêm workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) và giữ `private/`, `dist/`, `node_modules/` ngoài repo qua `.gitignore`.
- **2026-11-12 — Tích hợp Firebase miễn phí (Spark) & Cơ chế Rank Elo đơn giản**:
  - Tạo project Firebase độc lập mới mang tên hiển thị `chess` (`chess-quiz-9x4k2m`, vùng `asia-southeast1` Singapore, Cloud Firestore Enterprise `chess` free-tier với `REALTIME_UPDATES_MODE_ENABLED` và Anonymous Auth), tách biệt hoàn toàn khỏi mọi project có sẵn.
  - Hỗ trợ song song **⚡ Ghép trận nhanh (Ranked)** qua hàng đợi `queue/{uid}` + ghép transaction và **🔑 Phòng riêng 6 ký tự / QR (Unranked)** qua Firebase (tự động dự phòng PeerJS nếu ngoại tuyến).
  - Thêm hệ thống **Rank Elo đơn giản** (`1000 Elo`, `K=24`, 5 bậc *Đồng / Bạc / Vàng / Bạch Kim / Kim Cương*, BXH Top 20 qua Enterprise Pipeline) lưu qua Firebase Anonymous Auth (`browserLocalPersistence`) + bản sao `localStorage` (`cqRankProfile_v1`), giữ hạng cho tới khi người chơi xóa dữ liệu/cache trình duyệt.
  - Giữ đồng bộ Host-authoritative kèm chữ ký trạng thái + nhịp 6s và serialize JSON cho `views/{channel}` để tiết kiệm quota Spark miễn phí.
