"""Rebuild the original Android scene art with Python, Inkscape and Pillow."""
from pathlib import Path
from random import Random
from subprocess import run
from tempfile import TemporaryDirectory

from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "assets" / "vistas"
# Callsign, shadow, terminator, sunlit atmosphere, orbital landmark.
PORTS = [
    ("wfr", "#132d45", "#345c80", "#baf4f5", "wheel"),
    ("cnd", "#421d37", "#ab4f43", "#ffbc87", "derrick"),
    ("lmn", "#2d2853", "#7264a4", "#ebd2ff", "array"),
    ("vel", "#133740", "#318576", "#c0ffd2", "spindle"),
    ("mrw", "#262f4a", "#53697c", "#c8e3ff", "aperture"),
    ("orc", "#332445", "#91578b", "#fec1da", "anchor"),
    ("kpl", "#3f2e29", "#9b7545", "#ffe0a1", "bazaar"),
]


def stars():
    rng = Random(174)
    return "".join(
        f'<circle cx="{rng.randrange(480)}" cy="{rng.randrange(525)}" r="{rng.choice((.5,.65,.8,1.05,1.6))}" '
        f'fill="{rng.choice(("#adddfc","#ffcfaa","#e8f2ff"))}" opacity="{rng.uniform(.2,.86):.2f}"/>'
        for _ in range(221)
    )


def freighter():
    pods = "".join(
        f'''<g transform="translate(0 {y})">
        <path d="M-111 -12 -86 -21 -4 -19 20 -10 24 2 5 12 -105 13 -117 4Z" fill="#293147" stroke="#101229" stroke-width="2"/>
        <path d="M-109 -11 -86 -20 -9 -18 15 -9 2 -4 -105 -3Z" fill="url(#ceramic)"/>
        <path d="M-105 -3 4 -5 20 -11 24 2 5 12 -105 13Z" fill="#a8684d"/>
        <path d="M-97 -4 -18 -5 -16 9 -97 10Z" fill="#c38a60"/>
        <path d="M-94 -4v13m12 -13v13m12 -14V9m12 -14V9m12 -14V9m12 -14V9m12 -14V9" stroke="#764c45" stroke-width="1.4"/>
        <path d="M-121 -8 -108 -10 -103 -3 -105 9 -120 9Z" fill="#222540"/>
        <path d="M-120 -6v11" stroke="#8de4f7" stroke-width="3"/>
        <path d="M-69 -17h9m5 0h9" stroke="#fff0c3" stroke-width="2"/>
        </g>''' for y in (-33, 37)
    )
    return f'''<g stroke-linejoin="round">
    <path d="M-131 -36 -68 -54 -44 -35 40 -22 96 -14 139 0 111 24 24 32 -38 30 -61 49 -129 50 -148 18 -148 -14Z"
      fill="#11172a" stroke="#16182d" stroke-width="3"/>
    <path d="M-90 -22 -53 -42 41 -27 99 -20 139 0 89 10 31 14 -48 9 -90 1Z" fill="url(#ceramic)"/>
    <path d="M-90 1 -48 9 31 14 89 10 139 0 111 24 24 32 -51 28 -90 22Z" fill="#58677a"/>
    <path d="M-113 -19 -85 -26 -59 -13 -56 17 -79 34 -110 35 -131 18 -131 -8Z" fill="#444e66"/>
    <path d="M-100 -15 -82 -17 -61 -7 -65 4 -102 7 -120 2Z" fill="#8e98a5"/>
    <path d="M-127 8 -75 9 -75 18 -127 20Z" fill="#1d233a"/>
    <path d="M-130 10v8m8 -9v9m8 -9v9" stroke="#b2f2ff" stroke-width="2"/>
    {pods}
    <path d="M-27 -22 -13 -33 25 -31 78 -22 98 -12 82 0 38 8 -17 1 -33 -7Z" fill="url(#ceramic)" stroke="#465269" stroke-width="1.6"/>
    <path d="M39 -29 75 -23 98 -12 83 -6 49 -11 30 -18Z" fill="#244b67" stroke="#27374e"/>
    <path d="M44 -25 74 -20 91 -12 78 -10 50 -15 37 -20Z" fill="#84dbef"/>
    <path d="M57 -24 61 -14m10 -7 5 10" stroke="#304d67" stroke-width="2"/>
    <path d="M-23 -20 0 -25 24 -24 18 -19 -1 -17 -25 -12Z" fill="#bb6c4f"/>
    <path d="M-17 -4 12 0m4 0 7 1M24 23l37 -7m-68 12 22 -1m83 -13 13 -3" stroke="#aab9bf" opacity=".58"/>
    <path d="M6 16 19 17 17 22 6 21Z" fill="#eea26b"/>
    <circle cx="-82" cy="-50" r="2" fill="#fb975e"/><circle cx="-82" cy="53" r="2" fill="#fb975e"/>
    </g>'''


