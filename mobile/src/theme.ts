/**
 * The same palette as the web app: warm cream ground, soft navy ink, and colour
 * only where it means something. Blue is your journey, orange is where you are
 * headed, green / amber / red carry risk, teal marks a safe place.
 *
 * Type is the one deliberate difference. The web app loads Instrument Sans;
 * here the platform's own face is the right call, and monospace is kept for
 * measurements so figures stay easy to compare.
 */

import { Platform } from 'react-native';

export type Theme = typeof lightTheme;

export const lightTheme = {
  dark: false,

  paper: '#fdf8f3',
  surface: '#ffffff',
  surfaceSunk: '#f3eee7',

  ink: '#1e2a3a',
  ink2: '#56637a',
  ink3: '#8b95a7',

  rule: '#ece5dc',
  ruleStrong: '#dad1c5',

  blue: '#0047ce',
  blueDeep: '#003aa8',
  blueTint: '#e8eeff',
  orange: '#f4692b',

  green: '#10864f',
  greenTint: '#e2f4ea',
  amber: '#b57a00',
  amberTint: '#fdf0d9',
  red: '#d93a30',
  redTint: '#fdeae8',

  teal: '#0e8f96',
  tealTint: '#e0f4f5',

  onAccent: '#ffffff',
};

export const darkTheme: Theme = {
  dark: true,

  paper: '#12151b',
  surface: '#1a1e26',
  surfaceSunk: '#232833',

  ink: '#eef1f6',
  ink2: '#b4bdcb',
  ink3: '#828d9e',

  rule: '#2a3039',
  ruleStrong: '#3a4250',

  blue: '#6f9bff',
  blueDeep: '#93b4ff',
  blueTint: '#1d2740',
  orange: '#ff8f63',

  green: '#4fcb8c',
  greenTint: '#142c20',
  amber: '#e5b455',
  amberTint: '#302514',
  red: '#ff7d73',
  redTint: '#35201e',

  teal: '#4ccfd7',
  tealTint: '#123034',

  onAccent: '#10131a',
};

export const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 };

export const riskColours = (t: Theme) => ({
  low: { fg: t.green, bg: t.greenTint, label: 'Low risk' },
  medium: { fg: t.amber, bg: t.amberTint, label: 'Medium risk' },
  high: { fg: t.red, bg: t.redTint, label: 'High risk' },
});

/**
 * Google Maps styling for Android, so the basemap recedes and the route is the
 * loudest thing on it. Apple Maps follows the system appearance on its own.
 */
export const mapStyleLight = [
  { elementType: 'geometry', stylers: [{ color: '#f6f2ec' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8b95a7' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#fdfbf8' }] },
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e4ecdf' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f0e6dc' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfdce4' }] },
];

export const mapStyleDark = [
  { elementType: 'geometry', stylers: [{ color: '#1b1f27' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7b8798' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#12151b' }] },
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1d2a22' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#272d38' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#333a47' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#141c28' }] },
];
