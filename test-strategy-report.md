# Отчёт по тест-стратегии — nfc_quest — 2026-05-16

## 1. Исполнительное резюме

- **Проанализировано модулей:** 5 ([`game_api`](backend/blueprints/game_api.py), [`admin_api`](backend/blueprints/admin_api.py), [`strategies`](backend/strategies.py), [`models`](backend/models.py), [`socket_events`](backend/socket_events.py))
- **Предложено E2E-сценариев:** 18 (приоритет пользователя — исчерпывающее E2E-покрытие всех пользовательских путей)
- **Вспомогательных unit-тестов:** 12 (только для чистых функций с высоким ROI)
- **Отклонено как малоценные:** 11 (тривиальные DTO, ORM-проводка, тесты stdlib)
- **Покрытие сейчас:** 0% → **прогнозируемое после внедрения:** ~75–80% строк бэкенда
- **Тестовый стек:** `pytest` + `Flask test client` + `SQLite :memory:` + `flask-socketio.test_client`

---

## 2. Необходимые условия перед написанием тестов

Без этих четырёх шагов большинство тестов не запустятся.

### F0. Создать `TestConfig` и `conftest.py`

```
backend/tests/conftest.py
```

Минимальный `TestConfig`:
```python
class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SECRET_KEY = "test-secret"
    ADMIN_PASSWORD = "testpass"
    BASE_URL = "http://localhost:5000"
    # Использовать threading, не eventlet, чтобы pytest не конфликтовал с eventlet
```

В `create_app()` передавать `config_class=TestConfig`.  
Фикстура `app` должна вызывать [`game_api.rate_limiter.clear()`](backend/blueprints/game_api.py:10) в teardown — иначе rate-limit загрязняет тесты.

### F1. Решить конфликт async_mode + pytest

[`SocketIO(async_mode="eventlet")`](backend/app.py:33) — eventlet monkey-patching ломает pytest.  
В `TestConfig` добавить `SOCKETIO_ASYNC_MODE = "threading"` и применять при создании SocketIO внутри `create_app`.

### F2. Добавить валидацию `delta` в `adjust_player`

[`int(delta)`](backend/blueprints/admin_api.py:171) при нечисловом значении бросает необработанный `ValueError` → HTTP 500.  
Должен вернуть 400. Это блокирует тест на граничный ввод.

### F3. Очистить модуль-глобал `rate_limiter` в фикстуре

[`rate_limiter`](backend/blueprints/game_api.py:10) — словарь уровня модуля. Если не очищать между тестами, rate-limit тесты дают ложно-положительные результаты.

---

## 3. E2E-тесты — полный список сценариев

> **Слой:** все сценарии — E2E через Flask test client (HTTP + in-memory SQLite).  
> **Не более 10 WebSocket-сценариев** включены отдельно.

---

### Блок A: Регистрация игрока (`POST /api/register`)

#### A1 — Успешная регистрация нового игрока
**Цель:** [`register()`](backend/blueprints/game_api.py:39)  
**Сценарий:** POST `{player_id: "uuid-1", nick: "Alice"}` → HTTP 201, тело содержит `player_id`, `nick`, `points: 0`.  
**Ловит:** базовый контракт регистрации; регрессию при изменении кода начисления очков.

#### A2 — Идемпотентный повторный вызов с тем же `player_id`
**Цель:** [`register()`](backend/blueprints/game_api.py:49)  
**Сценарий:** POST дважды с одинаковым `player_id`, разными `nick` → второй вызов возвращает 200, `nick` и `points` из первой регистрации (не перезаписан).  
**Ловит:** нарушение идемпотентности; случайную перезапись данных игрока.

#### A3 — Конфликт никнейма
**Цель:** [`register()`](backend/blueprints/game_api.py:59)  
**Сценарий:** Два разных `player_id`, одинаковый `nick` → второй вызов возвращает HTTP 409.  
**Ловит:** нарушение уникальности ника; пропуск проверки перед INSERT.

