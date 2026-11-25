# GIS mapping

[Map implementation](../frontend/src/gis/) · [Local geographic assets and provenance](public/cartography/SOURCES.md) · [Provider layer definitions](../shared/layers.json)

The interactive client uses Leaflet for the default map and MapLibre GL JS for vector streets. GeoJSON files use WGS 84 longitude and latitude (EPSG:4326). The web maps use Web Mercator (EPSG:3857).

The local assets include country and administrative boundaries, the Arabian Gulf water polygon, city locations, terrain shading and map labels. The Places control intersects active observations with any selected geometry and uses a 25 km radius around city centres. The Whole Arabian Gulf preset selects its waters and eight coastal countries.

Run `npm ci` and `npm run dev` from the repository root to open the map. The frontend serves the contents of `gis/public` at the site root. The backend also reads reference boundaries from this directory.
