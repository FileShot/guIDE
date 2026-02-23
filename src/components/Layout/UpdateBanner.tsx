/**
 * guIDE — AI-Powered Offline IDE
 * Copyright (c) 2025-2026 Brendan Gray (GitHub: FileShot)
 * All Rights Reserved. See LICENSE for terms.
 */
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

/**
 * Banner shown when a new version has been downloaded and is ready to install.
 * Appears as a slim persistent bar at the bottom of the window.
 * The user can dismiss it or click "Restart" to apply the update immediately.
 */
const UpdateBanner: React.FC = () => {
  const [downloadedInfo, setDownloadedInfo] = useState<UpdateInfo | null>(null);
  const [availableInfo, setAvailableInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    const cleanupAvailable = api.onUpdateAvailable?.((info: UpdateInfo) => {
      setAvailableInfo(info);
    });

    const cleanupDownloaded = api.onUpdateDownloaded?.((info: UpdateInfo) => {
      setDownloadedInfo(info);
      setDismissed(false); // Re-show if previously dismissed when available was shown
    });

    return () => {
      cleanupAvailable?.();
      cleanupDownloaded?.();
    };
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await (window as any).electronAPI?.installUpdate?.();
    } catch {
      setInstalling(false);
    }
  };

  // Prefer showing the "ready to install" banner over the "downloading" notice
  if (dismissed || (!downloadedInfo && !availableInfo)) return null;

  const isReady = !!downloadedInfo;
  const info = downloadedInfo ?? availableInfo!;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        backgroundColor: isReady ? '#1a6b3a' : '#1a4a6b',
        color: '#e8f5e9',
        fontSize: '13px',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.4)',
        gap: '12px',
      }}
    >
      <span style={{ flex: 1 }}>
        {isReady
          ? `guIDE ${info.version} downloaded — restart to apply the update`
          : `Downloading guIDE ${info.version}…`}
      </span>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
        {isReady && (
          <button
            onClick={handleInstall}
            disabled={installing}
            style={{
              padding: '4px 12px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#4caf50',
              color: '#fff',
              fontWeight: 600,
              fontSize: '12px',
              cursor: installing ? 'not-allowed' : 'pointer',
              opacity: installing ? 0.7 : 1,
            }}
          >
            {installing ? 'Restarting…' : 'Restart Now'}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          style={{
            padding: '4px',
            borderRadius: '4px',
            border: '1px solid rgba(255,255,255,0.3)',
            backgroundColor: 'transparent',
            color: '#e8f5e9',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default UpdateBanner;