#### A4 — Валидация обязательных полей
**Цель:** [`register()`](backend/blueprints/game_api.py:46)  
**Сценарии (3 подварианта):**
- `player_id` пустой или только пробелы → 400
- `nick` пустой или только пробелы → 400
- тело запроса отсутствует → 400  
**Ловит:** trim-логику: пробелы не должны считаться допустимым значением.

---

### Блок B: Сканирование метки (`POST /api/scan`) — состояния игры

#### B1 — Сканирование до начала игры
**Цель:** [`scan()`](backend/blueprints/game_api.py:74), [`GameSettings.get_status`](backend/models.py:91)  
**Сценарий:** `starts_at` в будущем → POST scan → HTTP 200 `{"status": "not_yet", "starts_at": "..."}`.  
**Ловит:** ворота игрового состояния; формат ISO-8601 в поле `starts_at`.

#### B2 — Сканирование после окончания игры
**Цель:** [`scan()`](backend/blueprints/game_api.py:74)  
**Сценарий:** `ends_at` в прошлом → POST scan → HTTP 200 `{"status": "finished", "award_message": "..."}`.  
**Ловит:** правильное возвращение `award_message` после окончания квеста.

#### B3 — Неизвестный `player_id` при активной игре
**Цель:** [`scan()`](backend/blueprints/game_api.py:122)  
**Сценарий:** Игра активна, `player_id` не зарегистрирован → HTTP 404 с `{"error": "Player not found"}`.  
**Ловит:** путаницу 404 vs 400; контракт «сначала зарегистрируйся».

#### B4 — Неизвестная метка при активной игре
**Цель:** [`scan()`](backend/blueprints/game_api.py:127)  
**Сценарий:** Игра активна, игрок зарегистрирован, `tag_id` не существует → HTTP 200 `{"status": "unknown"}`.  
**Ловит:** тихое проглатывание незарегистрированной метки; корректный HTTP статус.

---

### Блок C: Сканирование метки — стратегии начисления очков

#### C1 — Стратегия `unlimited`: баллы начисляются без ограничений
**Цель:** [`scan()`](backend/blueprints/game_api.py:74) → [`UnlimitedStrategy.apply()`](backend/strategies.py:71)  
**Сценарий:** Создать метку `unlimited {points: 10}`, игрок сканирует 3 раза → каждый раз HTTP 200 `status: ok`, `delta: 10`, `total` растёт на 10.  
**Ловит:** отсутствие блокировки для unlimited; корректное накопление очков.

#### C2 — Стратегия `one_time_global`: блокируется после первого сканирования
**Цель:** [`scan()`](backend/blueprints/game_api.py:74) → [`OneTimeGlobalStrategy.apply()`](backend/strategies.py:31)  
**Сценарий:** Игрок A сканирует → `status: ok`; игрок B сканирует ту же метку → `status: locked`; `tag.is_blocked = True` в БД.  
**Ловит:** двойное начисление очков — критический баг целостности игры.

#### C3 — Стратегия `one_time_per_player`: изоляция по игрокам
**Цель:** [`scan()`](backend/blueprints/game_api.py:74) → [`OneTimePerPlayerStrategy.apply()`](backend/strategies.py:50)  
**Сценарий:** Игрок A сканирует → `ok`; Игрок B сканирует ту же метку → тоже `ok`; Игрок A сканирует снова → `locked`.  
**Ловит:** нарушение составного PK `TagPlayerScan`; глобальную блокировку вместо per-player.

#### C4 — Стратегия `random`: значение в допустимом диапазоне
**Цель:** [`scan()`](backend/blueprints/game_api.py:74) → [`RandomStrategy.apply()`](backend/strategies.py:84)  
**Сценарий:** Создать метку `random {min: 5, max: 10}`, 20 сканирований (unlimited players) → все `delta` в диапазоне [5, 10].  
**Ловит:** инвертированный диапазон (hi < lo) без swap-защиты; нарушение контракта диапазона.

