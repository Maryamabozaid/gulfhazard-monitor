import {
  Activity,
  Waves,
  Flame,
  Mountain,
  WavesLadder,
  Layers,
  Factory,
  Wind,
  Plane,
  Ship,
  Building2,
  ThermometerSun,
  LandPlot,
  ScanLine,
  Search,
  Map,
  Pentagon,
  Ruler,
  Satellite,
  Clock3,
  Bell,
  Download,
  Info,
  ChartNoAxesCombined,
  ShieldCheck,
  Globe2,
} from "lucide-react";
export const glyphs: Record<string, typeof Activity> = {
  earthquakes: Activity,
  oil: Waves,
  fires: Flame,
  volcanoes: Mountain,
  discharge: Waves,
  stations: Wind,
  floods: WavesLadder,
  seismic: Layers,
  flaring: Factory,
  air: Wind,
  flights: Plane,
  vessels: Ship,
  portcalls: Ship,
  infrastructure: Building2,
  marine: ThermometerSun,
  subsidence: LandPlot,
  search: Search,
  places: Globe2,
  layers: Layers,
  basemap: Map,
  draw: Pentagon,
  measure: Ruler,
  satellite: Satellite,
  time: Clock3,
  alerts: Bell,
  export: Download,
  info: Info,
  stats: ChartNoAxesCombined,
  risk: ShieldCheck,
  explore: Globe2,
  compare: ScanLine,
};
export function Icon({
  name,
  size = 18,
  ...rest
}: {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const I = glyphs[name] || Activity;
  return <I size={size} strokeWidth={1.7} aria-hidden="true" {...rest} />;
}
