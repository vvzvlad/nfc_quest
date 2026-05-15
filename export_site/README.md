# ПЕРИМЕТР · NFC Quest — React screens

Готовые экраны NFC-квеста для конференции «Периметр» / Metascan.
15 экранов в трёх группах: **Player** (мобильные веб-страницы, открываемые
из NFC-метки), **Hall** (большой экран в холле, 1920×1080) и **Admin**
(панель администратора, 1440×900).

## Структура

```
src/
  main.jsx            ─ Vite entry
  App.jsx             ─ Демо-роутер (React Router v6) — замените на свой
  QuestContext.js     ─ Контекст с именем квеста
  theme.css           ─ Палитры + шрифты (data-palette / data-font на <html>)
  screens/
    Player.jsx        ─ 9 мобильных экранов + QuestHeader/Footer/BoardSliceRow/CornerBrackets/IconLock
    Hall.jsx          ─ ScreenHallScoreboard + Podium / HallRow / Stat
    Admin.jsx         ─ 5 админских экранов + AdminShell / Sidebar / TopBar / хелперы
```

## Старт

```bash
npm install
npm run dev          # http://localhost:5173
```

На `/` лежит галерея со всеми экранами, далее на каждом — `/register`, `/tag/plus`, `/hall/scoreboard`, `/admin/game` и т.д.

## Интеграция в существующее приложение

1. Скопируйте `src/screens/`, `src/QuestContext.js`, `src/theme.css` в свой проект.
2. Импортируйте `theme.css` глобально (в `main.jsx` / `_app.tsx` / любом корневом файле).
3. Оберните поддерево в `<QuestCtx.Provider value="ПЕРИМЕТР">` (или другое имя).
4. Импортируйте нужные экраны:

```jsx
import { ScanSuccessPlus, ScreenScoreboardMobile } from './screens/Player';
import { ScreenHallScoreboard } from './screens/Hall';
import { ScreenAdminGame } from './screens/Admin';
```

5. На `<html>` или контейнере выставьте `data-palette` / `data-font`:

| атрибут        | значения                                            |
|----------------|-----------------------------------------------------|
| `data-palette` | `default` (Периметр) · `acid` · `paper` · `cobalt`  |
| `data-font`    | `ibm` · `jetbrains` · `space` · `pt`                |

## Подключение к серверу

Все экраны сейчас содержат **мок-данные**, зашитые внутрь — это нужно
заменить на реальные пропсы / контекст / стор:

- **Player.jsx** — `ScanResultLayout` уже принимает `hero / sub / tone / strategy / meta / boardSlice / boardTimer / boardEmpty`. Обёртки (`ScanSuccessPlus`, `ScanLocked` и т.д.) — это **примеры использования**; замените их на единый `ScanResultPage`, который вычисляет props из ответа сервера:

  ```jsx
  function ScanResultPage({ tag, user, board, error }) {
    if (error === 'unknown')   return <ScanUnknown />;
    if (error === 'ratelimit') return <ScanRateLimit />;
    if (tag.status === 'before') return <ScanNotYet />;
    if (tag.status === 'after')  return <ScanFinished />;
    if (tag.status === 'locked') return <ScanLocked />;
    return (
      <ScanResultLayout
        user={user.nick} score={user.score} tagId={tag.id}
        tone={tag.delta > 0 ? 'plus' : 'minus'}
        hero={(tag.delta > 0 ? '+' : '') + tag.delta}
        sub={tag.label} strategy={tag.strategy}
        meta={`${user.scoreBefore} → ${user.score} · место #${user.prevPlace} → #${user.place}`}
        boardSlice={board.sliceAroundMe()}
      />
    );
  }
  ```

- **Hall.jsx** — массив `HALL` пока статичен. Передайте `players`, `timer`, `stats`, `ticker` через props или используйте WebSocket/SSE-хук.

- **Admin.jsx** — таблицы `tags / players / log` тоже моки. Перенесите данные в стор.

## Production-чек-лист

- [ ] Заменить мок-данные на реальные (props / контекст / стор)
- [ ] Прокинуть колбэки на кнопки, инпуты, ссылки
- [ ] Подключить live-обновления (live-dot сейчас декоративный — WS/SSE)
- [ ] Локализовать / вычитать копирайт
- [ ] Слить шрифты в локальные `woff2` — `theme.css` сейчас грузит с Google Fonts
- [ ] PWA-манифест, мета-теги, OG-картинки
- [ ] Отрезать `react-router-dom` из прода, если не используется

## Зависимости

- React 18
- React Router 6 (только для демо-харнесса)
- Vite (любой бандлер подойдёт)

## Лицензия

Internal use.