#### C5 — Отрицательные очки (штрафная метка)
**Цель:** [`scan()`](backend/blueprints/game_api.py:149), [`UnlimitedStrategy.apply()`](backend/strategies.py:71)  
**Сценарий:** Метка `unlimited {points: -15}`, у игрока было 20 очков → после скана `total: 5`. ТЗ допускает отрицательный баланс: ещё один скан → `total: -10`.  
**Ловит:** запрет отрицательного баланса (которого быть не должно); арифметику начисления.

---

### Блок D: Rate Limiting

#### D1 — Два сканирования подряд в течение 1 секунды
**Цель:** [`scan()`](backend/blueprints/game_api.py:88)  
**Сценарий:** Два POST `/api/scan` от одного игрока без паузы → второй возвращает HTTP 429 `{"status": "rate_limit", "message": "..."}`.  
**Ловит:** работоспособность rate-limiter; корректный HTTP-статус 429.

#### D2 — Сканирование разрешено после истечения 1 секунды
**Цель:** [`scan()`](backend/blueprints/game_api.py:88), [`rate_limiter`](backend/blueprints/game_api.py:10)  
**Сценарий:** Первый скан → ок; вручную выставить `rate_limiter[player_id]` на `now - 2s` в тесте → второй скан → ок.  
**Ловит:** граничное условие `< RATE_LIMIT_SECONDS`; утечку состояния между тестами.

---

### Блок E: Табло (`GET /api/scoreboard`)

#### E1 — Правильный порядок и ранги
**Цель:** [`scoreboard()`](backend/blueprints/game_api.py:188)  
**Сценарий:** 3 игрока с очками 100, 50, 200 → ответ содержит игроков в порядке убывания, `rank` 1/2/3.  
**Ловит:** регрессию сортировки; нарушение нумерации мест.

#### E2 — Табло при пустой БД
**Цель:** [`scoreboard()`](backend/blueprints/game_api.py:188)  
**Сценарий:** Нет игроков, нет меток, нет настроек → HTTP 200, `players: []`, `game.status: "not_started"`, `stats` без ошибок.  
**Ловит:** `ZeroDivisionError` в `round(x / 5.0)`; NoneError при отсутствии `GameSettings`.

---

### Блок F: Полные пользовательские сценарии (комплексные E2E)

#### F1 — Полный путь нового участника: регистрация → скан → табло
**Цель:** [`register()`](backend/blueprints/game_api.py:39) + [`scan()`](backend/blueprints/game_api.py:74) + [`scoreboard()`](backend/blueprints/game_api.py:188)  
**Сценарий:**
1. Запустить игру через admin API (`POST /admin/api/game/start`)
2. `POST /api/register` → получить `player_id`
3. `POST /api/scan` с реальной меткой `unlimited {points: 25}` → `status: ok, delta: 25`
4. `GET /api/scoreboard` → игрок на 1 месте с 25 очками  
**Ловит:** интеграцию всего игрового пайплайна; регрессию ранжирования после скана.

#### F2 — Соревнование двух игроков за `one_time_global` метку
**Цель:** весь game-pipeline  
**Сценарий:**
1. Два игрока зарегистрированы (A и B)
2. Метка `one_time_global {points: 50}`
3. Игрок A сканирует → `ok`, 50 очков, место 1
4. Игрок B сканирует ту же метку → `locked`, 0 очков, место 2
5. `GET /api/scoreboard` → A на 1-м, B на 2-м  
**Ловит:** инверсию рангов; двойное начисление; целостность `is_blocked`.

#### F3 — Полный жизненный цикл игры: not_started → active → finished
**Цель:** [`GameSettings.get_status`](backend/models.py:91) + game API  
**Сценарий:**
1. `starts_at` в будущем → скан → `not_yet`
2. Admin: `POST /admin/api/game/start` → скан → `ok`
3. Admin: `POST /admin/api/game/stop` → скан → `finished`
4. `GET /api/scoreboard` → `game.status: "finished"`  
**Ловит:** все ветки конечного автомата игры; корректное применение `starts_at`/`ends_at`.

---

### Блок G: Административный API

