import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent


def main():
    seed = json.loads((BASE / "seed.json").read_text(encoding="utf-8"))
    js = "window.DS_SEED = " + json.dumps(seed, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (BASE / "seed.js").write_text(js, encoding="utf-8")
    print(json.dumps({"seed_js": (BASE / "seed.js").stat().st_size}))


if __name__ == "__main__":
    main()
