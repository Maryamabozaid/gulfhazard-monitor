# Regional basemap credits

The included reference geography can be served locally. All GeoJSON coordinates use WGS 84 longitude and latitude. The reference layers have no event timestamps.

| Files | Source and preparation |
| --- | --- |
| `land.geojson`, `provinces.geojson` | Natural Earth 1:10m cultural data v4.1.0, as generalized in the QGIS 4.2.2 world GeoPackage. Regional geometries are clipped to 12°–83° E and 6° S–49° N. The country file retains ISO codes where supplied. Country names and boundaries reflect this edition. [Natural Earth public-domain dedication](https://www.naturalearthdata.com/about/terms-of-use/) · [QGIS processing notes](https://github.com/qgis/QGIS/blob/master/resources/data/README_world_map.md) |
| `world.geojson` | Complete country polygons from the same Natural Earth/QGIS source. The regional map uses these coastlines at all overview scales. Countries outside the study area use generalized geometry. |
| `labels.geojson` | Country label anchors are derived from the land polygons. GulfHazard Monitor placed waterbody labels and added Arabic display names and ranks. City coordinates were selected from GeoNames and the NGA Digital Chart of the World. City features identify the relevant source. [GeoNames](https://www.geonames.org/) · [GeoNames CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `water.geojson` | Regional rivers and lakes from the NGA Digital Chart of the World browser layers, through the Mapping Toolbox low-resolution distribution. Shorelines and channels represent generalized historical geography. [DCW reference](https://pubs.usgs.gov/of/1994/0626/report.pdf) |
| `relief.webp` | Regional shaded relief rendered from Mapzen Terrarium digital elevation tiles at zoom 6. SRTM and GMTED2010 data courtesy of the U.S. Geological Survey. ETOPO1 data from NOAA. European terrain includes Copernicus EU-DEM data funded by the European Union. This rendering omits bathymetry and uses directional shading with a transparent background. [Terrain Tiles data registry](https://registry.opendata.aws/terrain-tiles/) · [Source-specific acknowledgments and terms](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |

Online street detail uses Esri, HERE, Garmin, OpenStreetMap contributors and the GIS user community. [World Light Gray Base](https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer) · [World Dark Gray Base](https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer)

## Image georeferencing

The relief image is sampled in Web Mercator. Its corner coordinates are listed clockwise in WGS 84, beginning at the northwest corner.

```json
[[22.5, 40.97989807], [73.125, 40.97989807], [73.125, 0], [22.5, 0]]
```

## Town and village names

`gulf-waters.geojson` follows the [Natural Earth 1:10m ocean coastlines](https://www.naturalearthdata.com/downloads/10m-physical-vectors/), with the southeastern limit at the line between Ras Limah and Ras al Kuh described in [IHO S-23, sections 40–41](https://iho.int/uploads/user/pubs/standards/s-23/S-23_Ed3_1953_EN.pdf). Islands are excluded at the source resolution. This geographic basin selection is independent of maritime jurisdiction.

The location filter uses the country polygons in `land.geojson` and 158 administrative areas in `regions.geojson`. The latter were extracted from the Natural Earth 1:10m `states_provinces` polygons distributed with QGIS, simplified in WGS 84 and given Arabic search labels. They follow the bundled basemap edition. Administrative boundaries can change. [Natural Earth administrative areas, public domain](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/)

`places.json` contains 7,301 additional named populated places inside 32–60° E and 12–33° N, including 4,500 in Saudi Arabia. The local search and map labels use GeoNames IDs, WGS 84 positions, names, available Arabic-script aliases and display ranks. Extracted on 2026-11-24 from the cities500 worldwide file and the Saudi Arabia country file. Coverage varies by country and does not include every hamlet. [GeoNames downloads](https://download.geonames.org/export/dump/) · [GeoNames credits and CC BY 4.0](https://www.geonames.org/export/)