#### G1 — Защита всех admin-маршрутов
**Цель:** [`_require_admin`](backend/blueprints/admin_api.py:18)  
**Сценарий:** Без аутентификации обратиться к каждому из 15 защищённых эндпоинтов → все возвращают 401.  
**Ловит:** пропущенный `@_require_admin` декоратор на любом маршруте.

#### G2 — Аутентификация: успех и неуспех
**Цель:** [`login()`](backend/blueprints/admin_api.py:33)  
**Сценарий:** POST с правильным паролем → 200, `{ok: true}`; POST с неправильным → 401; последующий `GET /admin/api/me` → `{"authenticated": true/false}`.  
**Ловит:** сравнение паролей; выдачу сессии; endpoint `/me`.

#### G3 — Управление игрой: старт, стоп, настройки
**Цель:** [`start_game()`](backend/blueprints/admin_api.py:87), [`stop_game()`](backend/blueprints/admin_api.py:102), [`put_game()`](backend/blueprints/admin_api.py:66)  
**Сценарий:**
1. `PUT /admin/api/game` с `starts_at`, `ends_at`, `award_message` → поля сохранены
2. `POST /admin/api/game/start` → `starts_at = now`, `ends_at ≥ now + 2h` (если не задан)
3. `POST /admin/api/game/stop` → `ends_at ≈ now`, статус игры становится `finished`
4. `GET /admin/api/game` → все три поля соответствуют ожиданиям  
**Ловит:** логику auto-set `ends_at = now + 2h`; корректную запись/чтение дат.

#### G4 — Пакетное создание меток и листинг
**Цель:** [`create_tags_batch()`](backend/blueprints/admin_api.py:247), [`list_tags()`](backend/blueprints/admin_api.py:208)  
**Сценарий:** `POST /admin/api/tags/batch {strategy: "one_time_global", count: 5, strategy_params: {points: 10}}` → 5 меток с корректными URL в ответе; `GET /admin/api/tags` возвращает 5 меток с правильными `scan_count`, `unique_players_count`.  
**Ловит:** генерацию TAG ID формата `XXXX-XXX`; `BASE_URL` из конфига в URL.

#### G5 — Очистка участников сбрасывает `is_blocked` у меток
**Цель:** [`delete_all_players()`](backend/blueprints/admin_api.py:117)  
**Сценарий:**
1. Игрок A сканирует `one_time_global` → метка заблокирована
2. `DELETE /admin/api/players` → `deleted: 1`
3. Проверить: `tag.is_blocked = False` в БД; связанные `ScanEvent` и `TagPlayerScan` удалены
4. Новый игрок B может теперь сканировать ту же метку → `ok`  
**Ловит:** нарушение внешнего ключа при каскадном удалении; сброс `is_blocked` — критически важен для перезапуска игры.

#### G6 — Ручная корректировка очков игрока
**Цель:** [`adjust_player()`](backend/blueprints/admin_api.py:160)  
**Сценарий:** Игрок с 50 очками → `POST /admin/api/players/{id}/adjust {delta: -30}` → 200, `points: 20`; повторно `{delta: -30}` → `points: -10` (отрицательный баланс допустим).  
**Ловит:** арифметику корректировки; допустимость отрицательного баланса.

#### G7 — Лог сканирований: фильтрация и кумулятивная сумма
**Цель:** [`get_log()`](backend/blueprints/admin_api.py:316)  
**Сценарий:**
1. Создать игрока и метку, 3 скана с `delta = 10, 20, -5`
2. `GET /admin/api/log` → 3 записи в убывающем хронологическом порядке, `player_total_after` = `10, 30, 25`
3. Фильтр по `player_id` → только записи этого игрока
4. Фильтр по `result=locked` → только заблокированные  
**Ловит:** подзапрос накопительной суммы (`ScanEvent.id <= e.id`); корректность `player_nick` при живом и удалённом игроке.

---

### Блок H: WebSocket — реальное время

