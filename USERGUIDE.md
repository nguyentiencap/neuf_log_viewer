# Hướng dẫn sử dụng NEUF Log Viewer (End User)

Tài liệu này dành cho người dùng cuối khi sử dụng bản phát hành `neuf-log-viewer.exe`.

## 1) Chuẩn bị

- Hệ điều hành: Windows (64-bit)
- Có thư mục log cần phân tích (chứa các file `.log` của NEUF)
- File tải về từ Release gồm:
  - `neuf-log-viewer.exe`
  - `preset.json`
  - `USERGUIDE.md`

> Giữ `neuf-log-viewer.exe` và `preset.json` trong cùng một thư mục.

---

## 2) Chạy ứng dụng

Mở Command Prompt hoặc PowerShell tại thư mục chứa `neuf-log-viewer.exe`, sau đó chạy:

```powershell
.\neuf-log-viewer.exe <duong-dan-den-thu-muc-log>
```

Ví dụ:

```powershell
.\neuf-log-viewer.exe D:\logs\NEUF
```

Khi chạy thành công, ứng dụng sẽ khởi động Web UI tại:

- **http://localhost:3001**

---

## 3) Sử dụng giao diện Web

Trong trình duyệt, mở `http://localhost:3001` và thao tác:

1. Chọn bộ lọc ở cột bên trái (log level, device, component, thời gian, từ khóa tìm kiếm...)
2. Bấm **Apply** để lọc log
3. Dùng **Presets** để áp dụng nhanh các bộ lọc có sẵn
4. Dùng **Pagination** để chuyển trang khi kết quả nhiều
5. Bấm **Export** để tải toàn bộ kết quả lọc ra file `.log`

### Gợi ý lọc nhanh

- Bắt đầu với preset `errors_and_warnings` để giảm nhiễu
- Nếu cần tìm theo lỗi cụ thể, nhập từ khóa vào ô **Search**
- Có thể tăng **Context Lines** để xem thêm log trước/sau dòng khớp

---

## 4) Dữ liệu database được lưu ở đâu?

Ứng dụng tự tạo database khi chạy lần đầu tại:

```text
<log-folder>/log-filter-db/neuf-logs.db
```

Trên Windows, đường dẫn này tương đương:

```text
<log-folder>\log-filter-db\neuf-logs.db
```

Nếu bạn thêm log mới hoặc muốn index lại toàn bộ:

1. Tắt ứng dụng
2. Xóa thư mục `log-filter-db` trong thư mục log
3. Chạy lại `neuf-log-viewer.exe`

---

## 5) Lỗi thường gặp

### Không mở được `http://localhost:3001`

- Kiểm tra cửa sổ terminal có báo lỗi không
- Đảm bảo command chạy đúng đường dẫn thư mục log
- Thử chạy lại ứng dụng

### Báo đường dẫn thư mục log không tồn tại

- Kiểm tra lại đường dẫn truyền vào lệnh chạy
- Nếu đường dẫn có khoảng trắng, đặt trong dấu nháy kép:

```powershell
.\neuf-log-viewer.exe "D:\My Logs\NEUF"
```
