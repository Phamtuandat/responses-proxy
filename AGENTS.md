# AGENTS

Repo này: `responses-proxy`.

## Mục tiêu
- Giữ proxy, dashboard, Telegram bot, Codex setup chạy đúng.
- Ưu tiên thay đổi nhỏ, có test, không đụng secrets.

## Nguồn chuẩn
- `README.md`
- `docker-compose.yml`
- `env/dev.mac.env`
- `env/prod.omv.env`
- `docs/*`

## Lệnh hay dùng
- `npm run check`
- `npm test`
- `npm run build`
- `npm run app:dev:install`
- `npm run app:dev:status`
- `npm run app:prod:install`
- `npm run app:prod:status`

## Môi trường
- `dev` chỉ cho Mac local.
- `prod` là OMV product.
- `main` push sẽ chạy CI/CD tự động.

## Quy tắc làm việc
- Không sửa secret trong file env.
- Không revert thay đổi của người khác nếu không liên quan.
- Khi sửa logic, cập nhật test cùng lúc.
- Khi đụng deploy, kiểm tra `docker ps`, `lsof`, và workflow status.

## Codex patch flow
- Feature `curl patch` dùng setup qua `GET /api/customer/codex/setup.sh`.
- Auth customer dùng `Authorization: Bearer <customer api key>`.
- Nếu sửa flow này, giữ README và test đồng bộ.
