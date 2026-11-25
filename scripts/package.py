"""Build and verify research and restricted commercial source distributions."""
import argparse
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
dirs = ["frontend/src", "frontend/dist", "backend", "scripts", "shared", "gis", "datasets", "docs"]
files = [".dockerignore", ".env.example", ".gitignore", "Dockerfile", "compose.yaml", "package.json",
         "package-lock.json", "README.md", "frontend/index.html", "frontend/package.json", "frontend/package-lock.json",
         "frontend/postcss.config.js", "frontend/tailwind.config.js", "frontend/tsconfig.json", "frontend/vite.config.js"]
commercial_datasets = {"firms-noaa20-regional-7d.json.gz", "usgs-regional-30d.json.gz",
                       "gibs-reflectance-dates.json", "infrastructure.geojson", "power.geojson",
                       "subsidence.geojson", "vessels.geojson"}


def package(profile, dest):
    if json.loads((root / "shared/distribution.json").read_text())["profile"] == "commercial" and profile != "commercial":
        raise ValueError("This source distribution is commercial only")
    dest = Path(dest).resolve()
    dest.parent.mkdir(exist_ok=True, parents=True)
    if not (root / "frontend/dist/index.html").exists():
        raise ValueError("Run npm run build before packaging")
    members = sorted([root / name for name in files] +
                     [p for folder in dirs for p in (root / folder).rglob("*") if p.is_file()])
    with NamedTemporaryFile(dir=dest.parent, suffix=".tmp", delete=False) as tmp:
        scratch = Path(tmp.name)
    try:
        with ZipFile(scratch, "w", ZIP_DEFLATED) as z:
            for p in members:
                if p.is_symlink() or p.name == ".env" or any(part in {"__pycache__", "node_modules", "data", ".git"} for part in p.parts):
                    continue
                rel = p.relative_to(root).as_posix()
                if profile == "commercial" and (
                    rel.startswith("datasets/") and p.name not in commercial_datasets
                    or rel.startswith("docs/") and p.suffix.lower() in {".jpg", ".jpeg", ".png"}
                ):
                    continue
                name = "gulfhazard-monitor/" + rel
                if rel == "shared/distribution.json":
                    z.writestr(name, json.dumps({"profile":profile}) + "\n")
                elif rel == ".env.example":
                    z.writestr(name, p.read_text().replace("DATA_PROFILE=research", "DATA_PROFILE=" + profile))
                else:
                    z.write(p, name)
        with ZipFile(scratch) as z:
            names = z.namelist()
            assert z.testzip() is None
            assert not any("/node_modules/" in n or "/data/" in n or n.endswith("/.env") for n in names)
            prefix = "gulfhazard-monitor/"
            assert json.loads(z.read(prefix+"shared/distribution.json"))["profile"] == profile
            assert all(prefix + need in names for need in ["frontend/dist/index.html","scripts/create-admin.mjs","gis/public/cartography/impact-reference.json","backend/tests/operations.test.mjs"])
            if profile == "commercial":
                assert {n.split("/")[-1] for n in names if n.startswith(prefix+"datasets/")} == commercial_datasets
        scratch.replace(dest)
        print(profile, len(names), "files", dest.stat().st_size, "bytes")
    finally:
        scratch.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("profile", choices=["research", "commercial"])
    parser.add_argument("output")
    args = parser.parse_args()
    package(args.profile, args.output)
