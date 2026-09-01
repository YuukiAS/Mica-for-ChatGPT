from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "branding" / "mica-brand-concept.png"
MASTER = ROOT / "assets" / "branding" / "mica-icon-master-v0.png"
ICON_DIR = ROOT / "extension" / "icons"
SIZES = [16, 32, 48, 128, 512]


def create_icon_master() -> Image.Image:
    image = Image.open(SOURCE).convert("RGBA")
    # Crop only the central Mica symbol from the 16:9 concept art.
    crop = image.crop((580, 105, 1105, 630))
    crop = ImageEnhance.Contrast(crop).enhance(1.05)
    crop = ImageEnhance.Sharpness(crop).enhance(1.08)
    canvas = Image.new("RGBA", (768, 768), (255, 255, 255, 0))
    symbol = crop.resize((640, 640), Image.Resampling.LANCZOS)
    canvas.alpha_composite(symbol, (64, 64))
    return canvas


def simplify_small_icon(master: Image.Image, size: int) -> Image.Image:
    icon = master.resize((size, size), Image.Resampling.LANCZOS)
    if size <= 32:
        icon = ImageEnhance.Contrast(icon).enhance(1.12)
        icon = ImageEnhance.Sharpness(icon).enhance(1.25)
        icon = icon.filter(ImageFilter.UnsharpMask(radius=0.6, percent=90, threshold=3))
    return icon


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master = create_icon_master()
    master.save(MASTER)
    for size in SIZES:
        simplify_small_icon(master, size).save(ICON_DIR / f"icon{size}.png")
    print(f"Wrote {MASTER}")
    for size in SIZES:
        print(f"Wrote {ICON_DIR / f'icon{size}.png'}")


if __name__ == "__main__":
    main()
