import fs from 'node:fs/promises';

export type LibraryScanConfig = {
    path: string;
    apiKey: string;
};

export async function loadConfig(): Promise<LibraryScanConfig[]> {
    return JSON.parse(await fs.readFile("/ext_library_folders_to_albums", { encoding: 'utf8' }));
}