def flight(shadow, middle, light, landmark):
    station = {
        "wheel": '''<ellipse cx="0" cy="0" rx="43" ry="20" fill="none" stroke-width="5"/><path d="M-42 0h84M0 -20v40m-30 -15 60 30m0 -30-60 30M0 -43v22m0 41v15"/>''',
        "derrick": '''<path d="M-46 13H45L33 5H-35ZM-20 4l8-51h23l8 51M-7 -43l14 45m0 -45L-7 2M-30 6v-29h12m35 8h13V6"/><path d="M0 -50v-16M-14 -40h28"/>''',
        "array": '''<path d="M-49 -18h33v29h-33Zm64 0h34v29H15ZM-15 -3h30M0 -35v56M-43 -18v29m8 -29v29m8 -29v29m49 -29v29m8 -29v29m8 -29v29"/>''',
        "spindle": '''<path d="M-53 -3 -17 -17 29 -16 47 0 27 15 -19 14ZM-38 5h75M-13 -15v29m34 -29v29M7 -16v-21L22 -25 7-22"/>''',
        "aperture": '''<path d="m-44 -22 24-17h39l26 17v36L19 32h-39l-24-18Zm11 5 17-12h31l18 12V8L15 21h-31L-33 8ZM-51 -10h18m66 0h18M-7 -39v-15H7v15"/>''',
        "anchor": '''<path d="M-37 -37v27L0 22l37-32v-27m-37 59v20M-44 -25h19m50 0h19M-11 -30 0-39l11 9V9L0 17-11 9Zm-2 60h26M-12 42h24"/>''',
        "bazaar": '''<ellipse cx="-26" cy="0" rx="24" ry="19"/><ellipse cx="26" cy="0" rx="24" ry="19"/><path d="M-49 0H49m-75 -19v38m52 -38v38M0 -30v60m-14 -44 28 28m0 -28-28 28"/>''',
    }[landmark]
    return f'''<defs>
    <radialGradient id="sky"><stop stop-color="{middle}" stop-opacity=".46"/><stop offset="1" stop-color="#101126" stop-opacity="0"/></radialGradient>
    <radialGradient id="world" cx=".33" cy=".25" r=".79"><stop stop-color="{middle}"/><stop offset=".49" stop-color="{shadow}"/><stop offset="1" stop-color="#141326"/></radialGradient>
    <linearGradient id="limb" x2="1" y2="1"><stop stop-color="{light}"/><stop offset=".64" stop-color="{middle}"/><stop offset="1" stop-color="{shadow}" stop-opacity=".06"/></linearGradient>
    <clipPath id="body"><circle cx="355" cy="181" r="156"/></clipPath></defs>
    <ellipse cx="260" cy="153" rx="320" ry="184" fill="url(#sky)"/>
    {stars()}
    <g opacity=".48" stroke="{light}" fill="none">
      <path d="M35 248 Q135 98 330 61" stroke-dasharray="3 9"/>
      <path d="M48 240v-14m-7 7h14M140 97V83m-7 7h14M365 35V21m-7 7h14"/>
    </g>
    <circle cx="355" cy="181" r="165" fill="none" stroke="{light}" stroke-opacity=".15"/>
    <circle cx="355" cy="181" r="160" fill="none" stroke="{light}" stroke-opacity=".29"/>
    <circle cx="355" cy="181" r="156" fill="url(#world)" stroke="url(#limb)" stroke-width="4"/>
    <g clip-path="url(#body)" fill="none" stroke-linecap="round">
      <path d="M177 186 Q217 146 259 147T352 103T494 55M174 218 Q241 170 307 164T402 109T512 103M160 257 Q232 204 304 209T402 170T504 158M199 290 Q241 251 314 246T439 202T539 195" stroke="{middle}" stroke-width="13" opacity=".50"/>
      <path d="M178 162 Q230 114 269 121T388 82T484 45M182 210 Q222 170 263 166M212 242Q276 204 324 217T427 175M282 282Q323 277 375 255T505 212" stroke="{light}" opacity=".24" stroke-width="3"/>
      <path d="M198 190 Q239 163 267 171M236 90q35 -14 64 -12m-72 190q29 -16 67 -15m91 -149q33 -14 54 -14" stroke="{light}" opacity=".3"/>
    </g>
    <g transform="translate(336 131) rotate(12)" fill="none" stroke="#1a1b32" stroke-width="8" stroke-linejoin="round">{station}</g>
    <g transform="translate(336 131) rotate(12)" fill="none" stroke="{light}" stroke-width="2.7" stroke-linejoin="round">{station}<circle cx="-20" cy="7" r="2" fill="#fff0b6"/></g>
    <g transform="translate(207 294) rotate(-21) scale(1.13)">
      <path d="M-144 -38 -225 -33 -144 -30M-144 31 -225 37 -144 40" fill="#71cce6" opacity=".38"/>
      <path d="M-149 -36l-48 3 48 1m0 66-48 3 48 1" fill="none" stroke="#b8f2ff" stroke-width="2"/>
      {freighter()}
    </g>'''


