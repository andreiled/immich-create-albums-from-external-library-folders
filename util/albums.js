import { createAlbum, updateAlbumInfo } from "@immich/sdk";

const ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER = '-- Original Paths --';

/**
 * Create a new album for assets stored in the specified folders.
 * @param {string} albumName - The name of the album to create.
 * @param {array} originalPaths - Array of original assets folder paths.
 * @returns {object} - The created album object.
 */
export async function createManagedAlbum(albumName, originalPaths) {
    return createAlbum({createAlbumDto: {
        albumName,
        description: composeAlbumDescription(originalPaths)
    }});
}

/**
 * Update the album's metadata to indicate that it will contain assets from the specified folder.
 * @param {object} album - The album object (returned by Immich SDK).
 * @param {string} originalPath - Original assets folder path to add.
 */
export async function addOriginalPathToAlbum(album, originalPath) {
    const headerStart = album.description.indexOf(ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER);
    const originalPaths = Array.from(new Set(getOriginalPaths(album).concat([originalPath]))).sort();

    await updateAlbumInfo({
        id: album.id,
        updateAlbumDto: {
            description: `${album.description.substring(0, headerStart)}${composeAlbumDescription(originalPaths)}`
        }
    });
}

/**
 * Get the list of original asset folder paths from the album's metadata.
 * @param {object} album - The album object (returned by Immich SDK).
 * @returns {array} - Array of original assets folder paths.
 */
export function getOriginalPaths(album) {
    const headerStart = album.description.indexOf(ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER);
    if (headerStart === -1) {
        return [];
    } else {
        const pathsStr = album.description.substring(headerStart + ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER.length).trim();
        return pathsStr.split('\n');
    }
}

/**
 * Find an album claiming to contain assets from the specified original path (according to the metadata embedded into its description).
 * @param {array} albums - Array of album objects (returned by Immich SDK).
 * @param {string} originalPath - Original assets folder path.
 * @returns {object|undefined} - The found album object, or `undefined` if not found.
 */
export function findAlbumByOriginalPath(albums, originalPath) {
    albums.find(album => {
        return album.description.indexOf(originalPath) !== -1
            && getOriginalPaths(album).includes(originalPath)
    });
}

/**
 * Find an album created by this script, by its name.
 * @param {array} albums - Array of album objects (returned by Immich SDK).
 * @param {string} albumName - Expected album name.
 * @returns {object|undefined} - The found album object, or `undefined` if not found.
 */
export function findManagedAlbumByName(albums, albumName) {
    return albums.find(album => {
        return album.albumName === albumName
            && album.description.indexOf(ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER) !== -1
    });
}

function composeAlbumDescription(originalPaths) {
    return `${ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER}
${originalPaths.join('\n')}`;
}
