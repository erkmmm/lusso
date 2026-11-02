// ─── Appearance ───────────────────────────────────────────────────────────────
// Everything here is this-device-only: it all lands in localStorage via
// ThemeContext (`lusso_theme`, `lusso_color_theme`, `lusso_glass_bg`,
// `lusso_glass_dim`, `lusso_anim_bg`, `lusso_anim_bg_style`) and never syncs.
// It used to share a section with push notifications under the name "General",
// which described neither half.
import { useState, useRef } from 'react';
import {
  Sun, Upload, Trash2, Loader,
  Image as ImageIcon, Palette, Sparkles,
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import SettingsCard from './SettingsCard';
import { COLOR_OPTIONS, THEME_OPTIONS } from './appearanceOptions';

// ── Glass wallpaper ──────────────────────────────────────────────────────────
// Only shown while the Glass theme is active — it is the one theme with a
// photograph behind it, and the control would be inert anywhere else.
//
// The dim slider earns its place: the whole point is that people put their own
// photo back there, and a bright one makes 12px table text unreadable. Dimming
// is the fix, and only the person looking at it knows how much they need.
function GlassWallpaperCard() {
  const {
    glassBg, setGlassBg, glassDim, setGlassDim, customUrl,
    uploadGlassWallpaper, removeGlassWallpaper,
  } = useTheme();

  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the SAME file again still fires onChange.
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await uploadGlassWallpaper(file);
    } catch (err) {
      setError(err?.message || 'Could not use that image.');
    } finally {
      setBusy(false);
    }
  };

  const OPTIONS = [
    { value: 'default', label: 'Room',     desc: 'The one it ships with.',   preview: '/glass-wallpaper.jpg' },
    { value: 'custom',  label: 'Your photo', desc: customUrl ? 'Tap Upload to change it.' : 'Upload one below.', preview: customUrl },
    { value: 'none',    label: 'No photo', desc: 'Plain graded backdrop.',   preview: null },
  ];

  return (
    <SettingsCard
      id="wallpaper"
      icon={ImageIcon}
      title="Wallpaper"
      description="What sits behind the glass. Never sent to a customer."
      scope="device"
      save={{ kind: 'instant' }}
      bodyClass=""
    >
      <div className="p-4 grid grid-cols-3 gap-3">
        {OPTIONS.map(({ value, label, desc, preview }) => {
          const active = glassBg === value;
          // Selecting "Your photo" with nothing stored would show an empty
          // backdrop, so it opens the picker instead.
          const choose = () =>
            (value === 'custom' && !customUrl) ? fileRef.current?.click() : setGlassBg(value);
          return (
            <button key={value} type="button" onClick={choose}
              className={`rounded-xl border-2 overflow-hidden text-left transition-all ${
                active ? 'border-amber-500' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="h-20 bg-slate-100 relative">
                {preview
                  ? <img src={preview} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full" style={{
                      background: 'radial-gradient(90% 70% at 18% 0%, #3a322c 0%, transparent 60%), radial-gradient(80% 60% at 100% 100%, #2b2521 0%, transparent 55%), #1b1917',
                    }} />}
                {value === 'custom' && !customUrl && (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                    <Upload size={18} />
                  </div>
                )}
              </div>
              <div className="px-3 py-2">
                <p className={`text-xs font-semibold ${active ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-5 pb-4 flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 text-xs font-medium bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white rounded-lg px-3 min-h-[44px] transition-colors">
          {busy ? <Loader size={13} className="animate-spin" /> : <Upload size={13} />}
          {busy ? 'Saving…' : customUrl ? 'Replace photo' : 'Upload a photo'}
        </button>
        {customUrl && (
          <button type="button" onClick={() => removeGlassWallpaper()}
            className="flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 min-h-[44px] transition-colors">
            <Trash2 size={13} /> Remove
          </button>
        )}
        <p className="text-[11px] text-slate-400 basis-full">
          Resized to 2560px and kept on this device. Big phone photos are fine.
        </p>
        {error && <p className="text-[11px] text-red-600 basis-full">{error}</p>}
      </div>

      <div className="px-5 pb-5 pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-slate-500">Dim</p>
          <p className="text-xs text-slate-400 tabular-nums">{Math.round(glassDim * 100)}%</p>
        </div>
        <input
          type="range" min="0" max="0.85" step="0.01" value={glassDim}
          onChange={(e) => setGlassDim(parseFloat(e.target.value))}
          aria-label="Wallpaper dim"
          className="w-full accent-amber-500"
        />
        <p className="text-[11px] text-slate-400 mt-1.5">
          Darkens the photo behind the panels. Turn it up if a bright picture is making text hard to read.
        </p>
      </div>
    </SettingsCard>
  );
}

export default function Appearance() {
  const { theme, setTheme, colorTheme, setColorTheme, animBg, setAnimBg, bgStyle, setBgStyle } = useTheme();

  return (<>
    {/* Light / dark */}
    <SettingsCard
      id="light-dark"
      icon={Sun}
      title="Light & dark"
      description="Choose how Lusso looks on this device."
      scope="device"
      save={{ kind: 'instant' }}
      bodyClass="p-4"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {THEME_OPTIONS.map(({ value, label, desc, icon: Icon, color }) => {
          const active = theme === value;
          return (
            <button key={value} onClick={() => setTheme(value)}
              className={`flex flex-col items-center gap-2 p-4 min-h-[44px] rounded-xl border-2 text-center transition-all ${
                active ? 'border-amber-500 bg-amber-50/40' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${active ? 'bg-amber-100' : 'bg-slate-100'}`}>
                <Icon size={20} className={active ? 'text-amber-600' : color} />
              </div>
              <div>
                <p className={`text-sm font-semibold ${active ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-tight">{desc}</p>
              </div>
              {active && <span className="text-[10px] font-semibold bg-amber-500 text-white px-2 py-0.5 rounded-full">Active</span>}
            </button>
          );
        })}
      </div>
    </SettingsCard>

    {/* Colour theme */}
    <SettingsCard
      id="colour-theme"
      icon={Palette}
      title="Colour theme"
      description="Pick the accent palette. Glass is the default. Lusso, Apex, Taupe & Green follow light/dark; Glass, Cyberpunk, Matrix & Mono are always dark."
      scope="device"
      save={{ kind: 'instant' }}
      bodyClass="p-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {COLOR_OPTIONS.map(({ value, label, desc, swatch }) => {
          const active = colorTheme === value;
          return (
            <button key={value} onClick={() => setColorTheme(value)}
              className={`flex items-center gap-3 p-4 min-h-[44px] rounded-xl border-2 text-left transition-all ${
                active ? 'border-amber-500 bg-amber-50/40' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <span className="w-9 h-9 rounded-lg flex-shrink-0 border border-black/10" style={{ backgroundColor: swatch }} />
              <div className="min-w-0">
                <p className={`text-sm font-semibold ${active ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                <p className="text-xs text-slate-400 mt-0.5 leading-tight">{desc}</p>
              </div>
              {active && <span className="ml-auto text-[10px] font-semibold bg-amber-500 text-white px-2 py-0.5 rounded-full">Active</span>}
            </button>
          );
        })}
      </div>
    </SettingsCard>

    {/* Wallpaper — Glass theme only; see GlassWallpaperCard. */}
    {(colorTheme === 'glass' || colorTheme === 'glass-light') && <GlassWallpaperCard />}

    {/* Animated background */}
    <SettingsCard
      id="animated-background"
      icon={Sparkles}
      title="Animated background"
      description="A slow, subtle moving gradient behind every page, tinted to your colour theme. Off by default; respects reduced-motion."
      scope="device"
      save={{ kind: 'instant' }}
      bodyClass=""
      actions={
        <button
          role="switch"
          aria-checked={animBg}
          aria-label="Animated background"
          onClick={() => setAnimBg(!animBg)}
          className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors before:absolute before:content-[''] before:-inset-x-2 before:-inset-y-2.5 ${animBg ? 'bg-amber-500' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${animBg ? 'translate-x-5' : ''}`} />
        </button>
      }
    >
      {animBg && (
        <div className="px-5 py-4">
          <p className="text-xs font-medium text-slate-500 mb-2">Style</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'mesh',   label: 'Mesh gradient', desc: 'Soft drifting colour fields.' },
              { value: 'plasma', label: 'Plasma',        desc: 'Fluid, marbled swirl.' },
            ].map(({ value, label, desc }) => {
              const active = bgStyle === value;
              return (
                <button key={value} onClick={() => setBgStyle(value)}
                  className={`p-3 min-h-[44px] rounded-xl border-2 text-left transition-all ${
                    active ? 'border-amber-500 bg-amber-50/40' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <p className={`text-sm font-semibold ${active ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-tight">{desc}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </SettingsCard>
  </>);
}
