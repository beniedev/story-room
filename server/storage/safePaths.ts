import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StoreDataError } from '../storeErrors.ts';

export const readJson = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;

export const atomicWrite = async (file: string, content: string | Uint8Array) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

export const unsafeBookTree = () => new StoreDataError('Book 文件结构异常。');

export const ensureSafeDirectory = async (directory: string) => {
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
    return;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await mkdir(directory);
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
};

export const safeDirectoryExists = async (directory: string) => {
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
};

export const readSafeDirectory = async (directory: string) => {
  let entries;
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafeBookTree();
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw unsafeBookTree();
  }
  return entries;
};

export const ensureSafeFile = async (file: string) => {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw unsafeBookTree();
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};

export const atomicWriteIfChanged = async (file: string, content: string) => {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw unsafeBookTree();
    if (Buffer.from(await readFile(file)).equals(Buffer.from(content, 'utf8'))) return;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await atomicWrite(file, content);
};

export async function collectSnapshotFiles(root: string, relativeRoot = ''): Promise<string[]> {
  const entries = await readSafeDirectory(root);
  if (!entries) return [];
  const files: string[] = [];
  for (const entry of entries) {
    const relative = relativeRoot ? path.join(relativeRoot, entry.name) : entry.name;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSnapshotFiles(fullPath, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw unsafeBookTree();
    }
  }
  return files.sort();
}

export async function assertSafeTree(directory: string) {
  const entries = await readSafeDirectory(directory);
  if (!entries) return;
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await assertSafeTree(fullPath);
    } else if (!entry.isFile()) {
      throw unsafeBookTree();
    }
  }
}
