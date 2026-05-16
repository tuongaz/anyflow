import { createContext, useContext } from 'react';

export const UuidContext = createContext<string>('');

export function useUuid(): string {
  return useContext(UuidContext);
}
