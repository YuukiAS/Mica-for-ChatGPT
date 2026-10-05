from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "branding" / "mica-icon-master-v1.png"
ICON_DIR = ROOT / "extension" / "icons"
SIZES = [16, 32, 48, 128, 512]


def load_icon_master() -> Image.Image:
    image = Image.open(SOURCE).convert("RGBA")
    if image.width != image.height:
        raise ValueError("Mica icon master must be square")
    return image


def simplify_small_icon(master: Image.Image, size: int) -> Image.Image:
    icon = master.resize((size, size), Image.Resampling.LANCZOS)
    if size <= 32:
        icon = ImageEnhance.Contrast(icon).enhance(1.12)
        icon = ImageEnhance.Sharpness(icon).enhance(1.25)
        icon = icon.filter(ImageFilter.UnsharpMask(radius=0.6, percent=90, threshold=3))
    return icon


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master = load_icon_master()
    for size in SIZES:
        simplify_small_icon(master, size).save(ICON_DIR / f"icon{size}.png")
    print(f"Read {SOURCE}")
    for size in SIZES:
        print(f"Wrote {ICON_DIR / f'icon{size}.png'}")


if __name__ == "__main__":
    main()
