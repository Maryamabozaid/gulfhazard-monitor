# Flood reference check in Al Hodeidah, Yemen

**The radar mask had 10.9% intersection over union with UNOSAT’s water footprint in this test.** The two satellites observed the site five days apart during a developing flood. This result supports exploratory use and identifies a need for closer acquisition times and field observations before operational flood mapping.

| Input | Observation |
| --- | --- |
| Sentinel-1A RTC VV | 2 August 2024, 02:59 UTC, relative orbit 6 descending. The service selected this acquisition when asked for 10 August at 43.14° E, 15.18° N. [STAC item](https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-1-rtc/items/S1A_IW_GRDH_1SDV_20240802T025930_20240802T025955_055028_06B442_rtc) |
| Independent comparison | UNOSAT product 3908, Sentinel-2 on 7 August 2024. UNOSAT labels the result preliminary and reports that field validation was pending. The shapefile includes analysis extent, cloud obstruction and mapped water. [UNOSAT product and GIS downloads](https://unosat.org/products/3908) |
| Sampling | A 192 × 192 grid across approximately 9.6 × 9.6 km. All 36,864 radar pixels were valid. After excluding clouds and centres outside the UNOSAT analysis, 24,023 pixels remained. |
| Classification | VV backscatter converted to decibels, 3 × 3 median filter, Otsu threshold bounded between −22 and −13 dB. The selected threshold was −13 dB. |

| Pixel-centre agreement | UNOSAT water | UNOSAT other |
| --- | ---: | ---: |
| Radar water candidate | 975 | 4,665 |
| Radar other | 3,285 | 15,098 |

Precision was 17.3% and recall was 22.9% relative to the reference. This single cross-date comparison cannot establish street-scale accuracy. Flood evolution, wet soil, permanent water, radar shadows, spatial resolution and the optical reference can each affect the overlap. The test does not isolate those effects.

## Repeat the calculation

1. Download **SHP** on the UNOSAT product page. Keep the original ZIP. [Official archive](https://unosat.org/static/unosat_filesystem/3908/FL20240812YEM_SHP.zip)
2. With the local research server running, save its response. In PowerShell run `Invoke-WebRequest 'http://127.0.0.1:5173/api/radar?mode=water&date=2024-08-10&lon=43.14&lat=15.18' -OutFile radar-response.json`.
3. In a Python environment with NumPy, Pillow, Shapely 2 and pyshp installed, run `python scripts/validate-flood.py radar-response.json FL20240812YEM_SHP.zip`. The script checks the coordinate system and valid radar coverage, uses Web Mercator pixel centres, excludes cloud-obstructed pixels and prints the confusion matrix and scene identifier.

## Earthquake impact records

The application includes 128 regional NOAA significant-earthquake records from 1900 through 2025. Of them, 116 have both magnitude and a direct earthquake damage class. The exposure panel shows the counts for severity classes 3 and 4 and the denominator in each magnitude group. A pre-2015 sample of 104 records was used to estimate group rates with Beta(1,1) smoothing. Twelve later assessed events supplied a chronological holdout. The Brier score was 0.145 for magnitude groups and 0.196 for the constant regional rate. The trained M ≥ 7 group contains only three events. Selection for significant impacts and missing assessments limit generalization.

The downloaded reference includes the source query, retrieval timestamp and NOAA event IDs. Run `node scripts/impact-reference.mjs` to update the frozen 1900–2025 edition. The USGS activity percentile and these documented damage frequencies measure different quantities. Representative labelled outcomes from additional floods, earthquakes and exposed communities would support a future loss model. [NOAA NCEI/WDS dataset](https://doi.org/10.7289/V5TD9V7K) · [Impact data in this release](../gis/public/cartography/impact-reference.json)