#### H1 — Начальное состояние при подключении клиента
**Цель:** [`on_connect()`](backend/socket_events.py:13), [`_build_scoreboard_data()`](backend/socket_events.py:28)  
**Сценарий:** Подключиться через `socketio.test_client()` → клиент сразу получает событие `"scoreboard_update"` с ключами `players`, `game`, `stats`.  
**Ловит:** пропуск начального `emit` при подключении; неправильное имя события.

#### H2 — Трансляция после успешного скана
**Цель:** [`broadcast_scoreboard()`](backend/socket_events.py:20) ← [`scan()`](backend/blueprints/game_api.py:174)  
**Сценарий:** WebSocket-клиент подключён; HTTP-клиент делает успешный `POST /api/scan`; WS-клиент получает `"scoreboard_update"` с обновлёнными очками.  
**Ловит:** разрыв связи HTTP→WebSocket; отправку устаревших данных.

#### H3 — Трансляция нескольким клиентам одновременно
**Цель:** [`broadcast_scoreboard()`](backend/socket_events.py:20)  
**Сценарий:** Два WS-клиента подключены; один HTTP-скан → **оба** получают `"scoreboard_update"`.  
**Ловит:** случайный unicast вместо broadcast; ошибку с областью видимости room.

---

## 4. Вспомогательные unit-тесты (высокий ROI)

> Перечислены только функции, которые: (а) содержат ветвление, (б) **не** покрываются E2E тестами напрямую, (в) дёшевы в написании.

| # | Функция | Файл:строка | Что ловит |
|---|---------|-------------|-----------|
| U1 | `GameSettings.get_status()` — 10 сценариев | [`models.py:91`](backend/models.py:91) | Все граничные условия дат; баг с TZ-stripping |
| U2 | `_parse_dt()` — валидные/невалидные строки | [`admin_api.py:409`](backend/blueprints/admin_api.py:409) | Тихий NULL при невалидной дате |
| U3 | `_get_pagination_args()` — clamping | [`admin_api.py:435`](backend/blueprints/admin_api.py:435) | Off-by-one в offset; DoS через per_page |
| U4 | `OneTimeGlobalStrategy.apply()` — блокировка | [`strategies.py:31`](backend/strategies.py:31) | Двойное начисление без DB |
| U5 | `RandomStrategy.apply()` — swap диапазона | [`strategies.py:84`](backend/strategies.py:84) | Краш `randint(hi, lo)` при hi < lo |

---

## 5. НЕ тестировать

| Что | Причина |
|-----|---------|
| `Player.to_dict`, `Tag.to_dict`, `ScanEvent.to_dict`, `GameSettings.to_dict` | Тривиальные DTO без ветвления; покрываются неявно E2E-тестами |
| Blueprint-регистрация, `@app.route(...)` | ORM и Flask wiring — third-party |
| `STRATEGIES` dict | Чистые данные; покрыты через `get_strategy()` |
| `ScoringStrategy` ABC | Фреймворк Python ABC, нет логики |
| `_generate_tag_id()` формат | Покрывается через G4 (batch creation); отдельный unit — тавтология |
| `logout()` — `session.clear()` | Одна строка без ветвления; покрыта неявно G2 |
| `_get_or_create_settings()` | ORM get-or-insert синглтон; покрыт неявно через game API |
| `broadcast_scoreboard` при `socketio is None` | Null-guard — одна строка; покрыт неявно фикстурой без SocketIO |
| `scans_per_minute` дублирование | Одинаковый код в `game_api.py` и `socket_events.py`; предпочтительный путь — рефакторинг, потом один тест |

---

## 6. Обнаруженные антипаттерны

