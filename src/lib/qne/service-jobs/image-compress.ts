// Browser-side image compression before upload (Run 7 Phase J).
// Auto-rotates via createImageBitmap, caps the longest edge, re-encodes as
// JPEG/WebP and drops EXIF (canvas re-encode never carries metadata over).

export interface CompressOptions {
  maxDimension?: number;
  quality?: number;
  /** Hard maximum after compression, in bytes. */
  hardMaxBytes?: number;
}

export interface CompressResult {
  file: File;
  originalBytes: number;
  bytes: number;
  compressed: boolean;
}

export function isCompressibleImage(type: string): boolean {
  return /^image\/(jpeg|png|webp|heic|heif)$/i.test(type);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function compressImage(
  file: File,
  opts: CompressOptions = {},
): Promise<CompressResult> {
  const maxDimension = opts.maxDimension ?? 1600;
  const quality = opts.quality ?? 0.8;
  const hardMax = opts.hardMaxBytes ?? 3 * 1024 * 1024;

  if (typeof document === "undefined" || !isCompressibleImage(file.type)) {
    return { file, originalBytes: file.size, bytes: file.size, compressed: false };
  }

  let bitmap: ImageBitmap;
  try {
    // imageOrientation "from-image" applies EXIF rotation, then discards it.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { file, originalBytes: file.size, bytes: file.size, compressed: false };
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return { file, originalBytes: file.size, bytes: file.size, compressed: false };
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const targetType = file.type === "image/webp" ? "image/webp" : "image/jpeg";
  let q = quality;
  let blob = await canvasToBlob(canvas, targetType, q);
  // Step quality down until the hard maximum is respected.
  while (blob && blob.size > hardMax && q > 0.4) {
    q = Math.round((q - 0.1) * 10) / 10;
    blob = await canvasToBlob(canvas, targetType, q);
  }
  if (!blob) return { file, originalBytes: file.size, bytes: file.size, compressed: false };

  const ext = targetType === "image/webp" ? "webp" : "jpg";
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  const out = new File([blob], `${base}.${ext}`, {
    type: targetType,
    lastModified: Date.now(),
  });
  return {
    file: out.size < file.size ? out : file,
    originalBytes: file.size,
    bytes: Math.min(out.size, file.size),
    compressed: out.size < file.size,
  };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
