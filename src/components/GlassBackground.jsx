import { useTheme } from '../contexts/ThemeContext';

export const DEFAULT_WALLPAPER = '/glass-wallpaper.jpg';

// The room behind the glass. Only mounts for the Glass theme — every other
// theme paints a flat surface colour and would just be covering this up.
//
// Two layers, not one: the photo scales and unblurs on mount (the "camera
// arriving in the room" move the glass kit opens with), while the shade stays
// put. Animating a single element would drag the dimming in with it and the
// whole page would flash bright before settling.
export default function GlassBackground() {
  const { colorTheme, glassBg, customUrl } = useTheme();
  if (colorTheme !== 'glass') return null;

  // 'custom' with no image yet means the file is still coming back out of
  // IndexedDB. Fall through to no photo for that frame rather than flashing
  // the default one in and straight back out again.
  const src =
    glassBg === 'none' ? null
    : glassBg === 'custom' ? customUrl
    : DEFAULT_WALLPAPER;

  return (
    <div className="glass-bg" aria-hidden="true">
      {src && (
        // Keyed on the URL so swapping wallpapers replays the fade-in, rather
        // than hard-cutting one photo to the next.
        <div
          key={src}
          className="glass-bg__img"
          style={{ backgroundImage: `url("${src}")` }}
        />
      )}
      <div className="glass-bg__shade" />
    </div>
  );
}
