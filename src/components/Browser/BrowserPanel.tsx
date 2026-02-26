import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Globe, ArrowLeft, ArrowRight, RotateCw, ExternalLink,
  Camera, Code,
} from 'lucide-react';
import type { BrowserState } from '@/types/electron';

interface BrowserPanelProps {
  onClose: () => void;
  initialUrl?: string;
}

export const BrowserPanel: React.FC<BrowserPanelProps> = ({ onClose: _onClose, initialUrl }) => {
  const [url, setUrl] = useState(initialUrl || 'https://google.com');
  const [urlInput, setUrlInput] = useState(initialUrl || 'https://google.com');
  const [state, setState] = useState<BrowserState>({
    isVisible: false, url: '', title: '', canGoBack: false, canGoForward: false, isLoading: false,
  });
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [pageContent, setPageContent] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const api = window.electronAPI;

  // Calculate and update BrowserView bounds based on content area position
  // Uses RAF and debouncing for smooth, lag-free updates
  const rafId = useRef<number | null>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  
  const updateBrowserBounds = useCallback(() => {
    if (!contentRef.current || !isActive || !api?.browserShow) return;
    
    // Cancel any pending update
    if (rafId.current) cancelAnimationFrame(rafId.current);
    
    rafId.current = requestAnimationFrame(() => {
      if (!contentRef.current) return;
      const rect = contentRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        api.browserShow({
          x: Math.round(Math.max(0, rect.left)),
          y: Math.round(Math.max(36, rect.top)),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    });
  }, [isActive, api]);
  
  // Debounced version for scroll events
  const debouncedUpdate = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(updateBrowserBounds, 100);
  }, [updateBrowserBounds]);

  // Show browser viewport when panel mounts
  useEffect(() => {
    if (!api?.browserNavigate) return;

    // Helper to force-show BrowserView at correct bounds with polling fallback
    const forceShow = () => {
      if (contentRef.current && api.browserShow) {
        const rect = contentRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          api.browserShow({
            x: Math.round(Math.max(0, rect.left)),
            y: Math.round(Math.max(36, rect.top)),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
          return true;
        }
      }
      return false;
    };

    // Polling show — reduced attempts and faster initial checks
    const pollShow = (maxAttempts = 5, interval = 50) => {
      let attempt = 0;
      const tryShow = () => {
        attempt++;
        if (forceShow()) return; // Success
        if (attempt < maxAttempts) {
          requestAnimationFrame(() => setTimeout(tryShow, interval));
        }
      };
      requestAnimationFrame(tryShow);
    };

    // Check if browser already has a page loaded (e.g., switching back to browser tab)
    const restoreOrActivate = async () => {
      try {
        const s = await api.browserGetState();
        if (s && s.url && s.url !== '' && s.url !== 'about:blank') {
          // BrowserView already has a page — just show it, don't re-navigate
          setUrl(s.url);
          setUrlInput(s.url);
          setState(s);
          setIsActive(true);
          // Poll until bounds are valid (reduced polling)
          pollShow(5, 50);
        } else {
          activateBrowser();
        }
      } catch {
        activateBrowser();
      }
    };

    restoreOrActivate();
    return () => { api.browserHide?.(); };
  }, []);

  // Listen for browser-restore event (sent after menu closes, window regains focus)
  useEffect(() => {
    const handleRestore = () => {
      if (isActive && contentRef.current && api?.browserShow) {
        const rect = contentRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          api.browserShow({
            x: Math.round(Math.max(0, rect.left)),
            y: Math.round(Math.max(36, rect.top)),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
    };
    const cleanup = api?.onBrowserRestore?.(handleRestore);
    return () => {
      if (typeof cleanup === 'function') cleanup();
      api?.removeListener?.('browser-restore', handleRestore);
    };
  }, [isActive, api]);

  // Listen for browser state changes from AI-driven navigation (URL bar + title sync)
  useEffect(() => {
    if (!api?.onBrowserStateChanged) return;
    const handleStateChange = (newState: BrowserState) => {
      if (newState.url) {
        setUrl(newState.url);
        setUrlInput(newState.url);
      }
      setState(prev => ({
        ...prev,
        url: newState.url || prev.url,
        title: newState.title || prev.title,
        canGoBack: newState.canGoBack ?? prev.canGoBack,
        canGoForward: newState.canGoForward ?? prev.canGoForward,
        isLoading: newState.isLoading ?? prev.isLoading,
        isVisible: prev.isVisible,
      }));
    };
    const cleanup = api.onBrowserStateChanged(handleStateChange);
    return () => {
      if (typeof cleanup === 'function') cleanup();
      api?.removeListener?.('browser-state-changed', handleStateChange);
    };
  }, [api]);

  // Hide BrowserView when ANY overlay/modal is active (theme picker, command palette, dropdowns, etc.)
  useEffect(() => {
    if (!isActive) return;
    const handleOverlayShow = () => { api?.browserHide?.(); };
    const handleOverlayHide = () => {
      if (contentRef.current && api?.browserShow) {
        const rect = contentRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          api.browserShow({
            x: Math.round(Math.max(0, rect.left)),
            y: Math.round(Math.max(36, rect.top)),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }
    };
    window.addEventListener('browser-overlay-show', handleOverlayShow);
    window.addEventListener('browser-overlay-hide', handleOverlayHide);
    return () => {
      window.removeEventListener('browser-overlay-show', handleOverlayShow);
      window.removeEventListener('browser-overlay-hide', handleOverlayHide);
    };
  }, [isActive, api]);

  // Update BrowserView bounds when panel resizes or becomes active
  useEffect(() => {
    if (!isActive || !contentRef.current) return;
    
    // Initial bounds (immediate)
    requestAnimationFrame(updateBrowserBounds);
    
    // Watch for resize with throttling
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(updateBrowserBounds);
    });
    observer.observe(contentRef.current);
    
    // Debounced window events to prevent scroll lag
    window.addEventListener('resize', debouncedUpdate);
    window.addEventListener('layout-resize', debouncedUpdate);
    window.addEventListener('scroll', debouncedUpdate, { passive: true });
    
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', debouncedUpdate);
      window.removeEventListener('layout-resize', debouncedUpdate);
      window.removeEventListener('scroll', debouncedUpdate);
      if (rafId.current) cancelAnimationFrame(rafId.current);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [isActive, updateBrowserBounds, debouncedUpdate]);

  const activateBrowser = async () => {
    try {
      await api.browserNavigate(url);
      setIsActive(true);
      // Give the BrowserView keyboard focus so Enter/typing works inside it
      api.browserFocus?.();

      // Quick poll for valid bounds with RAF
      let attempts = 0;
      const tryShow = () => {
        attempts++;
        if (contentRef.current && api.browserShow) {
          const rect = contentRef.current.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            api.browserShow({
              x: Math.round(Math.max(0, rect.left)),
              y: Math.round(Math.max(36, rect.top)),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            });
            return;
          }
        }
        if (attempts < 5) requestAnimationFrame(() => setTimeout(tryShow, 50));
      };
      requestAnimationFrame(() => setTimeout(tryShow, 20));

      refreshState();
    } catch (e) {
      console.error('Browser activation failed:', e);
    }
  };

  const refreshState = useCallback(async () => {
    try {
      const s = await api.browserGetState();
      setState(s);
      if (s.url) setUrlInput(s.url);
    } catch (e) {}
  }, [api]);

  const navigate = useCallback(async () => {
    let navUrl = urlInput.trim();
    if (!navUrl) return;
    if (!navUrl.startsWith('http://') && !navUrl.startsWith('https://')) {
      if (navUrl.includes('.') && !navUrl.includes(' ')) navUrl = 'https://' + navUrl;
      else navUrl = `https://www.google.com/search?q=${encodeURIComponent(navUrl)}`;
    }
    setUrl(navUrl);
    setScreenshot(null);
    setPageContent(null);
    try {
      const result = await api.browserNavigate(navUrl);
      if (result.success) {
        refreshState();
        updateBrowserBounds();
        // Keep keyboard focus in BrowserView after navigation
        api.browserFocus?.();
      }
    } catch (e) {}
  }, [urlInput, api, refreshState, updateBrowserBounds]);

  const goBack = async () => { await api.browserGoBack(); refreshState(); };
  const goForward = async () => { await api.browserGoForward(); refreshState(); };
  const reload = async () => { await api.browserReload(); refreshState(); };

  const takeScreenshot = async () => {
    try {
      const result = await api.browserScreenshot();
      if (result.success && result.dataUrl) {
        api.browserHide?.(); // Hide overlay so screenshot is visible
        setScreenshot(result.dataUrl);
      }
    } catch (e) {}
  };

  const readPage = async () => {
    try {
      const result = await api.browserGetContent('body', false);
      if (result.success) {
        api.browserHide?.(); // Hide overlay so content is visible
        setPageContent(result.content || '');
      }
    } catch (e) {}
  };

  const openExternal = () => {
    if (state.url) api.browserLaunchExternal(state.url);
  };

  return (
    <div ref={panelRef} className="flex flex-col h-full w-full min-w-0 overflow-hidden bg-[#1e1e1e]" onContextMenu={(e) => e.preventDefault()}>
      {/* Navigation Bar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-[#2d2d2d] border-b border-[#1e1e1e] flex-shrink-0">
        <button onClick={goBack} disabled={!state.canGoBack} className="p-1 hover:bg-[#3c3c3c] rounded disabled:opacity-30" title="Back">
          <ArrowLeft size={14} />
        </button>
        <button onClick={goForward} disabled={!state.canGoForward} className="p-1 hover:bg-[#3c3c3c] rounded disabled:opacity-30" title="Forward">
          <ArrowRight size={14} />
        </button>
        <button onClick={reload} className="p-1 hover:bg-[#3c3c3c] rounded" title="Reload">
          <RotateCw size={14} className={state.isLoading ? 'animate-spin' : ''} />
        </button>
        <form
          className="flex-1 flex"
          onSubmit={(e) => { e.preventDefault(); navigate(); }}
        >
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="flex-1 bg-[#3c3c3c] text-[#cccccc] text-[12px] px-2 py-0.5 rounded border border-[#3c3c3c] focus:border-[#007acc] outline-none"
            placeholder="Enter URL or search..."
          />
        </form>
        <button onClick={takeScreenshot} className="p-1 hover:bg-[#3c3c3c] rounded" title="Screenshot">
          <Camera size={14} />
        </button>
        <button onClick={readPage} className="p-1 hover:bg-[#3c3c3c] rounded" title="Read Page Content">
          <Code size={14} />
        </button>
        <button onClick={openExternal} className="p-1 hover:bg-[#3c3c3c] rounded" title="Open in Chrome">
          <ExternalLink size={14} />
        </button>
      </div>

      {/* Content Area - BrowserView overlays this div when active */}
      <div ref={contentRef} className="flex-1 overflow-auto bg-[#1e1e1e] min-h-0 relative">
        {!isActive ? (
          <div className="flex flex-col items-center justify-center h-full text-[#858585]">
            <Globe size={48} className="mb-4 opacity-30" />
            <p className="text-[13px]">Browser not active</p>
            <button onClick={activateBrowser} className="mt-4 bg-[#007acc] text-white text-[12px] px-4 py-1.5 rounded hover:bg-[#006bb3]">
              Open Browser
            </button>
          </div>
        ) : screenshot ? (
          <div className="p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-[#858585]">Screenshot</span>
              <button onClick={() => { setScreenshot(null); updateBrowserBounds(); api.browserShow?.(); }} className="text-[11px] text-[#007acc] hover:underline">
                Close & Show Live
              </button>
            </div>
            <img src={screenshot} alt="Page screenshot" className="w-full rounded border border-[#3c3c3c]" />
          </div>
        ) : pageContent !== null ? (
          <div className="p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-[#858585]">Page Content — {state.title}</span>
              <button onClick={() => { setPageContent(null); updateBrowserBounds(); api.browserShow?.(); }} className="text-[11px] text-[#007acc] hover:underline">
                Close & Show Live
              </button>
            </div>
            <pre className="text-[11px] font-mono text-[#cccccc] whitespace-pre-wrap bg-[#2d2d2d] p-3 rounded border border-[#3c3c3c] max-h-[800px] overflow-auto">
              {pageContent}
            </pre>
          </div>
        ) : (
          /* Transparent area - BrowserView renders on top of this */
          <div className="h-full w-full" />
        )}
      </div>

      {/* Status */}
      <div className="h-[22px] flex items-center px-2 bg-[#252526] border-t border-[#1e1e1e] text-[11px] text-[#858585] flex-shrink-0">
        {state.isLoading ? (
          <span className="text-[#dcdcaa]">Loading...</span>
        ) : (
          <span className="truncate">{state.title || 'Ready'}</span>
        )}
      </div>
    </div>
  );
};
