"use strict";

import fs from 'node:fs/promises';
import {
    addAssetsToAlbum,
    createAlbum,
    getAllAlbums,
    getAssetsByOriginalPath,
    getUniqueOriginalPaths,
    init,
    updateAlbumInfo
} from "@immich/sdk";

const ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER = '-- Original Paths --';

const usersWithLibraries = JSON.parse(await fs.readFile("/ext_library_folders_to_albums", { encoding: 'utf8' }));

// Process the array elements sequentially rather than in parallel.
usersWithLibraries.reduce(
    (acc, curr) => acc.then(async () => createUpdateDeleteAlbums(curr)),
    Promise.resolve(null)
)

async function createUpdateDeleteAlbums(externalLibraryParams) {
    const { path, apiKey} = externalLibraryParams;

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
            console.info(`[${folder}] Adding ${assets.length} assets into album '${album.albumName}' ...`);

            const results = await addAssetsToAlbum({
                id: album.id,
                bulkIdsDto: {ids: assets.map((it) => it.id)}
            });

            const numAdded = results.filter(it => it.success).length;
            const numDuplicates = results.filter(it => !it.success && it.error === 'duplicate').length;
            const failedToAdd = results.filter(it => !it.success && it.error !== 'duplicate');

            console.info(`[${folder}] Added ${numAdded} assets into album '${album.albumName}', ${numDuplicates} were already in the album`);
            if (failedToAdd.length > 0) {
                console.info(`[${folder}] Failed to add ${failedToAdd.length} assets into album '${album.albumName}':
- ${failedToAdd.map(it => `${it.id}: ${it.error}`).join('\n- ')}`);
            }
        }
    }));

    console.info(`Finished processing external library: ${path}`);
}

async function createOrUpdateAlbum(libraryPath, folder, existingAlbums) {
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
        await addOriginalPathToAlbumDescription(existingAlbum, folder);
        return existingAlbum;
    } else {
        console.info(`[${folder}] Create new album '${albumName}'`);
        const newAlbum = await createAlbum({createAlbumDto: {
            albumName,
            description: `${ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER}\n${folder}`
        }});
        return newAlbum;
    }
}

function composeAlbumName(relativePath) {
    const pathElements = relativePath.split('/');
    // Remove leading date & time if any.
    return pathElements[0].replace(/^\d{4}-\d{2}-\d{2}[\d\s\.-]*/, '');
}

function findAlbumByOriginalPath(existingAlbums, originalPath) {
    existingAlbums.find(album => {
        return album.description.indexOf(originalPath) !== -1
            && getOriginalPaths(album).includes(originalPath)
    });
}

function findManagedAlbumByName(existingAlbums, albumName) {
    return existingAlbums.find(album => {
        return album.albumName === albumName
            && album.description.indexOf(ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER) !== -1
    });
}

function getOriginalPaths(album) {
    const headerStart = album.description.indexOf(ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER);
    if (headerStart === -1) {
        return [];
    } else {
        const pathsStr = album.description.substring(headerStart + ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER.length).trim();
        return pathsStr.split('\n');
    }
}

async function addOriginalPathToAlbumDescription(album, originalPath) {
    const headerStart = album.description.indexOf(ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER);
    const originalPaths = Array.from(new Set(getOriginalPaths(album).concat([originalPath]))).sort();

    await updateAlbumInfo({
        id: album.id,
        updateAlbumDto: {
            description: `${album.description.substring(0, headerStart)}${ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER}
${originalPaths.join('\n')}`
        }
    });
}
