import { AlbumResponseDto, createAlbum, getAllAlbums, updateAlbumInfo } from "@immich/sdk";

const ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER = '-- Original Paths --';

export class AlbumsIndex {
    private readonly byId: Map<string, AlbumResponseDto>;
    private readonly byName: Map<string, AlbumResponseDto[]>;

    constructor(albums: AlbumResponseDto[]) {
        this.byId = new Map(albums.map(album => [album.id, album]));

        this.byName = albums.reduce(
            (acc, album) => {
                const similarlyNamedAlbums = acc.get(album.albumName);
                if (similarlyNamedAlbums) {
                    similarlyNamedAlbums.push(album);
                } else {
                    acc.set(album.albumName, [album]);
                }

                return acc;
            },
            new Map() as Map<string, AlbumResponseDto[]>);
    }

    get size(): number {
        return this.byId.size;
    }

    findByName(albumName: string): AlbumResponseDto | undefined {
        const similarlyNamedAlbums = this.byName.get(albumName);
        return similarlyNamedAlbums ? similarlyNamedAlbums[0] : undefined;
    }

    /**
     * Find an album claiming to contain assets from the specified original path (according to the metadata embedded into its description).
     * @param {string} originalPath - Original assets folder path.
     * @returns {object|undefined} - The found album object, or `undefined` if not found.
     */
    findByOriginalPath(originalPath: string) {
        return this.byId.values().find(album => {
            return album.description.indexOf(originalPath) !== -1
                && getOriginalPaths(album).includes(originalPath)
        });
    }

    put(album: AlbumResponseDto) {
        this.byId.set(album.id, album);

        const similarlyNamedAlbums = this.byName.get(album.albumName);
        if (similarlyNamedAlbums) {
            const existingIndex = similarlyNamedAlbums.findIndex(it => it.id === album.id);
            if (existingIndex !== -1) {
                similarlyNamedAlbums[existingIndex] = album;
            } else {
                similarlyNamedAlbums.push(album);
            }
        } else {
            this.byName.set(album.albumName, [album]);
        }
    }
}

export async function findAllManagedAlbums(): Promise<AlbumsIndex> {
    const allAlbums = await getAllAlbums({shared: false});
    return new AlbumsIndex(
        allAlbums.filter(album => album.description.indexOf(ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER) !== -1)
    );
}

/**
 * Create a new album for assets stored in the specified folders.
 * @param {string} albumName - The name of the album to create.
 * @param {array} originalPaths - Array of original assets folder paths.
 * @returns {object} - The created album object.
 */
export async function createManagedAlbum(albumName: string, originalPaths: string[]) {
    return createAlbum({createAlbumDto: {
        albumName,
        description: composeAlbumDescription(originalPaths)
    }});
}

/**
 * Update the album's metadata to indicate that it will contain assets from the specified folder.
 * @param {AlbumResponseDto} album - The album object (returned by Immich SDK).
 * @param {string} originalPath - Original assets folder path to add.
 * @returns {AlbumResponseDto} - New album object reflecting updated metadata.
 */
export async function addOriginalPathToAlbum(album: AlbumResponseDto, originalPath: string): Promise<AlbumResponseDto> {
    const headerStart = album.description.indexOf(ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER);
    const descriptionPrefix = headerStart === -1 ? `${album.description}\n` : album.description.substring(0, headerStart);

    const originalPaths = Array.from(new Set(getOriginalPaths(album).concat([originalPath]))).sort();

    return updateAlbumInfo({
        id: album.id,
        updateAlbumDto: {
            description: `${descriptionPrefix}${composeAlbumDescription(originalPaths)}`
        }
    });
}

/**
 * Get the list of original asset folder paths from the album's metadata.
 * @param {AlbumResponseDto} album - The album object (returned by Immich SDK).
 * @returns {array} - Array of original assets folder paths.
 */
function getOriginalPaths(album: AlbumResponseDto): string[] {
    const headerStart = album.description.indexOf(ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER);
    if (headerStart === -1) {
        return [];
    } else {
        const pathsStr = album.description.substring(headerStart + ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER.length).trim();
        return pathsStr.split('\n');
    }
}

function composeAlbumDescription(originalPaths: string[]): string {
    return `${ALBUM_DESCRIPTION_ORIGINAL_PATHS_HEADER}
${originalPaths.join('\n')}`;
}
