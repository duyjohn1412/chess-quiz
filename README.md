# Cờ Vua × Trắc Nghiệm (Chess × Calculus Quiz)

Game cờ vua đối kháng 1v1 kết hợp trả lời trắc nghiệm Toán Giải Tích 1 (KaTeX) và **23 thẻ chiến thuật** theo 4 nhóm (*Thời gian, Hỗ trợ cờ, Soi thông tin, Phá câu hỏi* — nổi bật với **Flash**, **Lá chắn 2s**, **Ép đi nhanh**, không nâng cấp thẻ).

---

## Tính năng chính

- **3 chế độ chơi**:
  - **⚡ Ghép trận nhanh (Firebase Ranked)**: Tự động ghép cặp trực tiếp qua Cloud Firestore (`asia-southeast1`), không cần tạo phòng/QR. Có hệ thống **Rank Elo** (khởi đầu `1000 Elo`, các mốc *Đồng / Bạc / Vàng / Bạch Kim / Kim Cương*) & **Bảng xếp hạng Top 20** lưu gắn với phiên đăng nhập ẩn danh trình duyệt (không xóa cache để giữ thứ hạng). Dùng bộ chuẩn 40 câu Giải tích 1 để bảo đảm công bằng.
  - **🔑 Phòng riêng Online (Mã & QR — Firebase + dự phòng P2P)**: Chủ phòng tạo mã 6 ký tự / QR Code / link để bạn bè & tối đa 5 khán giả vào đấu hoặc xem qua Firebase (tự động chuyển sang WebRTC / PeerJS nếu mất kết nối Firebase). Không tính Rank.
  - **🖥️ Chơi 1 máy (Hot-seat)**: Có màn che riêng tư giữa các lượt để 2 người chơi tại chỗ hoặc tự test toàn bộ thẻ, Quiz và Shop.
- **Tích hợp sẵn 40 câu Giải tích 1 đã quét sạch**: Nằm tại [`data/questions.gt1_40.json`](data/questions.gt1_40.json) (đã loại bỏ nét bút PDF, phân bố đều 8 chủ đề & 3 mức độ `M1/M2/M3`, kiểm chứng toán học và KaTeX `0` lỗi) + 8 câu demo nhanh tại [`data/questions.sample.json`](data/questions.sample.json). Người chơi cũng có thể tự nạp thêm file `questions.json` riêng vào `IndexedDB` của trình duyệt.
- **Stockfish 18 WASM offline**: Bộ phân tích cờ chạy bằng Web Worker trong [`public/stockfish/`](public/stockfish/) phục vụ cho các thẻ *Gợi ý nước đi*, *Nước ứng viên*, *Đánh giá thế cờ*, *Kế hoạch*.

### Kiến trúc Firebase (Spark miễn phí)
- Dự án riêng `chess` (`chess-quiz-9x4k2m`, database Enterprise `chess`, bật Anonymous Auth + Firestore Rules [`firestore.rules`](firestore.rules) + composite indexes [`firestore.indexes.json`](firestore.indexes.json)).
- Đồng bộ nước cờ dùng chế độ **Host-authoritative** tối ưu lượt ghi (chỉ ghi `views/p2` / `views/spectator` khi trạng thái đổi hoặc nhịp đồng hồ 6s). Có thể ghi đè config qua biến môi trường `VITE_FIREBASE_*`.

---

## Đưa lên GitHub & bật GitHub Pages

Thư mục [`private/`](.gitignore), `node_modules/` và `dist/` đã được loại trừ trong [`.gitignore`](.gitignore) để không đẩy PDF gốc hay tệp build thừa lên repo công khai.

### Bước 1: Đưa mã nguồn lên GitHub

Nếu máy đã cài **Git**:
```bash
git init
git add .
git commit -m "Initial commit: Chess x Quiz (40 curated GT1 questions)"
git branch -M main
git remote add origin https://github.com/<ten-cua-ban>/<ten-repo>.git
git push -u origin main
```

Nếu dùng **GitHub Desktop / Upload web**:
- Mở **GitHub Desktop** → *Add Existing Repository* chọn thư mục dự án → *Publish repository* (GitHub Desktop tự tôn trọng `.gitignore`, không đẩy `node_modules/`, `dist/`, `private/`).

### Bước 2: Bật GitHub Pages tự động

Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) sẽ tự chạy `vitest`, `tsc`, `verify_katex.mjs`, build Vite và deploy lên GitHub Pages mỗi khi push vào nhánh `main`/`master`:
1. Vào repo trên GitHub → **Settings** → **Pages**.
2. Ở mục **Build and deployment → Source**, chọn **GitHub Actions**.
3. Sau ~1 phút, mở đường dẫn `https://<ten-cua-ban>.github.io/<ten-repo>/` để chơi online & mời bạn bè bằng QR Code.

---

## Chạy & phát triển trên máy cục bộ

### Chạy ngay bằng `PLAY.bat` (Windows)
1. Cài dependencies & build (nếu chưa có `dist/`):
   ```bash
   npm install
   npm run build
   ```
2. Nhấp đúp [`PLAY.bat`](PLAY.bat) (hoặc chạy `python tools/serve_local.py --mode play`) rồi mở `http://localhost:4173/`.

### Lệnh phát triển & kiểm thử
```bash
npm run dev                  # Chạy Vite dev server
npm run test -- --run        # Unit tests & property simulation 50 ván bot
npm run lint                 # Kiểm tra TypeScript (tsc --noEmit)
npm run build                # Build bản production ra dist/
node tools/verify_katex.mjs data/questions.gt1_40.json
```

### Duyệt / làm sạch đề PDF cục bộ (`private/`, không push lên GitHub)
- `python tools/clean_pdf_ink.py` — xóa nét bút (`/GOOG:INKIsInker`) khỏi PDF gốc và cắt lại ảnh crop sạch.
- [`REVIEW.bat`](REVIEW.bat) — mở trang HTML duyệt đề [`tools/review/index.html`](tools/review/index.html).
