// ─── Appearance option lists ──────────────────────────────────────────────────
// The theme and colour choices, in their own module so Appearance.jsx only
// exports a component (fast refresh stops working on a mixed file).
import { Sun, Moon, Monitor, Clock } from 'lucide-react';

export const COLOR_OPTIONS = [
  { value: 'glass',       label: 'Glass',       desc: 'Frosted panels over a room — the default. Always dark.', swatch: '#8a7d72' },
  { value: 'glass-light', label: 'Glass Light', desc: 'The same frosted panels, in daylight.', swatch: '#efeae4' },
  { value: 'lusso',     label: 'Lusso',     desc: 'Brand kit — bronze on paper.', swatch: '#6E5A43' },
  { value: 'apex',      label: 'Apex',      desc: 'Emerald & charcoal — demo style.', swatch: '#009368' },
  { value: 'taupe',     label: 'Taupe',     desc: 'Warm taupe & cream.',   swatch: '#644a40' },
  { value: 'green',     label: 'Green',     desc: 'Forest green & cream.',  swatch: '#2e7d32' },
  { value: 'cyberpunk', label: 'Cyberpunk', desc: 'Neon magenta on indigo — always dark.', swatch: '#ff00c8' },
  { value: 'matrix',    label: 'Matrix',    desc: 'Phosphor green on black — always dark.', swatch: '#00ff41' },
  { value: 'mono',      label: 'Mono',      desc: 'Monochrome grayscale — always dark.',    swatch: '#a1a1aa' },
  { value: 'neon-magenta', label: 'Neon Magenta', desc: 'Hot magenta on pure black — always dark.', swatch: '#ff2e9f' },
  { value: 'twitter',   label: 'Twitter',   desc: 'Twitter blue — follows light/dark.', swatch: '#1d9bf2' },
];

export const THEME_OPTIONS = [
  {
    value: 'light',
    label: 'Light',
    desc: 'Always use light mode.',
    icon: Sun,
    color: 'text-amber-500',
  },
  {
    value: 'dark',
    label: 'Dark',
    desc: 'Always use dark mode.',
    icon: Moon,
    color: 'text-slate-400',
  },
  {
    value: 'system',
    label: 'System',
    desc: "Follows your device's appearance setting.",
    icon: Monitor,
    color: 'text-blue-500',
  },
  {
    value: 'schedule',
    label: 'Schedule',
    desc: 'Dark from 7 pm to 7 am, light the rest of the day.',
    icon: Clock,
    color: 'text-teal-500',
  },
];
