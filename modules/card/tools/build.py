"""Builds index.html: inlines card-bg.svg (front, no placeholders) and card-back.png into src/index.template.html."""
import base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
bg = base64.b64encode((root / "card-bg.svg").read_bytes()).decode()
html = (root / "src" / "index.template.html").read_text(encoding="utf-8")
back = base64.b64encode((root / "card-back.png").read_bytes()).decode()
html = html.replace("__CARD_BG__", "data:image/svg+xml;base64," + bg).replace("__CARD_BACK__", "data:image/png;base64," + back)
(root / "index.html").write_text(html, encoding="utf-8")
