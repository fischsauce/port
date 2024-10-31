import {Handler, HandlerEntry} from '../server/ipc';
import { ipcRenderer as ipc} from 'electron'

export interface OSHandlers {
    'quit': OSService['quit'];
    'get-directory': OSService['getDirectory'];
    'get-file': OSService['getFile'];
    'set-title': OSService['setTitle'];
    'clear-data': OSService['clearData'];
    'toggle-dev-tools': OSService['toggleDevTools'];
    'create-view': OSService['createView'];
    'update-view-bounds': OSService['updateViewBounds'];
    'remove-view': OSService['removeView'];
    'install-updates': OSService['installUpdates'];
}

export class OSService {
    handlers(): HandlerEntry<OSHandlers>[] {
        return [
            { name: 'quit', handler: this.quit.bind(this) as Handler},
            { name: 'get-directory', handler: this.getDirectory.bind(this) as Handler},
            { name: 'get-file', handler: this.getFile.bind(this) as Handler},
            { name: 'set-title', handler: this.setTitle.bind(this) as Handler},
            { name: 'clear-data', handler: this.clearData.bind(this) as Handler},
            { name: 'toggle-dev-tools', handler: this.toggleDevTools.bind(this) as Handler },
            { name: 'create-view', handler: this.createView.bind(this)  as Handler},
            { name: 'update-view-bounds', handler: this.updateViewBounds.bind(this)  as Handler},
            { name: 'remove-view', handler: this.removeView.bind(this)  as Handler},
            { name: 'install-updates', handler: this.installUpdates.bind(this)  as Handler}
        ]
    }

    async quit(): Promise<void> {
        await ipc.invoke('quit')
    }

    async getDirectory(options: Electron.OpenDialogOptions): Promise<string | undefined> {
        const result = await ipc.invoke('open-dialog', {
            ...options,
            title: 'Select a Directory',
            properties: ['openDirectory', 'createDirectory']
        });

        if (result.canceled)
            return undefined;

        const directory = result.filePaths[0];
        console.log(`opening directory ${directory}`)
        return directory;
    }

    async getFile(options: Electron.OpenDialogOptions): Promise<string | undefined> {
        const result = await ipc.invoke('open-dialog', {
            ...options,
            title: 'Select a File',
            properties: ['openFile']
        });

        if (result.canceled)
            return undefined;

        const file = result.filePaths[0];
        console.log(`opening file ${file}`)
        return file;
    }

    async setTitle(title: string): Promise<string> {
        await ipc.invoke('set-title', title)

        return title;
    }

    async clearData(): Promise<void> {
        await ipc.invoke('clear-data')
    }

    async toggleDevTools(): Promise<void> {
        await ipc.invoke('toggle-dev-tools')
    }

    async createView(data: ViewData): Promise<void> {
        const result = await ipc.invoke('create-view', data);

        if (result.error) {
            throw new Error(result.error)
        }
    }

    async updateViewBounds(data: ViewData): Promise<void> {
        await ipc.invoke('update-view-bounds', data);
    }

    async removeView(url: string): Promise<void> {
        await ipc.invoke('remove-view', url);
    }

    async installUpdates(): Promise<void> {
        await ipc.invoke('install-updates');
    }
}

export interface ViewData {
    url: string;
    ship: string;
    code: string;
    openLink?: string;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    }
}

