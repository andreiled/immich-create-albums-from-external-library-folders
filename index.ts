"use strict";

import {
    AlbumResponseDto,
    addAssetsToAlbum,
    getAllAlbums,
    getAssetsByOriginalPath,
    getUniqueOriginalPaths,
    init,
} from "@immich/sdk";
import { LibraryScanConfig, loadConfig } from './config.js';
import {
    addOriginalPathToAlbum,
    createManagedAlbum,
    findAlbumByOriginalPath,
    findManagedAlbumByName,
} from './util/albums.js';
import applyConsoleLogFormat from './util/console-log-format.js';

applyConsoleLogFormat();

const extLibrariesToScan = await loadConfig();

// Process the array elements sequentially rather than in parallel.
extLibrariesToScan.reduce(
    (acc, curr) => acc.then(async () => createUpdateDeleteAlbums(curr)),
    Promise.resolve()
)

async function createUpdateDeleteAlbums(extLibraryScanParams: LibraryScanConfig): Promise<void> {
    const { path, apiKey} = extLibraryScanParams;

    init({ baseUrl: "http://immich_server:2283/api", apiKey });

    console.info(`Processing external library: '${path}' ...`);

    // Do not `await` to let this request run in background and queue more work.
    const existingAlbumsFuture = getAllAlbums({shared: false});

    const allFolders = (await getUniqueOriginalPaths()).filter((it) => it.startsWith(path)).slice(0, 100);
    console.info(`Found ${allFolders.length} folders`);

    const existingAlbums = await existingAlbumsFuture;
    await Promise.all(allFolders.map(async (folder) => {
        const album = await createOrUpdateAlbum(path, folder, existingAlbums);
        if (album) {
            const assets = await getAssetsByOriginalPath({path: folder});
            console.info(`[${folder}] Adding ${assets.length} assets to album '${album.albumName}' ...`);

            const results = await addAssetsToAlbum({
                id: album.id,
                bulkIdsDto: {ids: assets.map((it) => it.id)}
            });

            const numAdded = results.filter(it => it.success).length;
            const numDuplicates = results.filter(it => !it.success && it.error === 'duplicate').length;
            const failedToAdd = results.filter(it => !it.success && it.error !== 'duplicate');

            console.info(`[${folder}] Added ${numAdded} assets to album '${album.albumName}', ${numDuplicates} were already in the album`);
            if (failedToAdd.length > 0) {
                console.info(`[${folder}] Failed to add ${failedToAdd.length} assets to album '${album.albumName}':
- ${failedToAdd.map(it => `${it.id}: ${it.error}`).join('\n- ')}`);
            }
        }
    }));

    console.info(`Finished processing external library: ${path}`);
}

async function createOrUpdateAlbum(libraryPath: string, folder: string, existingAlbums: AlbumResponseDto[]): Promise<AlbumResponseDto|undefined> {
    // Note: this will likely not work on Windows.
    const relativePath = folder.replace(libraryPath, '').replace(/^\//, '');
    if (relativePath === '') {
        console.info(`Skip assets in the library root folder`);
        return;
    }

    const albumName = composeAlbumName(relativePath);
    if (albumName === '') {
        console.info(`Skip '${folder}': the folder name lacks sufficient context to infer an album name`)
        return;
    }

    const existingAlbum = findAlbumByOriginalPath(existingAlbums, folder)
        || findManagedAlbumByName(existingAlbums, albumName);
    if (existingAlbum) {
        console.info(`[${folder}] Use existing album '${existingAlbum.albumName}'`);
        await addOriginalPathToAlbum(existingAlbum, folder);
        return existingAlbum;
    } else {
        console.info(`[${folder}] Create new album '${albumName}'`);
        return createManagedAlbum(albumName, [folder]);
    }
}

function composeAlbumName(relativePath: string): string {
    const pathElements = relativePath.split('/');
    // Remove leading date & time if any.
    return pathElements[0].replace(/^\d{4}-\d{2}-\d{2}[\d\s\.-]*/, '');
}
