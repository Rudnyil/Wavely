import { useEffect } from 'preact/hooks';
import { session } from '../session.js';

export function usePageTitle(title) {
  useEffect(() => {
    const name = session.get().config?.name || 'Wavely';
    document.title = title ? `${title} · ${name}` : name;
  }, [title]);
}
