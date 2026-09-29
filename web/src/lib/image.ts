// Zmenšenie fotky hárku ešte v mobile: dlhšia strana max. 1600 px, JPEG ~0.72 → typicky 200–400 KB
export async function compressPhoto(file: File, maxSide = 1600, quality = 0.72): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  const src: CanvasImageSource & { width: number; height: number } = bitmap ?? (await loadImage(file))
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(src.width * scale)
  canvas.height = Math.round(src.height * scale)
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height)
  bitmap?.close()
  return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', quality))
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export const blobToDataUrl = (b: Blob) => new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(b) })
export const dataUrlToBlob = async (d: string) => (await fetch(d)).blob()
