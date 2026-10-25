// The bitmap must follow the final CSS box, including layout changes that do not
// trigger window.resize (font loading, flex layout and panels becoming visible).
export function fitCanvas(canvas, ctx, pixelRatio = 1) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1, 2);
  const bitmapWidth = Math.max(1, Math.round(width * scale));
  const bitmapHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  // Account for fractional CSS pixels and the integer bitmap dimensions.
  ctx.setTransform(bitmapWidth / width, 0, 0, bitmapHeight / height, 0, 0);
  return { width, height };
}
