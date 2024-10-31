import { BrowserWindow, dialog, Event, BrowserWindowConstructorOptions, WebContents, nativeTheme, app, ipcMain, Session } from 'electron';
import windowStateKeeper from 'electron-window-state';
import isDev from 'electron-is-dev';

import {
  isOSX,
  nativeTabsSupported,
  onNavigation,
  onNewWindowHelper,
  URBIT_PROTOCOL
} from './helpers';
import { initContextMenu } from './context-menu';
import { start as osHelperStart, views } from './os-service-helper'
import { start as settingsHelperStart } from './setting-service-helper'
import { start as terminalServiceStart } from './terminal-service';
import { Settings } from '../background/db';
import { Pier } from '../background/services/pier-service';
import { getPlatform } from '../get-platform';
import { Cleanup } from './cleanup';

declare const LANDSCAPE_PRELOAD_WEBPACK_ENTRY: string;
const ZOOM_INTERVAL = 0.1;

let piers: Pier[];

ipcMain.handle('piers', (event, data) => {
  piers = data;
})

function getWindowOrViewContents(focusedWindow: BrowserWindow): WebContents {
  const view = focusedWindow.getBrowserView();
  return view ? view.webContents : focusedWindow.webContents;
}

export function updateZoomLevels(mainWindow: BrowserWindow) {
  if (!isDev) {
    return;
  }

  const main = Math.trunc(mainWindow.webContents.zoomFactor * 10) / 10;
  let viewLevels;
  views.forEach(view => {
    viewLevels.push(Math.trunc(view.webContents.zoomFactor * 10) / 10)
  })
  mainWindow.webContents.send('zoom-levels', {
    main,
    views: viewLevels.join()
  })
}

function adjustZoom(mainWindow: BrowserWindow, adjuster: (contents: WebContents) => void): void {
    const focusedWindow = BrowserWindow.getFocusedWindow();

    if (focusedWindow == null) return;

    const view = focusedWindow.getBrowserView();
    
    if (focusedWindow === mainWindow && view) {
      adjuster(view.webContents);
    }

    adjuster(focusedWindow.webContents);
}