def hangar(cargo=False):
    crates = ''.join(
        f'''<g transform="translate({x} {y}) scale({s})"><path d="M0 0 45 -12 80 4 35 20Z" fill="#9a8466"/>
        <path d="M0 0 35 20V51L0 33Z" fill="#34243d"/><path d="M35 20 80 4v34L35 51Z" fill="#916049"/>
        <path d="M38 24 75 12v21L38 46ZM59 16v23" fill="none" stroke="#ca9a6d" stroke-width="2"/></g>'''
        for x, y, s in [(19, 320, 1.1), (52, 357, .85), (368, 331, .8), (417, 372, 1.15)]
    )
    trusses = ''.join(
        f'<path d="M{x} 0 {x + (44 if x < 240 else -44)} 198 {x} 402" stroke="#1f2136" stroke-width="19" fill="none"/>'
        for x in (12, 75, 125, 355, 405, 468)
    )
    rails = ''.join(f'<path d="M240 229 {x} 505"/>' for x in range(-250, 800, 75))
    return f'''<defs>
      <linearGradient id="hangar" x2="0" y2="1"><stop stop-color="#2a2035"/><stop offset=".56" stop-color="#4c3142"/><stop offset="1" stop-color="#15172d"/></linearGradient>
      <radialGradient id="floor"><stop stop-color="#a96b4e"/><stop offset=".7" stop-color="#4b3242"/><stop offset="1" stop-color="#211c31"/></radialGradient></defs>
    <path d="M0 0h480v510H0Z" fill="url(#hangar)"/>
    <path d="M97 40 133 9h215l35 31v242H97Z" fill="#6e4749" stroke="#1a192f" stroke-width="9"/>
    <path d="M119 57 155 27h168l38 30v195H119Z" fill="#11192c" stroke="#d18451" stroke-width="3"/>
    <svg x="123" y="35" width="234" height="223" viewBox="60 100 350 325">
      {stars()}<path d="M35 359Q210 180 441 299v130H40Z" fill="#444b77" stroke="#9bcde5" stroke-width="4"/>
      <path d="M55 373Q223 218 441 317" fill="none" stroke="#65799c" stroke-width="9" opacity=".7"/>
    </svg>
    <path d="M0 280 132 214H347l133 66v242H0Z" fill="url(#floor)"/>
    <g opacity=".5" stroke="#b98362" stroke-width="1">{rails}<path d="M0 287h480M0 313h480M0 349h480M0 400h480M0 474h480"/></g>
    {trusses}
    <path d="M-20 0 143 42 162 81 160 126 94 102-20 109ZM500 0 338 42 319 81l1 45 66-24 114 7Z" fill="#1a1c31"/>
    <g stroke="#d89361" fill="none"><path d="M9 91 113 89 155 107M471 91l-104-2-42 18" stroke-width="5"/><path d="M10 97 113 95 155 113M470 97l-103-2-42 18" opacity=".6"/><path d="M24 299 113 248m254 0 89 51" stroke-width="4"/></g>
    <g fill="#e8a570"><circle cx="84" cy="201" r="3"/><circle cx="396" cy="201" r="3"/><circle cx="30" cy="284" r="3"/><circle cx="450" cy="284" r="3"/></g>
    <ellipse cx="234" cy="345" rx="174" ry="29" fill="#211a2b" opacity=".68"/>
    <path d="M82 359 154 303h165l75 56-37 33H118Z" fill="none" stroke="#d6976b" stroke-width="2" stroke-dasharray="13 6" opacity=".75"/>
    <g transform="translate(226 292) rotate(-11) scale({1.04 if cargo else 1.12})">{freighter()}</g>
    {crates if cargo else ''}
    <path d="M0 352 59 407 153 434H0ZM480 352l-59 55-94 27h153Z" fill="#15192e"/>
    '''


