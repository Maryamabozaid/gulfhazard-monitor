import { readFileSync } from "node:fs";
const distribution = JSON.parse(
  readFileSync(new URL("../shared/distribution.json", import.meta.url)),
);
const requested = process.env.DATA_PROFILE || distribution.profile;
if (!["research", "commercial"].includes(requested))
  throw Error("DATA_PROFILE must be research or commercial.");
export const profile =
  distribution.profile === "commercial" ? "commercial" : requested;
const exclusions = {
  portcalls: "IMF PortWatch service and reuse terms",
  seismic: "GEM noncommercial dataset",
  flaring: "EOG noncommercial dataset",
  oil: "SkyTruth attribution, share-alike and service terms",
  flights: "OpenSky service authorization",
  air: "Open-Meteo free service terms",
  discharge: "Open-Meteo free service terms",
  stations: "Station-specific terms",
  volcanoes: "Smithsonian GVP reuse terms",
  floods: "Source-specific GDACS reuse terms",
};
export const restriction = (layer) =>
  profile === "commercial" ? exclusions[layer] || null : null;
export function licensed(layers) {
  return layers.map((l) => ({ ...l, restricted: restriction(l.id) }));
}