export function createMainWindow(
  mainUrl: string,
  socketName: string,
  onAppQuit: () => void,
  cleanup: Cleanup,
  bgWindow?: BrowserWindow,
): BrowserWindow {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1280,
    defaultHeight: 800,
  });

  const DEFAULT_WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
    // Convert dashes to spaces because on linux the app name is joined with dashes
    title: 'Port',
    //tabbingIdentifier: nativeTabsSupported() ? 'port' : undefined,
    webPreferences: {
      javascript: true,
      plugins: true,
      zoomFactor: 1,
      preload: LANDSCAPE_PRELOAD_WEBPACK_ENTRY
    },
  };

  const mainWindow = new BrowserWindow({
    ...DEFAULT_WINDOW_OPTIONS,
    width: mainWindowState.width,
    height: mainWindowState.height,
    titleBarStyle: getPlatform() === 'mac' ? 'hidden' : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#FFFFFF',
    //icon: getAppIcon(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindowState.manage(mainWindow);

  const withFocusedView = <T>(block: (contents: WebContents) => T | undefined, target: 'window' | 'view' = 'view'): T | undefined => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      const windowContents = focusedWindow.webContents;
      const windowOrViewContents = getWindowOrViewContents(focusedWindow);
      return target === 'window' ? block(windowContents) : block(windowOrViewContents);
    }
    return undefined;
  };

  const onZoomIn = (): void => {
    adjustZoom(mainWindow, (contents) => {
      contents.zoomFactor += ZOOM_INTERVAL;
    })
    updateZoomLevels(mainWindow);
  };

  const onZoomOut = (): void => {
    adjustZoom(mainWindow, (contents) => {
      contents.zoomFactor += -ZOOM_INTERVAL;
    })
    updateZoomLevels(mainWindow);
  };

  const onZoomReset = (): void => {
    adjustZoom(mainWindow, (contents) => {
      contents.zoomFactor = 1;
    })
    updateZoomLevels(mainWindow);
  };

  const clearAppData = async (): Promise<void> => {
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Yes', 'Cancel'],
      defaultId: 1,
      title: 'Clear cache confirmation',
      message:
        'This will clear all data (cookies, local storage etc) from this app. Are you sure you wish to proceed?',
    });

    if (response.response !== 0) {
      return;
    }
    await clearCache(mainWindow);
  };

  const onGoBack = (): void => {
    withFocusedView((contents) => {
      contents.goBack();
    });
  };

  const onGoForward = (): void => {
    withFocusedView((contents) => {
      contents.goForward();
    });
  };

  const getCurrentUrl = (): string =>
    <string>withFocusedView((contents) => contents.getURL());

  const onWillNavigate = (event: Event, webContents: WebContents, urlTarget: string): void => {
    isDev && console.log('will-navigate', urlTarget)
    onNavigation({
      urlTarget: urlTarget,
      currentUrl: webContents.getURL(),
      preventDefault: event.preventDefault,
      createNewWindow: null,
      mainWindow: mainWindow,
      partition: undefined
    })
  };

  const createNewWindow = (url: string, partition?: string | Session): BrowserWindow => {
    isDev && console.log('creating new window', url, partition);
    const isSession = typeof partition === 'object';
    const window = new BrowserWindow({
      ...DEFAULT_WINDOW_OPTIONS,
      webPreferences: {
        ...DEFAULT_WINDOW_OPTIONS.webPreferences,
        partition: isSession ? undefined : partition,
        session: isSession ? partition : undefined
      }
    });

    window.webContents.setWindowOpenHandler(onNewWindow(url, partition));
    window.webContents.on('will-navigate', (e, url) => onWillNavigate(e, window.webContents, url));
    window.webContents.on('did-finish-load', () => {
      configureWindowTitle(window)
      console.log('finished load')
    })
    window.webContents.loadURL(url);
    return window;
  };

  const configureWindowTitle = (window: BrowserWindow) => {
    mainWindow.webContents.send('current-ship')
    ipcMain.on('current-ship', (_, { shouldDisplay, displayName }: { shouldDisplay: boolean, displayName: string}) => {
      ipcMain.removeAllListeners('current-ship')

      if (!shouldDisplay || !displayName) {
        return
      }

      const titlePrefix = ` (${displayName})`
      window.setTitle(`${window.webContents.getTitle()}${titlePrefix}`)

      // webContents cannot detect in-page navigations (which may change the title), so we inject that behavior
      const setTitleScript = `
        new MutationObserver( () => {
            if (!document.title.includes("${displayName}")) {
              document.title = document.title + "${titlePrefix}"
            }
        }).observe(
            document.querySelector('title'),
            { subtree: true, characterData: true, childList: true }
        );
      `
      window.webContents.executeJavaScript(setTitleScript)
    })
  };

  const createAboutBlankWindow = (): BrowserWindow => {
    const window = createNewWindow('about:blank');
    window.hide();
    window.webContents.once('did-stop-loading', () => {
      if (window.webContents.getURL() === 'about:blank') {
        window.close();
      } else {
        window.show();
      }
    });
    return window;
  };

  const onNewWindow = (windowURL: string, partition?: string | Session) =>
  ({
    url,
    frameName,
    disposition
  }: Electron.HandlerDetails) => {
    isDev && console.log('on new window', windowURL, url, frameName, disposition);
    return onNewWindowHelper(
      url,
      windowURL,
      createAboutBlankWindow,
      createNewWindow,
      mainWindow,
      piers,
      partition,
    );
  };

  const handleProtocolLink = (url: string) => {
    const view = mainWindow.getBrowserViews()[0];
    if (!view) {
      mainWindow.webContents.send('protocol-link', url);
      return;
    }

    const currentUrl = view.webContents.getURL();
    console.log('deeplink', url, currentUrl);
    onNavigation({
      preventDefault: () => {}, //eslint-disable-line @typescript-eslint/no-empty-function
      urlTarget: url,
      currentUrl,
      mainWindow,
      createNewWindow
    })
  }

  const menuOptions = {
    appQuit: onAppQuit,
    zoomIn: onZoomIn,
    zoomOut: onZoomOut,
    zoomReset: onZoomReset,
    zoomBuildTimeValue: 1.0,
    goBack: onGoBack,
    goForward: onGoForward,
    getCurrentUrl,
    clearAppData,
    mainWindow,
    bgWindow,
    settings: {} as Record<Settings, string>
  };

  initContextMenu(
    createNewWindow,
    undefined, //nativeTabsSupported() ? createNewTab : undefined,
    mainUrl
  );

  mainWindow.webContents.setWindowOpenHandler(onNewWindow(mainUrl));
  mainWindow.webContents.on('will-navigate', (e, url) => onWillNavigate(e, mainWindow.webContents, url));
  mainWindow.webContents.on('did-start-loading', () => {
    const loadingUrl = mainWindow.webContents.getURL().split('#')[0]
    if (mainUrl === loadingUrl) {
      const view = mainWindow.getBrowserView();
      if (view) {
        view.webContents.reload();
      }
    }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    // Restore pinch-to-zoom, disabled by default in recent Electron.
    // See https://github.com/nativefier/nativefier/issues/379#issuecomment-598309817
    // and https://github.com/electron/electron/pull/12679
    mainWindow.webContents.setVisualZoomLevelLimits(1, 3);
  });
  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.webContents.send('set-socket', {
      name: socketName
    });
  })

  osHelperStart(mainWindow, createNewWindow, onNewWindow, bgWindow)
  settingsHelperStart({ mainWindow, menuOptions });
  terminalServiceStart();
  isDev && mainWindow.webContents.openDevTools();
  mainWindow.loadURL(mainUrl);

  mainWindow.on('close', (event) => {
    event.preventDefault();

    if (cleanup.started)
      return;

    if (mainWindow.isFullScreen()) {
      if (nativeTabsSupported()) {
        mainWindow.moveTabToNewWindow();
      }
      mainWindow.setFullScreen(false);
      mainWindow.once('leave-full-screen', () => isOSX() ? mainWindow.hide() : app.quit());
    } else {
      isOSX() ? mainWindow.hide() : app.quit();
    }
  });
  
  // Force single application instance
  const gotTheLock = app.requestSingleInstanceLock();
  
  if (!gotTheLock && !isDev) {
    app.quit();
    return;
  } else {
    app.on('second-instance', (e, argv) => {
      if (process.platform !== 'darwin') {
        console.log('handling protocol link');
        handleProtocolLink(argv.find((arg) => arg.startsWith(`${URBIT_PROTOCOL}://`)))
      }
  
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
    });
  }

  app.on('open-url', (event, url) => {
    console.log('handling protocol link', url);
    handleProtocolLink(url);
  })

  return mainWindow;
}

async function clearCache(browserWindow: BrowserWindow): Promise<void> {
  const { session } = browserWindow.webContents;
  await session.clearStorageData();
  await session.clearCache();
}