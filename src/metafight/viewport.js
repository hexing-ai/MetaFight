// CSS-only landscape fallback for hosts that keep their WebView in portrait.
// The simulation always uses the logical game dimensions and coordinates.
export function gameViewport(width, height, requested = false) {
  const rotated = requested && width < height;
  return { physicalWidth: width, physicalHeight: height, rotated,
    width: rotated ? height : width, height: rotated ? width : height };
}

export function gamePoint(view, x, y) {
  return view.rotated ? { x: y, y: view.physicalWidth - x } : { x, y };
}
