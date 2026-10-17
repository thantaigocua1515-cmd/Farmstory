# 🌾 Nông Trại Sunnyside

Game nông trại thư giãn phong cách Stardew Valley, chạy 100% trên browser (HTML5).
Assets pixel-art: **Sunnyside World** của Daniel Diggle. Nhạc nền: SunnyLand (CC0).

## Chơi thử

Mở `client/index.html` bằng browser, hoặc chạy local:

```bash
cd client && python3 -m http.server 8000
# mở http://localhost:8000
```

**Cách chơi:** WASD / mũi tên di chuyển • Space dùng công cụ • 1–4 đổi công cụ
(⛏️ cuốc, 🌱 gieo hạt, 💧 tưới, ✋ thu hoạch) • Q đổi hạt giống.
Trên điện thoại có joystick ảo + nút bấm. Nhớ tưới nước mỗi khi cây lên giai đoạn mới!

## Deploy lên Vercel (miễn phí)

1. Import repo này vào Vercel.
2. Để nguyên **Root Directory** (thư mục gốc). `vercel.json` đã cấu hình sẵn:
   - Build: copy `shared/*.js` vào `client/js/shared/`
   - Output: `client/`
3. Deploy → có link chơi ngay.

## Kiến trúc (để sẵn cho multiplayer)

```
shared/sim.js       ← toàn bộ LUẬT GAME, không dính browser/Node (dùng chung cho server sau này)
shared/protocol.js  ← khung message client↔server cho multiplayer (hiện chưa dùng)
client/             ← chỉ render + input + âm thanh, đọc state từ sim
```

Muốn lên multiplayer sau này: bê nguyên `shared/sim.js` lên server
(Node/Cloudflare Durable Objects), client gửi input → server chạy `stepGame`
→ broadcast state. Không cần viết lại luật chơi.

## Assets

File binary (PNG/OGG) trong `client/assets/` **không** nằm trong git
(GitHub API từ chối file binary). Chúng được nhúng base64 vào
`client/js/sunny-data.js` (tự sinh, đừng sửa tay).

Đổi/thêm assets rồi chạy lại:

```bash
node tools/embed-assets.mjs
```

## Lưu ý license

Sunnyside World là asset pack trả phí của Daniel Diggle — kiểm tra điều khoản
bản bạn mua trước khi phát hành thương mại.