def market():
    booths = "".join(
        f'''<g transform="translate({x} 0)">
        <path d="M-69 147h138v129H-69Z" fill="#30253f" stroke="#211b33" stroke-width="5"/>
        <path d="M-58 154h116v54H-58Z" fill="#1b2037" stroke="#9a6357" stroke-width="2"/>
        <path d="M-56 174H56m-112 22H56" stroke="#826474"/>
        <path d="M-48 159h20v12h-20zm31 21h16v12h-16zm28-21h10v12H11zm21 5h16v7H32z" fill="#f5bb7e"/>
        <path d="M-67 199H67l20 21H-87Z" fill="#cb8a63"/>
        <path d="M-87 220H87l-13 18H-74Z" fill="#704959"/>
        <path d="M-74 238H74v54H-74Z" fill="#472f48"/>
        <path d="M-66 246H66v30H-66Z" fill="#533a51" stroke="#8f5960"/>
        <path d="M-52 262h40m25 0h39" stroke="#ac706b" stroke-width="3"/>
        </g>''' for x in (92, 387)
    )
    return f'''<defs><linearGradient id="market-wall" x2="0" y2="1">
        <stop stop-color="#181a31"/><stop offset="1" stop-color="#654153"/></linearGradient></defs>
    <path d="M0 0h480v465H0Z" fill="url(#market-wall)"/>
    <path d="M145 20h190l37 54v190H108V74Z" fill="#161b32" stroke="#2d2841" stroke-width="9"/>
    <path d="M163 43h154l33 44v157H130V87Z" fill="#313454" stroke="#8c6c7c" stroke-width="3"/>
    <svg x="135" y="46" width="210" height="210" viewBox="60 40 340 340">
      {stars()}<path d="M0 272Q236 101 415 240v200H0Z" fill="#624a75" stroke="#c29ac6" stroke-width="5"/>
      <path d="M63 242Q218 159 365 216m-251 21q103-49 209-31" fill="none" stroke="#916f9d" stroke-width="4"/>
    </svg>
    <path d="M0 226h480v241H0Z" fill="#2e253d"/>
    <path d="M164 240h151l116 140H50Z" fill="#49384d" stroke="#746077"/>
    <path d="M243 252v130m-91-125h182m-202 24h222m-261 48h301" stroke="#70556a"/>
    <path d="M-8 89h146l28 45-7 20H-8Zm496 0H343l-28 45 7 20h166Z" fill="#29233a" stroke="#523b55" stroke-width="3"/>
    <path d="M1 139h147m184 0h148" stroke="#f7b97e" stroke-width="5"/>
    {booths}
    <path d="M-10 314 117 304l78 56L58 393H-10Zm500 0-127-10-78 56 137 33h68Z" fill="#191b31" stroke="#503952" stroke-width="3"/>
    <path d="m38 314 76-4 54 42-79 14Zm274 32 47-36 78 4-35 48Z" fill="#694758"/>
    <path d="m97 330 37 20m211-23 49 15" stroke="#f4b275" stroke-width="4"/>
    '''


def render(name, scene):
    style = '''<defs>
      <linearGradient id="ceramic" x2="1" y2="1"><stop stop-color="#fff0ca"/><stop offset=".53" stop-color="#c3bca9"/><stop offset="1" stop-color="#737f95"/></linearGradient>
      <linearGradient id="fade" x2="0" y2="1"><stop stop-color="#151326" stop-opacity="0"/><stop offset=".56" stop-color="#151326" stop-opacity=".2"/><stop offset="1" stop-color="#151326"/></linearGradient>
    </defs>'''
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="480" height="500" viewBox="0 0 480 500">
      {style}<path d="M0 0h480v500H0Z" fill="#121529"/>{scene}<path d="M0 357h480v143H0Z" fill="url(#fade)"/>
    </svg>'''
    with TemporaryDirectory() as folder:
        source, raw = Path(folder) / "scene.svg", Path(folder) / "scene.png"
        source.write_text(svg, encoding="utf-8")
        run(["inkscape", str(source), "--export-width=720", f"--export-filename={raw}"], check=True)
        with Image.open(raw) as image:
            image.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT).save(OUT / f"{name}.png", optimize=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, *palette in PORTS:
        render(name, flight(*palette))
    render("hangar", hangar())
    render("cargo", hangar(cargo=True))
    render("market", market())