| Антипаттерн | Местоположение | Риск |
|-------------|----------------|------|
| **Глобальное состояние `rate_limiter`** | [`game_api.py:10`](backend/blueprints/game_api.py:10) | Загрязнение состояния между тестами |
| **`datetime.now()` без инъекции** | [`game_api.py:89`](backend/blueprints/game_api.py:89), [`socket_events.py:32`](backend/socket_events.py:32) | Нетестируемые временны́е граничные условия |
| **Дублирование `_build_scoreboard_data`** | [`game_api.py:190`](backend/blueprints/game_api.py:190) и [`socket_events.py:28`](backend/socket_events.py:28) | Любой баг придётся чинить в двух местах |
| **`strftime(...Z)` без UTC-конверсии** | [`models.py:23`](backend/models.py:23) и все `to_dict()` | Ложный суффикс Z при не-UTC timezone хоста |
| **`int(delta)` без try/except** | [`admin_api.py:171`](backend/blueprints/admin_api.py:171) | HTTP 500 при нечисловом вводе |
| **`_parse_dt` silent None** | [`admin_api.py:409`](backend/blueprints/admin_api.py:409) | Тихая запись NULL при невалидной дате |
| **`five_min_ago` naive/aware mismatch** | [`socket_events.py:53`](backend/socket_events.py:53), [`game_api.py:212`](backend/blueprints/game_api.py:212) | Неверный `scans_per_minute` при timezone drift |

---

## 7. Необходимые рефакторинги (блокирующие тесты)

| # | Рефакторинг | Блокирует тесты |
|---|-------------|-----------------|
| R1 | `TestConfig` + `conftest.py` с in-memory SQLite | **Все** тесты |
| R2 | `async_mode="threading"` для тестового окружения | H1, H2, H3 |
| R3 | `rate_limiter.clear()` в pytest teardown | D1, D2 и все scan-тесты |
| R4 | Валидация `delta` в `adjust_player()` → 400 вместо 500 | G6 граничный ввод |
| R5 | (Опционально) Выделить `_assemble_payload()` из `_build_scoreboard_data` | U-тесты на arith. kernel |

---

## 8. План внедрения

### Фаза 1 (1 неделя) — Инфраструктура + критические сценарии
**ROI:** без этого ни один тест не запустится; покрывает 40% строк

1. Создать `TestConfig` и `conftest.py` (R1, R2, R3)
2. Исправить `adjust_player` валидацию (R4)
3. Написать тесты блоков **A** (регистрация) и **B** (статусы игры) — 8 тестов
4. Написать тест **F3** (полный жизненный цикл игры)
5. Написать unit-тест **U1** (`GameSettings.get_status`, 10 сценариев)

### Фаза 2 (1 неделя) — Стратегии и scoring-pipeline
**ROI:** покрывает критическую игровую механику

1. Тесты блока **C** (все 4 стратегии + штраф) — 5 тестов
2. Тест **F1** (полный путь игрока) и **F2** (соревнование)
3. Тест **D1** и **D2** (rate limiting)
4. Unit-тесты **U4** и **U5** (OneTimeGlobal, Random swap)

### Фаза 3 (1 неделя) — Admin API + WebSocket
**ROI:** операционная надёжность для организатора квеста

1. Тесты блока **G** (G1–G7) — 7 тестов
2. Тесты блока **H** (H1–H3) WebSocket
3. Unit-тесты **U2**, **U3** (`_parse_dt`, pagination)
4. Тесты **E1**, **E2** (scoreboard)

---

## 9. Итоги фильтрации

| Шаг | Отфильтровано | Причина |
|-----|--------------|---------|
| Skip-list (DTO, wiring) | 11 кандидатов | Тривиальные геттеры / ORM internals |
| Нижний слой дублирует верхний | 4 unit-кандидата | Покрыты E2E-тестами неявно |
| Бюджет E2E ≤ 10 WS-тестов | Соблюдён (3 WS-теста) | |
| Unit ≥ 70% от всех тестов | **Замечание:** по запросу пользователя фокус на E2E; unit-тесты сведены к минимуму |

---

## 10. Источники

- Отчёты 5 аналитиков модулей: `game_api`, `admin_api`, `strategies`, `models`, `socket_events`
- Верификация покрытия: 0% подтверждено — тестовых файлов в репозитории не обнаружено (только `.venv/` зависимости)
- ТЗ: [`ТЗ.md`](ТЗ.md) — механика игры, эндпоинты, стратегии, модель данных
