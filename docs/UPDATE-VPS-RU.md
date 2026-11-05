# Обновление сайта на VPS без удаления данных

Для уже установленного проекта в `/opt/doctor-chess`. Команды Windows и сервера выполняются в разных окнах. При любой ошибке остановитесь: не продолжайте следующие блоки.

## 1. Компьютер Windows

В обычном PowerShell, до подключения по SSH:

```powershell
cd C:\doctor-chess
git archive --format=tar.gz --output=doctor-chess-deploy.tar.gz HEAD
scp doctor-chess-deploy.tar.gz root@45.144.66.213:/root/
```

Архив содержит только закоммиченные исходники. Он не включает `.env`, локальные аккаунты, пароли и SQLite-базу. Дождитесь `100%` при передаче.

Подключитесь к VPS:

```powershell
ssh root@45.144.66.213
```

## 2. Резервная копия на сервере

После появления приглашения `root@doctor:...#`:

```bash
cd /opt/doctor-chess
umask 077
mkdir -p /root/doctor-chess-backups
BACKUP_STAMP=$(date -u +%Y%m%d-%H%M%S)
docker compose exec -T app python -c "import sqlite3; src=sqlite3.connect('/data/chess.sqlite3'); dst=sqlite3.connect('/data/pre-update.sqlite3'); src.backup(dst); dst.close(); src.close()"
docker compose cp app:/data/pre-update.sqlite3 "/root/doctor-chess-backups/chess-$BACKUP_STAMP.sqlite3"
cp .env "/root/doctor-chess-backups/env-$BACKUP_STAMP"
ls -lh /root/doctor-chess-backups
```

Должны появиться датированные копии базы и конфигурации. Если копирование не прошло, обновление пока не выполняйте. Резервные копии содержат приватные данные; не добавляйте их в Git и не публикуйте.

## 3. Заменить код и пересобрать

В том же SSH-окне:

```bash
tar -xzf /root/doctor-chess-deploy.tar.gz -C /opt/doctor-chess
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose exec -T app python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:4173/healthz').read().decode())"
```

Приложение должно показывать `healthy`, последняя команда — `{"ok":true}`. Затем откройте `https://doctor-chess.ru` и обновите страницу сочетанием Ctrl+F5. Входящий DNS и сертификат проверяются отдельно: внутренняя проверка здоровья не подтверждает доступность домена из интернета.

Рабочая база остаётся в существующем Docker-томе `chess-data`. Конфигурация домена `.env` не перезаписывается архивом. Пересборка может вызвать короткий перерыв в работе, поэтому обновляйте сайт без активных партий.

Не выполняйте `docker compose down -v`, `docker volume prune` и не удаляйте тома: это может удалить аккаунты и партии.

## Если новая версия не запустилась

Сохраните вывод:

```bash
docker compose ps
docker compose logs --tail=80 app caddy
```

Не заменяйте рабочую базу резервной наугад. Копии кода, конфигурации и базы нужно согласовать перед откатом, чтобы не потерять новые партии.
