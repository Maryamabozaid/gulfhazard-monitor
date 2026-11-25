import type { ImageLayer } from "./model";
export const products = [
  ["auto", "Auto · best available detail", "تلقائي · أفضل دقة متاحة", ""],
  [
    "noaa20",
    "True colour · VIIRS NOAA-20",
    "ألوان طبيعية · فيرس NOAA-20",
    "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
  ],
  [
    "true",
    "True colour · MODIS Terra",
    "ألوان طبيعية · موديس",
    "MODIS_Terra_CorrectedReflectance_TrueColor",
  ],
  [
    "viirs",
    "True colour · VIIRS Suomi NPP",
    "ألوان طبيعية · فيرس Suomi NPP",
    "VIIRS_SNPP_CorrectedReflectance_TrueColor",
  ],
  [
    "flood",
    "Surface flooding · MODIS",
    "الفيضانات السطحية · موديس",
    "MODIS_Combined_Flood_1-Day",
  ],
  ["dust", "Dust score · AIRS", "مؤشر الغبار · AIRS", "AIRS_L2_Dust_Score_Day"],
  [
    "sst",
    "Sea surface temperature · MUR",
    "حرارة سطح البحر · MUR",
    "GHRSST_L4_MUR_Sea_Surface_Temperature",
  ],
  [
    "chlorophyll",
    "Chlorophyll-a · MODIS Aqua",
    "كلوروفيل أ · موديس أكوا",
    "MODIS_Aqua_L2_Chlorophyll_A",
  ],
  [
    "no2",
    "Nitrogen dioxide · Sentinel-5P",
    "ثاني أكسيد النيتروجين · سنتينل-5P",
    "TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column",
  ],
  [
    "so2",
    "Sulfur dioxide · Sentinel-5P",
    "ثاني أكسيد الكبريت · سنتينل-5P",
    "TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column",
  ],
  [
    "rain",
    "Precipitation · IMERG",
    "هطول الأمطار · IMERG",
    "IMERG_Precipitation_Rate",
  ],
  ["ch4", "Methane · Sentinel-5P", "الميثان · سنتينل-5P", ""],
  ["co", "Carbon monoxide · Sentinel-5P", "أول أكسيد الكربون · سنتينل-5P", ""],
  ["s1", "Sentinel-1 · SAR", "سنتينل-1 · رادار", ""],
  ["s2", "Sentinel-2 · SWIR", "سنتينل-2 · الأشعة تحت الحمراء", ""],
  ["landsat", "Landsat 8/9 · scene", "لاندسات 8/9 · مشهد", ""],
  ["optical", "Sentinel-2 · optical scene", "سنتينل-2 · مشهد بصري", ""],
];
export function raster(id: string, date: string): ImageLayer {
  const p = products.find((p) => p[0] === id)!;
  if (["s1", "s2", "ch4", "co"].includes(id))
    return {
      id,
      name: p[1],
      attribution: "Copernicus Sentinel",
      nativeZoom: 16,
      date,
      tiles: ["/api/sentinel/" + id + "/" + date + "/{z}/{x}/{y}.png"],
    };
  if (id === "true")
    return {
      id,
      name: p[1],
      product: id,
      date,
      nativeZoom: 9,
      resolutionLabel: "250–500 m",
      attribution: "NASA GIBS · MODIS Terra",
      tiles: ["/api/modis/" + date + "/{z}/{x}/{y}.png"],
    };
  if (id === "noaa20" || id === "viirs") {
    return {
      id,
      name: p[1],
      attribution: "NASA GIBS",
      nativeZoom: 9,
      resolutionLabel: "375–750 m",
      date,
      tiles: [
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" +
          p[3] +
          "/default/" +
          date +
          "/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
      ],
    };
  }
  const url =
    "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=" +
    p[3] +
    "&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&TIME=" +
    date;
  return { id, name: p[1], attribution: "NASA GIBS", date, tiles: [url] };
}
