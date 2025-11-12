"use strict";

import {
    AlbumResponseDto,
    addAssetsToAlbum,
    getAssetsByOriginalPath,
    getUniqueOriginalPaths,
    init,
} from "@immich/sdk";
import { LibraryScanConfig, loadConfig } from './config.js';
import {
    AlbumsIndex,
    addOriginalPathToAlbum,
    createManagedAlbum,
    findAllManagedAlbums,
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
    const startTime = Date.now();

    const { path, apiKey} = extLibraryScanParams;

    init({ baseUrl: "http://immich_server:2283/api", apiKey });

    console.info(`Processing external library: '${path}' ...`);

    // Do not `await` to let this request run in background and queue more work in the meantime.
    const existingAlbumsFuture = findAllManagedAlbums();

    const allFolders = (await getUniqueOriginalPaths()).filter((it) => it.startsWith(path));
    const batchSize = 100;
    console.info(`Processing ${allFolders.length} folders in batches of ${batchSize} ...`);

    const existingAlbums = await existingAlbumsFuture;
    const albumsExisted = existingAlbums.size;

    let foldersProcessed = 0, foldersIgnored = 0, albumsCreated = 0, assetsProcessed = 0, assetsAdded = 0, assetsDuplicate = 0, assetsFailed = 0;
    for (const batch of splitIntoBatches(allFolders, batchSize)) {
        // 1.  Split into batches and process batches sequentially to avoid running out of memory
        //     when grouping all original folders by the their desired album names.
        // 2.  Avoid the race condition caused by processing multiple folders mapping to the same album name in parallel
        //     by grouping such folders together and processing folders in each such group in a sequence
        //     (while still processing independent folders mapping to different albums in parallel).
        const foldersWithDesiredAlbumNames = batch.map(folder => [composeAlbumName(path, folder), folder])
            .filter(([desiredAlbumName, folder]) => !!desiredAlbumName) as [string, string][];
        foldersIgnored += batch.length - foldersWithDesiredAlbumNames.length;

        const desiredAlbumsWithFolders = foldersWithDesiredAlbumNames.reduce(
            (acc, [desiredAlbumName, folder]) => {
                (acc[desiredAlbumName] = acc[desiredAlbumName] || []).push(folder);
                return acc;
            },
            {} as Record<string, string[]>
        );

        await Promise.all(Object.entries(desiredAlbumsWithFolders).map(async ([desiredAlbumName, folders]) => {
            for (const folder of folders) {
                const [album, created] = await createOrUpdateAlbum(folder, desiredAlbumName, existingAlbums);
                existingAlbums.put(album);
                if (created) albumsCreated++;

                const {processed, added, duplicate, failed} = await addFolderAssetsToAlbum(folder, album);
                assetsProcessed += processed;
                assetsAdded += added;
                assetsDuplicate += duplicate;
                assetsFailed += failed;

                foldersProcessed++;
            }
        }));
    }

    // TODO: clean up albums if all associated original folders were removed.

    const timeElapsed = Date.now() - startTime;
    console.info(`Finished processing external library: ${path}
Statistics:
- Time elapsed: ${(0.001 * timeElapsed).toFixed(1)}s
- ${allFolders.length} original folders found: ${foldersProcessed} processes & ${foldersIgnored} ignored
- ${existingAlbums.size} managed albums exist in total: ${albumsExisted} existed previously, ${albumsCreated} created
- ${assetsProcessed} assets processed: ${assetsAdded} added to managed albums, ${assetsDuplicate} already were in the appropriate albums, ${assetsFailed} could not be added to the appropriate albums
`);
}

function* splitIntoBatches<Elem>(array: Elem[], batchSize: number): Generator<Elem[]> {
    let nextBatchStart = 0;
    for (let batchStart = 0; batchStart < array.length; batchStart += batchSize) {
        nextBatchStart = batchStart + batchSize;
        yield array.slice(batchStart, nextBatchStart);
    }
}

async function createOrUpdateAlbum(
    folder: string,
    desiredAlbumName: string,
    existingAlbums: AlbumsIndex
): Promise<[AlbumResponseDto, boolean]> {
    const existingAlbum = existingAlbums.findByOriginalPath(folder)
        || existingAlbums.findByName(desiredAlbumName);

    if (existingAlbum) {
        console.info(`[${folder}] Use existing album '${existingAlbum.albumName}'`);
        return [await addOriginalPathToAlbum(existingAlbum, folder), false];
    } else {
        console.info(`[${folder}] Create new album '${desiredAlbumName}'`);
        return [await createManagedAlbum(desiredAlbumName, [folder]), true];
    }
}

function composeAlbumName(libraryPath: string, folder: string): string|undefined {
    // Note: this will likely not work on Windows.
    const relativePath = folder.replace(libraryPath, '').replace(/^\//, '');
    if (relativePath === '') {
        console.info(`Ignore assets in the library root folder`);
        return;
    }

    const pathElements = relativePath.split('/');
    // Remove leading date & time if any.
    const albumName = pathElements[0].replace(/^\d{4}-\d{2}-\d{2}[\d\s\.-]*/, '');

    if (albumName === '') {
        console.info(`Skip '${folder}': the folder name lacks sufficient context to infer an album name`)
        return;
    }

    return albumName;
}

// Add all assets from the specified folder to the specified album.
async function addFolderAssetsToAlbum(folder: string, album: AlbumResponseDto): Promise<{processed: number, added: number, duplicate: number, failed: number}> {
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

    return {processed: assets.length, added: numAdded, duplicate: numDuplicates, failed: failedToAdd.length};
}
