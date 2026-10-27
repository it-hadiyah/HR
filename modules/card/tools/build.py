"""يبني index.html: يضمّن خلفية التصميم (card-bg.svg من card_staff.pdf بلا صورة ولا نصوص) وظهر البطاقة والخطوط (IBM Plex Sans Arabic) في src/index.template.html."""
import base64, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
b64 = lambda p: base64.b64encode(p.read_bytes()).decode()
fonts = []
for sub, rng in (("arabic", "U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF,U+200C-200F,U+2010-2011,U+25CC"), ("latin", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD")):
    for w in (400, 700):
        f = root / "fonts" / f"ibm-plex-sans-arabic-{sub}-{w}-normal.woff2"
        fonts.append(f'@font-face{{font-family:"IBM Plex Sans Arabic";font-weight:{w};font-style:normal;font-display:block;'
                     f'src:url(data:font/woff2;base64,{b64(f)}) format("woff2");unicode-range:{rng}}}')
html = (root / "src" / "index.template.html").read_text(encoding="utf-8")
html = (html.replace("__FONTS__", "\n".join(fonts))
            .replace("__CARD_BG__", "data:image/svg+xml;base64," + b64(root / "card-bg.svg"))
            .replace("__CARD_BACK__", "data:image/png;base64," + b64(root / "card-back.png")))
(root / "index.html").write_text(html, encoding="utf-8")
