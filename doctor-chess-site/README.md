# Исходники Doctor Chess

Основная документация находится в [README проекта](../README.md).

Из корня репозитория:

```sh
python doctor-chess-site/server.py
npm test
```

Или из этой папки:

```sh
python server.py
node test-engine.cjs
node test-study.cjs
node test-client.cjs
python -m unittest test_server -v
```

Откройте [localhost:4173](http://localhost:4173).

- `server.py` — HTTP, аккаунты, сессии, очередь и сетевые партии.
- `social.py` — приглашения, дружеские встречи и реванши.
- `dist/` — интерфейс, правила, учебный движок и инструменты разбора.
- `data/` — рабочая SQLite-база. Не входит в Git.
- `outputs/` — локальные результаты проверок. Не входят в Git.

[Архитектура](../docs/ARCHITECTURE.md) · [API](../docs/API.md) · [История изменений](../CHANGELOG.md)
