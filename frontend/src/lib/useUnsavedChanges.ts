import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const DEFAULT_MESSAGE = 'You have unsaved changes. Leave this page?';

export function useUnsavedChanges(dirty: boolean, message: string = DEFAULT_MESSAGE): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };

    const onClick = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target as Element | null;
      const anchor = target !== null && typeof target.closest === 'function' ? target.closest('a') : null;
      if (anchor === null) return;
      const href = anchor.getAttribute('href');
      if (href === null || !href.startsWith('/') || anchor.getAttribute('target') === '_blank') {
        return;
      }
      const [path] = href.split(/[?#]/);
      if (path === window.location.pathname) return;
      e.preventDefault();
      if (window.confirm(message)) {
        navigate(href);
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, message, navigate]);
}
