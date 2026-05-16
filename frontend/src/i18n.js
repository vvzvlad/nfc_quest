// i18n.js — frontend error code → localized message mapping

const ERROR_MESSAGES = {
  // Game API errors
  MISSING_FIELDS:        'Необходимые поля не заполнены',
  REGISTRATION_CLOSED:   'Регистрация закрыта — игра завершена',
  NICK_TAKEN:            'Никнейм уже занят',
  PLAYER_NOT_FOUND:      'Игрок не найден',
  TAG_NOT_FOUND:         'Метка не найдена',
  RATE_LIMIT_WAIT:       'Подождите секунду и попробуйте снова',

  // Admin API errors
  UNAUTHORIZED:          'Нет доступа — необходима авторизация',
  LOGIN_RATE_LIMIT:      'Слишком много попыток входа. Попробуйте позже',
  WRONG_PASSWORD:        'Неверный пароль',
  GAME_END_BEFORE_START: 'Конец игры должен быть после начала',
  GAME_TOO_SHORT:        'Игра должна длиться минимум 10 минут',
  INVALID_DELTA:         'delta должен быть числом',
};

// Returns the localized message for an error code.
// Falls back to `fallback` if the code is not found in the map.
export function getErrorMessage(code, fallback = 'Неизвестная ошибка') {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] ?? fallback;
}
