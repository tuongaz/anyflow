import { useSyncExternalStore } from 'react';

const NAV_EVENT = 'seeflow:navigate';

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAV_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(NAV_EVENT, listener);
  };
};

const getSnapshot = () => window.location.pathname;

export const usePathname = (): string => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export const navigate = (to: string) => {
  if (to === window.location.pathname) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
};
