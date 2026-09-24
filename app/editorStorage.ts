const DATABASE_NAME = "cutline-local-projects";
const DATABASE_VERSION = 2;
const PROJECT_STORE = "project";
const MEDIA_STORE = "media";
const CURRENT_PROJECT_KEY = "current";
const ARCHIVE_STORE = "projects";

export type PersistedAsset = {
  id: string;
  name: string;
  kind: "video" | "image" | "audio";
  duration: number;
  sizeLabel: string;
  theme: string;
  thumbnail?: string;
  waveform?: number[];
  waveformPeaks?: number[];
  width?: number;
  height?: number;
};

export type PersistedMedia = PersistedAsset & {
  blob: Blob;
};

type LegacyProject = {
  version: 1;
  updatedAt: number;
  projectName: string;
  ratio: string;
  assets: PersistedAsset[];
  clips: unknown[];
  texts: unknown[];
  audioClips: unknown[];
};
export type PersistedProject =
  | LegacyProject
  | (Omit<import("./editor/model").Project, "assets"> & {
      assets: PersistedAsset[];
      updatedAt: number;
    });

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE);
      }
      if (!database.objectStoreNames.contains(MEDIA_STORE)) {
        database.createObjectStore(MEDIA_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(ARCHIVE_STORE))
        database.createObjectStore(ARCHIVE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Could not open local project storage."),
      );
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Local storage transaction failed."),
      );
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new Error("Local storage transaction was cancelled."),
      );
  });
}

export async function saveMediaAsset(asset: PersistedMedia) {
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, "readwrite");
  transaction.objectStore(MEDIA_STORE).put(asset);
  await waitForTransaction(transaction);
  database.close();
}

export async function loadMediaAsset(assetId: string): Promise<PersistedMedia | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MEDIA_STORE, "readonly");
    const request = transaction.objectStore(MEDIA_STORE).get(assetId);
    await waitForTransaction(transaction);
    return request.result as PersistedMedia | undefined;
  } finally {
    database.close();
  }
}

export async function deleteMediaAsset(assetId: string) {
  const database = await openDatabase();
  const transaction = database.transaction(MEDIA_STORE, "readwrite");
  transaction.objectStore(MEDIA_STORE).delete(assetId);
  await waitForTransaction(transaction);
  database.close();
}

export async function saveProject(project: PersistedProject) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [PROJECT_STORE, ARCHIVE_STORE],
    "readwrite",
  );
  transaction.objectStore(PROJECT_STORE).put(project, CURRENT_PROJECT_KEY);
  if ("id" in project)
    transaction.objectStore(ARCHIVE_STORE).put(project, project.id);
  await waitForTransaction(transaction);
  database.close();
}

export async function listProjects(): Promise<PersistedProject[]> {
  const database = await openDatabase();
  const transaction = database.transaction(ARCHIVE_STORE, "readonly");
  const request = transaction.objectStore(ARCHIVE_STORE).getAll();
  await waitForTransaction(transaction);
  database.close();
  return (request.result as PersistedProject[]).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export async function loadProject() {
  const database = await openDatabase();
  const transaction = database.transaction(
    [PROJECT_STORE, MEDIA_STORE],
    "readonly",
  );
  const projectRequest = transaction
    .objectStore(PROJECT_STORE)
    .get(CURRENT_PROJECT_KEY);
  const mediaRequest = transaction.objectStore(MEDIA_STORE).getAll();
  const result = await new Promise<{
    project: PersistedProject | null;
    media: PersistedMedia[];
  }>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve({
        project:
          (projectRequest.result as PersistedProject | undefined) ?? null,
        media: (mediaRequest.result as PersistedMedia[] | undefined) ?? [],
      });
    };
    transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Could not restore the local project."),
      );
  });
  database.close();
  return result;
}

export async function clearProject() {
  const database = await openDatabase();
  const transaction = database.transaction(
    [PROJECT_STORE, MEDIA_STORE],
    "readwrite",
  );
  transaction.objectStore(PROJECT_STORE).clear();
  transaction.objectStore(MEDIA_STORE).clear();
  await waitForTransaction(transaction);
  database.close();
}
