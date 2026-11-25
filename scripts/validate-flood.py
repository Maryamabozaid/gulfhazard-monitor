"""Compare a fully observed GulfHazard water grid with original UNOSAT 3908 shapes.

Usage: python scripts/validate-flood.py radar-response.json FL20240812YEM_SHP.zip
Dependencies: numpy, Pillow, shapely>=2, pyshp. Inputs stay on disk.
"""
import base64
import io
import json
import sys
import zipfile
import numpy as np
import shapefile
import shapely
from PIL import Image


def layer_mask(archive, name, xs, ys):
    member = next(p for p in archive.namelist() if name in p and p.endswith(".shp"))
    if b"GCS_WGS_1984" not in archive.read(member[:-4] + ".prj"):
        raise ValueError("Expected original WGS84 UNOSAT product")
    result = np.zeros(xs.shape, dtype=bool)
    reader = shapefile.Reader(shp=io.BytesIO(archive.read(member)))
    for feature in reader.iterShapes():
        covered = np.zeros(xs.shape, dtype=bool)
        points = np.asarray(feature.points)[:, :2]
        stops = [*feature.parts, len(points)]
        # Exterior rings and holes alternate by containment in a valid shapefile.
        for start, stop in zip(stops, stops[1:]):
            ring = points[start:stop]
            if len(ring) < 4:
                continue
            west, south = ring.min(axis=0)
            east, north = ring.max(axis=0)
            if west > xs.max() or east < xs.min() or south > ys.max() or north < ys.min():
                continue
            cells = (xs >= west) & (xs <= east) & (ys >= south) & (ys <= north)
            if np.any(cells):
                poly = shapely.Polygon(ring)
                covered[cells] ^= shapely.contains_xy(poly, xs[cells], ys[cells])
        result |= covered
    return result


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        radar = json.load(f)
    png = base64.b64decode(radar["overlay"].split(",", 1)[1])
    wet = np.asarray(Image.open(io.BytesIO(png)).convert("RGBA"))[:, :, 3] > 0
    if radar["product"] != "water" or radar["valid"] != wet.size:
        raise ValueError("Use a water mask with full valid radar coverage")
    west, south, east, north = radar["bounds"]
    h, w = wet.shape
    lon = west + (np.arange(w) + 0.5) * (east - west) / w
    bottom, top = np.arcsinh(np.tan(np.deg2rad([south, north])))
    lat = np.rad2deg(np.arctan(np.sinh(top - (np.arange(h) + 0.5) * (top - bottom) / h)))
    xs, ys = np.meshgrid(lon, lat)
    with zipfile.ZipFile(sys.argv[2]) as archive:
        valid = layer_mask(archive, "AnalysisExtent", xs, ys)
        valid &= ~layer_mask(archive, "CloudObstruction", xs, ys)
        reference = layer_mask(archive, "WaterExtent", xs, ys)
    tp, fp, fn, tn = [int(np.count_nonzero(valid & a & b)) for a, b in
                      [(wet, reference), (wet, ~reference), (~wet, reference), (~wet, ~reference)]]
    print(json.dumps(dict(scene=radar["items"][-1], bounds=radar["bounds"], valid=int(valid.sum()),
                          tp=tp, fp=fp, fn=fn, tn=tn,
                          iou=tp/(tp+fp+fn) if tp+fp+fn else None,
                          precision=tp/(tp+fp) if tp+fp else None,
                          recall=tp/(tp+fn) if tp+fn else None), indent=2))


if __name__ == "__main__":
    main()
