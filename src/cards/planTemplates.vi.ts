export const PLAN_TEMPLATES_VI = {
  uncastledKing: 'Vua của bạn chưa nhập thành — cân nhắc đưa Vua vào vị trí an toàn sớm.',
  openFile: (file: string) => `Cột mở ${file} chưa có Xe chiếm — đặt Xe kiểm soát cột này.`,
  semiOpenFile: (file: string) => `Cột nửa mở ${file} thuận lợi để Xe tạo sức ép lên tốt đối phương.`,
  knightOutpost: (sq: string) => `Ô ${sq} là tiền đồn tốt cho Mã (khó bị tốt đối phương đuổi).`,
  isolatedPawn: (sq: string) => `Tốt ở ${sq} đang bị cô lập — cần quân hỗ trợ hoặc tìm cách đổi đi.`,
  doubledPawn: (file: string) => `Bạn có tốt chồng trên cột ${file} — chú ý bảo vệ hoặc mở đường cho quân nặng.`,
  hangingOrWeakPiece: (sq: string) => `Quân ở ${sq} đang mỏng/dễ bị nhắm tới — tăng cường bảo vệ trước khi tấn công.`,
  longDiagonal: (diag: string) => `Đường chéo dài ${diag} đang mở — Tượng có thể kiểm soát trung tâm từ xa.`,
  developMinors: 'Hoàn tất phát triển Mã và Tượng trước khi mở đợt tấn công lớn.',
  centerControl: 'Tranh chấp kiểm soát 4 ô trung tâm (d4, e4, d5, e5) để mở rộng không gian.',
  endgameKingActive: 'Đã vào tàn cuộc ít quân — đưa Vua tiến lên trung tâm hỗ trợ tốt.',
} as const;
