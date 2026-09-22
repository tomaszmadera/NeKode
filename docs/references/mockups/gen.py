#!/usr/bin/env python3
"""Generate NeKode desktop UI mockups via OpenRouter Image API (/api/v1/images), po kolei."""
import base64, json, os, pathlib, sys, time, urllib.request, urllib.error

BASE = "https://openrouter.ai/api/v1"
OUT = pathlib.Path("/home/tomek/nekode-mockup-gen")
LEDGER = OUT / os.environ.get("LEDGER_FILE", "ledger.json")
PROMPT_FILE = os.environ.get("PROMPT_FILE", "prompt.txt")
IDX_OFF = int(os.environ.get("IDX_OFF", "0"))
KEY = [l.split("=", 1)[1].strip()
       for l in pathlib.Path("/home/tomek/.secrets/openrouter-image-gen-2.env").read_text().splitlines()
       if l.startswith("OPENROUTER_IMAGE_GENERATION_API_KEY=")][0]
PROMPT = (OUT / PROMPT_FILE).read_text().strip()

MODELS = [
    "openai/gpt-image-2.5-sunburst",
    "openai/gpt-image-2.5-flare",
    "openai/gpt-image-2",
    "x-ai/grok-imagine-image-2.0",
    "google/gemini-3.1-flash-lite-image",
    "meta/muse-image",
    "bytedance-seed/seedream-5-0-lite",
    "bytedance-seed/seedream-5-0-pro",
]

H = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def api_get(path):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def key_usage():
    return api_get("/key")["data"].get("usage") or 0.0


def image_models():
    """id -> supported_parameters (keys only)."""
    try:
        data = api_get("/images/models")["data"]
    except urllib.error.HTTPError as e:
        print("images/models HTTP", e.code, "- pominę adaptację parametrów")
        return {}
    return {m["id"]: list((m.get("supported_parameters") or {}).keys()) for m in data}


def gen(model, supported):
    body = {"model": model, "prompt": PROMPT}
    if not supported or "aspect_ratio" in supported:
        body["aspect_ratio"] = "16:9"
    if supported and "output_format" in supported:
        body["output_format"] = "png"
    req = urllib.request.Request(BASE + "/images", data=json.dumps(body).encode(), headers=H, method="POST")
    with urllib.request.urlopen(req, timeout=420) as r:
        return json.load(r)


if __name__ == "__main__":
    supported_map = image_models()
    print("images/models znane:", len(supported_map))
    for m in MODELS:
        print(("  OK   " if m in supported_map else "  ?    ") + m)
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else []
    for i in [int(a) for a in sys.argv[1:]]:
        model = MODELS[i]
        n = IDX_OFF + i + 1
        short = model.split("/")[-1].replace(".", "-")
        png = OUT / f"{n:02d}_{short}.png"
        if png.exists() and any(r["idx"] == n and r.get("ok") for r in ledger):
            print(f"[{n}] {model}: already done, skip")
            continue
        row = {"idx": n, "model": model}
        before = key_usage()
        t0 = time.time()
        try:
            resp = gen(model, supported_map.get(model))
            item = (resp.get("data") or [{}])[0]
            if item.get("b64_json"):
                png.write_bytes(base64.b64decode(item["b64_json"]))
            elif item.get("url"):
                urllib.request.urlretrieve(item["url"], png)
            cost = (resp.get("usage") or {}).get("cost")
            time.sleep(3)
            delta = round(key_usage() - before, 6)
            ok = png.exists() and png.stat().st_size > 1000
            row.update({"ok": ok, "secs": round(time.time() - t0, 1), "png": str(png) if ok else None,
                        "usage_cost": cost, "cost_delta": delta})
            print(f"[{n}] {model}: {'OK' if ok else 'NO IMAGE'} | {row['secs']}s | cost={cost} | delta~${delta}")
        except urllib.error.HTTPError as e:
            row.update({"ok": False, "secs": round(time.time() - t0, 1), "error": f"HTTP {e.code}: {e.read().decode()[:300]}"})
            print(f"[{n}] {model}: ERROR {row['error']}")
        except Exception as e:
            row.update({"ok": False, "secs": round(time.time() - t0, 1), "error": repr(e)[:300]})
            print(f"[{n}] {model}: ERROR {row['error']}")
        ledger = [r for r in ledger if r["idx"] != n] + [row]
        LEDGER.write_text(json.dumps(ledger, indent=1, ensure_ascii=False))
