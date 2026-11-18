import { typed, writeFolder, type FolderFile, type Workspace } from '../format/workspace'
import { readZip, writeZip } from '../format/zip'

/** Files from a folder picked with `<input webkitdirectory>`, by their path inside it. */
export const fromInput = (list: FileList | null): FolderFile[] => [...(list ?? [])].map((f) => ({ path: f.webkitRelativePath || f.name, blob: typed(f, f.name) }))

/** Whatever was dropped: folders (read whole), zips (opened) and loose files. */
export async function fromDrop(dt: DataTransfer, onCount?: (n: number) => void): Promise<FolderFile[]> {
  const out: FolderFile[] = []
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  const file = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej))
  const walk = async (e: FileSystemEntry, path: string): Promise<void> => {
    if (e.isFile) {
      const f = await file(e as FileSystemFileEntry)
      if (/\.zip$/i.test(f.name)) out.push(...(await readZip(f)))
      else out.push({ path: `${path}${f.name}`, blob: typed(f, f.name) })
      onCount?.(out.length)
      return
    }
    const reader = (e as FileSystemDirectoryEntry).createReader()
    // readEntries returns them in batches until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const c of batch) await walk(c, `${path}${e.name}/`)
    }
  }
  for (const e of entries) await walk(e, '')
  return out
}

export async function fromZip(f: File): Promise<FolderFile[]> { return (await readZip(f)).map((x) => ({ ...x, blob: typed(x.blob, x.path) })) }

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export async function exportZip(ws: Workspace) {
  download(await writeZip(writeFolder(ws)), 'parley-assets.zip')
}

type DirHandle = FileSystemDirectoryHandle & { getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<FileSystemDirectoryHandle>; getFileHandle(n: string, o?: { create?: boolean }): Promise<FileSystemFileHandle> }
/** Chrome and Edge can write straight into a folder (an instance's assets folder, say). */
export const canSaveToFolder = () => typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'

/**
 * Write the workspace into a folder you pick: each kind's folder and metadata.json, and the files. Files already
 * there with the same name are replaced; nothing else in the folder is touched.
 */
export async function saveToFolder(ws: Workspace, onProgress?: (done: number, total: number) => void): Promise<number | null> {
  let root: DirHandle
  try { root = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ mode: 'readwrite', id: 'parley-assets' }) } catch { return null }
  const files = writeFolder(ws)
  let done = 0
  onProgress?.(0, files.length)
  for (const f of files) {
    const parts = f.path.split('/')
    let dir: DirHandle = root
    for (const p of parts.slice(0, -1)) dir = (await dir.getDirectoryHandle(p, { create: true })) as DirHandle
    const h = await dir.getFileHandle(parts[parts.length - 1], { create: true })
    const w = await (h as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable()
    await w.write(f.blob)
    await w.close()
    onProgress?.(++done, files.length)
  }
  return files.length
}
