import { createContext } from 'react';

// Quest name flows through context so screens re-render when the
// organiser renames the event in admin (e.g. "ТТТ", "DC9999").
export const QuestCtx = createContext('');
