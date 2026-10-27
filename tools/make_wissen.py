"""Erzeugt den Wissensbereich als statische Seiten (gut für Suchmaschinen):
  wissen/index.html        (Deutsch)
  en/knowledge/index.html  (Englisch)

Inhalte stehen unten in ENTRIES, je Begriff Deutsch und Englisch. Querverweise: [[id]] wird zum Link
auf den Begriff mit dem jeweiligen Titel. Zeichnungen sind Inline-SVG und nutzen die Farben aus css/app.css.

Aufruf: python tools/make_wissen.py
"""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- Zeichnungen

PAPER = "#f4f1e8"
INK = "#151515"


def fig_moa(L):
    # Winkel übertrieben, nicht maßstäblich
    return f"""<svg viewBox="0 0 400 170" role="img" aria-label="{L['aria']}">
  <line x1="24" y1="85" x2="260" y2="85" class="f-thin" stroke-dasharray="3 3"/>
  <path d="M24 85 L260 30 M24 85 L260 140" class="f-acc"/>
  <path d="M24 85 L260 70 M24 85 L260 100" class="f-line"/>
  <line x1="260" y1="22" x2="260" y2="148" class="f-line"/>
  <circle cx="24" cy="85" r="3" class="f-dot"/>
  <text x="24" y="108" class="f-txt" text-anchor="middle">{L['eye']}</text>
  <path d="M266 70 h6 v30 h-6" class="f-line" fill="none"/>
  <text x="278" y="83" class="f-txt">1 MOA</text>
  <text x="278" y="96" class="f-txt">= {L['moacm']}</text>
  <path d="M340 30 h6 v110 h-6" class="f-acc" fill="none"/>
  <text x="352" y="80" class="f-txt acc">1 mrad</text>
  <text x="352" y="93" class="f-txt acc">= 10 cm</text>
  <text x="142" y="162" class="f-txt" text-anchor="middle">{L['dist']}</text>
  <text x="142" y="16" class="f-small" text-anchor="middle">{L['note']}</text>
</svg>"""


def scope_view(cx, cy, r, mag, ffp, clip_id):
    # Blick durchs Zielfernrohr: Ringscheibe wächst mit der Vergrößerung, Absehen nur in der 1. Bildebene
    target = "".join(
        f'<circle cx="{cx}" cy="{cy}" r="{k * mag * 4}" fill="none" stroke="#777" stroke-width="0.8"/>' for k in (1, 2, 3)
    )
    step = mag * 4 if ffp else 12
    ticks = []
    for k in range(1, 6):
        d = k * step
        if d > r:
            break
        ticks += [
            f'<line x1="{cx + d}" y1="{cy - 3}" x2="{cx + d}" y2="{cy + 3}"/>',
            f'<line x1="{cx - d}" y1="{cy - 3}" x2="{cx - d}" y2="{cy + 3}"/>',
            f'<line x1="{cx - 3}" y1="{cy + d}" x2="{cx + 3}" y2="{cy + d}"/>',
        ]
    return f"""<clipPath id="{clip_id}"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath>
  <g clip-path="url(#{clip_id})">
    <rect x="{cx - r}" y="{cy - r}" width="{2 * r}" height="{2 * r}" fill="{PAPER}"/>
    {target}
    <g stroke="{INK}" stroke-width="1"><line x1="{cx - r}" y1="{cy}" x2="{cx + r}" y2="{cy}"/><line x1="{cx}" y1="{cy - r}" x2="{cx}" y2="{cy + r}"/>{''.join(ticks)}</g>
  </g>
  <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" class="f-line" stroke-width="3"/>"""


def fig_planes(L):
    return f"""<svg viewBox="0 0 340 260" role="img" aria-label="{L['aria']}">
  <text x="140" y="16" class="f-txt" text-anchor="middle">{L['low']}</text>
  <text x="270" y="16" class="f-txt" text-anchor="middle">{L['high']}</text>
  <text x="8" y="78" class="f-txt b">{L['ffp1']}</text><text x="8" y="92" class="f-small">{L['ffp2']}</text>
  <text x="8" y="198" class="f-txt b">{L['sfp1']}</text><text x="8" y="212" class="f-small">{L['sfp2']}</text>
  {scope_view(140, 80, 52, 1, True, 'pa')}{scope_view(270, 80, 52, 3.2, True, 'pb')}
  {scope_view(140, 200, 52, 1, False, 'pc')}{scope_view(270, 200, 52, 3.2, False, 'pd')}
</svg>"""


def reticle(cx, cy, r, kind, clip_id):
    g = []
    if kind in ("a4", "dot"):
        t = 7
        g += [
            f'<rect x="{cx - r}" y="{cy - t / 2}" width="{r - 16}" height="{t}" fill="{INK}"/>',
            f'<rect x="{cx + 16}" y="{cy - t / 2}" width="{r - 16}" height="{t}" fill="{INK}"/>',
            f'<rect x="{cx - t / 2}" y="{cy + 16}" width="{t}" height="{r - 16}" fill="{INK}"/>',
            f'<line x1="{cx - 16}" y1="{cy}" x2="{cx + 16}" y2="{cy}" stroke="{INK}" stroke-width="0.9"/>',
            f'<line x1="{cx}" y1="{cy - r}" x2="{cx}" y2="{cy + 16}" stroke="{INK}" stroke-width="0.9"/>',
        ]
        if kind == "dot":
            g.append(f'<circle cx="{cx}" cy="{cy}" r="2.6" fill="#e0301e"/><circle cx="{cx}" cy="{cy}" r="5" fill="#e0301e" opacity=".25"/>')
    else:
        g += [
            f'<line x1="{cx - r}" y1="{cy}" x2="{cx + r}" y2="{cy}" stroke="{INK}" stroke-width="0.9"/>',
            f'<line x1="{cx}" y1="{cy - r}" x2="{cx}" y2="{cy + r}" stroke="{INK}" stroke-width="0.9"/>',
        ]
        for k in range(-4, 5):
            if k:
                g += [f'<circle cx="{cx + k * 10}" cy="{cy}" r="1.6" fill="{INK}"/>', f'<circle cx="{cx}" cy="{cy + k * 10}" r="1.6" fill="{INK}"/>']
    return f"""<clipPath id="{clip_id}"><circle cx="{cx}" cy="{cy}" r="{r}"/></clipPath>
  <g clip-path="url(#{clip_id})"><rect x="{cx - r}" y="{cy - r}" width="{2 * r}" height="{2 * r}" fill="{PAPER}"/>{''.join(g)}</g>
  <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" class="f-line" stroke-width="3"/>"""


def fig_reticles(L):
    return f"""<svg viewBox="0 0 340 150" role="img" aria-label="{L['aria']}">
  {reticle(58, 62, 48, 'a4', 'ra')}{reticle(170, 62, 48, 'dot', 'rb')}{reticle(282, 62, 48, 'mil', 'rc')}
  <text x="58" y="130" class="f-txt" text-anchor="middle">{L['a4']}</text>
  <text x="170" y="130" class="f-txt" text-anchor="middle">{L['dot']}</text>
  <text x="282" y="130" class="f-txt" text-anchor="middle">{L['mil']}</text>
  <text x="282" y="143" class="f-small" text-anchor="middle">{L['milsub']}</text>
</svg>"""


def fig_trajectory(L):
    # Schematische Flugbahn: −4,5 cm an der Mündung (Montagehöhe), +4 cm auf 100 m, Fleck bei ca. 180 m, −4 cm bei ca. 210 m
    X = lambda m: 30 + m * 1.14
    Y = lambda cm: 62 - cm * 4.5
    pts = " ".join(f"{X(m):.1f},{Y(-0.00075 * m * m + 0.16 * m - 4.5):.1f}" for m in range(0, 251, 5))
    return f"""<svg viewBox="0 0 340 150" role="img" aria-label="{L['aria']}">
  <rect x="{X(0)}" y="{Y(4)}" width="{X(250) - X(0)}" height="{Y(-4) - Y(4)}" class="f-band"/>
  <line x1="{X(0)}" y1="{Y(0)}" x2="{X(250)}" y2="{Y(0)}" class="f-line" stroke-dasharray="4 3"/>
  <polyline points="{pts}" class="f-acc" fill="none"/>
  <text x="{X(0) + 2}" y="{Y(0) - 4}" class="f-small">{L['los']}</text>
  <text x="{X(250)}" y="{Y(4) - 4}" class="f-small" text-anchor="end">± 4 cm</text>
  <circle cx="{X(100)}" cy="{Y(4)}" r="2.5" class="f-dot"/>
  <text x="{X(100)}" y="{Y(4) - 8}" class="f-txt" text-anchor="middle">{L['m100']}</text>
  <circle cx="{X(33)}" cy="{Y(0)}" r="2.5" class="f-dot"/>
  <text x="{X(33) + 4}" y="{Y(0) + 13}" class="f-small">{L['near']}</text>
  <circle cx="{X(180)}" cy="{Y(0)}" r="3" class="f-dot acc"/>
  <text x="{X(180) + 6}" y="{Y(0) - 6}" class="f-txt acc">{L['gee']}</text>
  <circle cx="{X(210)}" cy="{Y(-4)}" r="2.5" class="f-dot"/>
  <text x="{X(210) - 6}" y="{Y(-4) + 13}" class="f-small" text-anchor="end">{L['minus']}</text>
  {''.join(f'<text x="{X(m)}" y="128" class="f-small" text-anchor="middle">{m} m</text>' for m in (0, 100, 200))}
  <text x="170" y="144" class="f-small" text-anchor="middle">{L['note']}</text>
</svg>"""


def fig_wind(L):
    import math
    n = L['nine']
    vals = {12: "0", 1: "½", 2: n, 3: L['full'], 4: n, 5: "½", 6: "0", 7: "½", 8: n, 9: L['full'], 10: n, 11: "½"}
    cx, cy, r = 170, 102, 62
    labels = []
    for h, v in vals.items():
        a = math.radians(h * 30 - 90)
        x, y = cx + math.cos(a) * (r + 16), cy + math.sin(a) * (r + 16) + 4
        x2, y2 = cx + math.cos(a) * r, cy + math.sin(a) * r
        x3, y3 = cx + math.cos(a) * (r - 7), cy + math.sin(a) * (r - 7)
        cls = "f-txt b acc" if v in (L['full'],) else "f-txt"
        labels.append(f'<line x1="{x2:.1f}" y1="{y2:.1f}" x2="{x3:.1f}" y2="{y3:.1f}" class="f-line"/><text x="{x:.1f}" y="{y:.1f}" class="{cls}" text-anchor="middle">{v}</text>')
    return f"""<svg viewBox="0 0 340 192" role="img" aria-label="{L['aria']}">
  <circle cx="{cx}" cy="{cy}" r="{r}" class="f-line" fill="none"/>
  {''.join(labels)}
  <path d="M{cx} {cy + 28} L{cx} {cy - 34}" class="f-line" stroke-width="3"/>
  <path d="M{cx - 6} {cy - 26} L{cx} {cy - 38} L{cx + 6} {cy - 26}" class="f-line" fill="none" stroke-width="2"/>
  <text x="{cx + 8}" y="{cy + 26}" class="f-small">{L['you']}</text>
  <text x="{cx}" y="{cy - r - 28}" class="f-small" text-anchor="middle">{L['target']}</text>
  <path d="M336 {cy} H{cx + r + 32}" class="f-acc" stroke-dasharray="5 3"/>
  <path d="M{cx + r + 40} {cy - 6} L{cx + r + 30} {cy} L{cx + r + 40} {cy + 6}" class="f-acc" fill="none"/>
  <text x="336" y="{cy + 18}" class="f-small acc" text-anchor="end">{L['wind']}</text>
</svg>"""


def fig_scope(L):
    return f"""<svg viewBox="0 0 340 150" role="img" aria-label="{L['aria']}">
  <path d="M20 58 L70 50 L70 100 L20 92 Z" class="f-body"/>
  <rect x="70" y="64" width="190" height="22" class="f-body"/>
  <path d="M260 60 L300 56 L320 56 L320 94 L300 94 L260 90 Z" class="f-body"/>
  <rect x="148" y="40" width="26" height="24" rx="3" class="f-body acc"/>
  <circle cx="161" cy="75" r="10" class="f-body acc"/>
  <circle cx="118" cy="75" r="8" class="f-body"/>
  <rect x="268" y="58" width="16" height="34" class="f-body"/>
  <line x1="300" y1="56" x2="300" y2="94" class="f-line"/>
  <path d="M161 40 V24" class="f-thin"/><text x="161" y="18" class="f-txt acc" text-anchor="middle">{L['elev']}</text>
  <path d="M161 85 V118" class="f-thin"/><text x="161" y="130" class="f-txt acc" text-anchor="middle">{L['wind']}</text>
  <path d="M118 83 L100 118" class="f-thin"/><text x="96" y="130" class="f-small" text-anchor="middle">{L['par']}</text>
  <path d="M45 92 V118" class="f-thin"/><text x="45" y="130" class="f-small" text-anchor="middle">{L['obj']}</text>
  <path d="M276 58 V34" class="f-thin"/><text x="276" y="28" class="f-small" text-anchor="middle">{L['mag']}</text>
  <path d="M310 94 V118" class="f-thin"/><text x="310" y="130" class="f-small" text-anchor="middle">{L['eye']}</text>
  <text x="215" y="58" class="f-small" text-anchor="middle">{L['tube']}</text>
  <text x="170" y="146" class="f-small" text-anchor="middle">{L['note']}</text>
</svg>"""


def fig_twist(L):
    stripes = "".join(f'<path d="M{x} 46 L{x + 44} 94" class="f-acc" stroke-width="2"/>' for x in range(30, 300, 22))
    return f"""<svg viewBox="0 0 340 140" role="img" aria-label="{L['aria']}">
  <defs><clipPath id="tw"><rect x="30" y="46" width="276" height="48" rx="4"/></clipPath></defs>
  <rect x="30" y="46" width="276" height="48" rx="4" class="f-body"/>
  <g clip-path="url(#tw)">{stripes}</g>
  <path d="M30 110 H306" class="f-line"/><path d="M30 104 V116 M306 104 V116" class="f-line"/>
  <text x="168" y="128" class="f-txt" text-anchor="middle">{L['len']}</text>
  <text x="168" y="34" class="f-txt" text-anchor="middle">{L['top']}</text>
</svg>"""


def fig_spread(L):
    hits = [(0, 0), (14, -6), (6, 12), (-8, 6), (-4, -10)]
    cx, cy, s = 145, 75, 3
    dots = "".join(f'<circle cx="{cx + x * s}" cy="{cy + y * s}" r="11" fill="{INK}"/>' for x, y in hits)
    mx = sum(x for x, _ in hits) / 5
    my = sum(y for _, y in hits) / 5
    return f"""<svg viewBox="0 0 340 160" role="img" aria-label="{L['aria']}">
  <rect x="50" y="8" width="190" height="144" rx="6" fill="{PAPER}"/>
  {dots}
  <line x1="{cx + 14 * s}" y1="{cy - 6 * s}" x2="{cx - 8 * s}" y2="{cy + 6 * s}" stroke="#e0301e" stroke-width="2"/>
  <g stroke="#b8860b" stroke-width="2.5"><line x1="{cx + mx * s - 10}" y1="{cy + my * s}" x2="{cx + mx * s + 10}" y2="{cy + my * s}"/><line x1="{cx + mx * s}" y1="{cy + my * s - 10}" x2="{cx + mx * s}" y2="{cy + my * s + 10}"/></g>
  <text x="248" y="60" class="f-txt b" fill="#e0301e">{L['es']}</text>
  <text x="248" y="74" class="f-small">{L['es2']}</text>
  <text x="248" y="104" class="f-txt b acc">{L['mpi']}</text>
  <text x="248" y="118" class="f-small">{L['mpi2']}</text>
</svg>"""


FIGS = {
    "moa": (fig_moa, {
        "de": {"aria": "Winkel MOA und mrad auf 100 m", "eye": "Auge", "dist": "100 m", "note": "nicht maßstäblich", "moacm": "2,91 cm"},
        "en": {"aria": "Angle of MOA and mrad at 100 m", "eye": "Eye", "dist": "100 m", "note": "not to scale", "moacm": "2.91 cm"},
    }),
    "planes": (fig_planes, {
        "de": {"aria": "Absehen in erster und zweiter Bildebene bei 3- und 12-facher Vergrößerung", "low": "3-fach", "high": "12-fach",
               "ffp1": "1. Bildebene", "ffp2": "wächst mit", "sfp1": "2. Bildebene", "sfp2": "bleibt gleich"},
        "en": {"aria": "Reticle in first and second focal plane at 3x and 12x", "low": "3×", "high": "12×",
               "ffp1": "First focal", "ffp2": "plane: grows", "sfp1": "Second focal", "sfp2": "plane: constant"},
    }),
    "reticles": (fig_reticles, {
        "de": {"aria": "Absehen 4, Leuchtpunkt und Mil-Dot", "a4": "Absehen 4", "dot": "mit Leuchtpunkt", "mil": "Mil-Dot / mrad", "milsub": "Punkte im Abstand 1 mrad"},
        "en": {"aria": "German No. 4 reticle, illuminated dot and Mil-Dot", "a4": "German No. 4", "dot": "with illuminated dot", "mil": "Mil-Dot / mrad", "milsub": "dots 1 mrad apart"},
    }),
    "trajectory": (fig_trajectory, {
        "de": {"aria": "Flugbahn mit 4 cm Hochschuss auf 100 m und GEE", "los": "Visierlinie", "m100": "+4 cm auf 100 m", "gee": "GEE ≈ 180 m",
               "near": "Nahfleck", "minus": "−4 cm bei ≈ 210 m", "note": "Beispiel, schematisch – echte Werte je nach Kaliber und Laborierung"},
        "en": {"aria": "Trajectory zeroed 4 cm high at 100 m with optimal zero range", "los": "Line of sight", "m100": "+4 cm at 100 m", "gee": "zero ≈ 180 m",
               "near": "near zero", "minus": "−4 cm at ≈ 210 m", "note": "example, schematic – real values depend on calibre and load"},
    }),
    "wind": (fig_wind, {
        "de": {"aria": "Uhrzeitmethode für Seitenwind", "full": "voll", "nine": "0,9", "you": "Schütze", "target": "Ziel (12 Uhr)", "wind": "Wind von 3 Uhr"},
        "en": {"aria": "Clock method for crosswind", "full": "full", "nine": "0.9", "you": "Shooter", "target": "Target (12 o’clock)", "wind": "wind from 3 o’clock"},
    }),
    "scope": (fig_scope, {
        "de": {"aria": "Aufbau eines Zielfernrohrs", "elev": "Höhenturm", "wind": "Seitenturm", "par": "Parallaxe", "obj": "Objektiv",
               "mag": "Vergrößerung", "eye": "Okular", "tube": "Mittelrohr", "note": "schematisch, Seitenansicht von rechts"},
        "en": {"aria": "Parts of a riflescope", "elev": "Elevation", "wind": "Windage", "par": "Parallax", "obj": "Objective",
               "mag": "Magnification", "eye": "Eyepiece", "tube": "Main tube", "note": "schematic, right side view"},
    }),
    "twist": (fig_twist, {
        "de": {"aria": "Drall im Lauf", "len": "Dralllänge, z. B. 1:11″ = eine Umdrehung auf 279 mm", "top": "Züge im Lauf (aufgeschnitten)"},
        "en": {"aria": "Rifling twist", "len": "Twist rate, e.g. 1:11″ = one turn in 279 mm", "top": "Rifling in the barrel (cut open)"},
    }),
    "spread": (fig_spread, {
        "de": {"aria": "Streukreis und mittlerer Treffpunkt", "es": "Streukreis", "es2": "Mitte zu Mitte", "mpi": "Treffpunkt", "mpi2": "Mittel aller Treffer"},
        "en": {"aria": "Group size and mean point of impact", "es": "Group size", "es2": "centre to centre", "mpi": "Point of impact", "mpi2": "mean of all hits"},
    }),
}

# ---------------------------------------------------------------- Inhalte

CATS = {
    "grund": {"de": "Einschießen", "en": "Zeroing"},
    "zf": {"de": "Zielfernrohr", "en": "Riflescope"},
    "ball": {"de": "Ballistik & Einflüsse", "en": "Ballistics & conditions"},
    "waffe": {"de": "Lauf & Munition", "en": "Barrel & ammunition"},
}

ENTRIES = [
    # --- Einschießen
    dict(id="einschiessen", cat="grund",
         de=("Einschießen", "Beim Einschießen stellst du das [[zielfernrohr|Zielfernrohr]] so ein, dass die Waffe dort trifft, wo du hinzielst – auf [[fleck|Fleck]] oder mit [[gee|GEE]]. Ablauf: [[gruppe|Gruppe]] schießen, [[mpi|mittleren Treffpunkt]] bestimmen, Korrektur in Klicks drehen, [[kontrollschuss|Kontrollschuss]]. Immer mit der Munition, dem [[schalldaempfer|Schalldämpfer]] und der Auflage, mit denen später auch geschossen wird."),
         en=("Zeroing", "Zeroing means adjusting the [[zielfernrohr|scope]] so the rifle hits where you aim – [[fleck|dead on]] or with a [[gee|hunting zero]]. Procedure: shoot a [[gruppe|group]], find the [[mpi|mean point of impact]], turn the correction in clicks, fire a [[kontrollschuss|confirmation shot]]. Always use the ammunition, [[schalldaempfer|suppressor]] and rest you will later shoot with.")),
    dict(id="haltepunkt", cat="grund",
         de=("Haltepunkt und Treffpunkt", "Der <b>Haltepunkt</b> ist die Stelle, auf die das Absehen beim Schuss zeigt, der <b>Treffpunkt</b> die Stelle, an der das Geschoss einschlägt. Beim Einschießen hältst du immer auf dieselbe Stelle, meist die Mitte des Fadenkreuzes auf der Scheibe. Der Abstand zwischen Haltepunkt und [[mpi|mittlerem Treffpunkt]] ist das, was du korrigierst."),
         en=("Point of aim and point of impact", "The <b>point of aim</b> is where the reticle points at the shot, the <b>point of impact</b> is where the bullet lands. When zeroing you always aim at the same spot, usually the centre of the crosshair on the target. The offset between point of aim and [[mpi|mean point of impact]] is what you correct.")),
    dict(id="fleck", cat="grund",
         de=("Fleckschuss und Hochschuss", "<b>Fleck</b> heißt: Treffpunkt gleich Haltepunkt auf der Einschießentfernung. <b>Hochschuss</b> heißt: Die Waffe trifft absichtlich etwas höher, typisch 4 cm auf 100 m. Dadurch liegt die Flugbahn über eine größere Entfernung im Trefferbereich des Wildes, siehe [[gee|GEE]]."),
         en=("Dead-on and high zero", "<b>Dead on</b> means point of impact equals point of aim at the zeroing distance. A <b>high zero</b> means the rifle deliberately hits a little high, typically 4 cm at 100 m. The trajectory then stays within the vital zone over a longer range, see [[gee|optimal zero range]].")),
    dict(id="gee", cat="grund", fig="trajectory",
         de=("GEE – Günstigste Einschießentfernung", "Die GEE ist die Entfernung, auf die eine Büchse Fleck schießt, wenn die Flugbahn auf dem Weg dorthin nie mehr als 4 cm über die Visierlinie steigt. In der Praxis schießt man auf 100 m 4 cm hoch ein; bei gängigen Jagdkalibern liegt die GEE dann etwa bei 150 bis 200 m. Bis etwas über die GEE hinaus bleibt der Treffer innerhalb von ±4 cm, so kann man ohne Haltepunktkorrektur schießen. Wie weit das genau reicht, hängt von [[v0|v0]], [[bc|BC]] und [[montage|Montagehöhe]] ab."),
         en=("Optimal zero range (GEE)", "The German “GEE” is the distance at which a rifle hits dead on when the trajectory never rises more than 4 cm above the line of sight on the way. In practice you zero 4 cm high at 100 m; with common hunting calibres the zero is then roughly at 150 to 200 m. Up to a little beyond that the hit stays within ±4 cm, so you can shoot without holdover. How far exactly depends on [[v0|muzzle velocity]], [[bc|BC]] and [[montage|sight height]].")),
    dict(id="gruppe", cat="grund",
         de=("Schussgruppe", "Mehrere Schüsse mit gleichem [[haltepunkt|Haltepunkt]] und unveränderter Einstellung. Ein Einzelschuss sagt wenig, weil jede Waffe streut. Drei Schuss sind das Minimum, fünf sind deutlich aussagekräftiger. Zwischen den Gruppen den Lauf abkühlen lassen, siehe [[laufwaerme|Laufwärme]]."),
         en=("Group", "Several shots with the same [[haltepunkt|point of aim]] and unchanged settings. A single shot says little because every rifle disperses. Three shots are the minimum, five are much more meaningful. Let the barrel cool between groups, see [[laufwaerme|barrel heat]].")),
    dict(id="streukreis", cat="grund", fig="spread",
         de=("Streukreis", "Der größte Abstand zwischen zwei Treffern einer [[gruppe|Gruppe]], gemessen von Lochmitte zu Lochmitte. Er beschreibt die Präzision von Waffe, Munition und Schütze zusammen. Als Winkel ausgedrückt ([[moa|MOA]] oder [[mrad|mrad]]) lassen sich Gruppen auf verschiedenen Entfernungen vergleichen."),
         en=("Group size", "The largest distance between two hits of a [[gruppe|group]], measured centre to centre. It describes the precision of rifle, ammunition and shooter together. Expressed as an angle ([[moa|MOA]] or [[mrad|mrad]]) groups at different distances can be compared.")),
    dict(id="mpi", cat="grund",
         de=("Mittlerer Treffpunkt", "Der Schwerpunkt aller Treffer einer [[gruppe|Gruppe]]. Korrigiert wird immer auf ihn, nie auf einen einzelnen Schuss. Sein Abstand zum Zielpunkt in Zentimetern, geteilt durch den [[klickwert|Klickwert]] auf der jeweiligen Entfernung, ergibt die Zahl der Klicks."),
         en=("Mean point of impact", "The centre of all hits of a [[gruppe|group]]. You always correct towards it, never towards a single shot. Its offset from the target point in centimetres, divided by the [[klickwert|click value]] at that distance, gives the number of clicks.")),
    dict(id="ausreisser", cat="grund",
         de=("Ausreißer", "Ein Treffer, der deutlich außerhalb der übrigen liegt. Typische Ursachen: [[oelschuss|Ölschuss]], Verreißen beim Abziehen, ein Windstoß, Kontakt der Waffe mit der Auflage. Ein Ausreißer mit erkennbarer Ursache sollte nicht in die Korrektur eingehen; wiederholen sich Ausreißer, liegt das Problem bei Waffe, Montage oder Munition."),
         en=("Flyer", "A hit that lies clearly outside the others. Typical causes: [[oelschuss|clean-bore shot]], jerking the trigger, a gust of wind, the rifle touching the rest. A flyer with a known cause should not go into the correction; if flyers keep happening, the problem lies with rifle, mount or ammunition.")),
    dict(id="kontrollschuss", cat="grund",
         de=("Kontrollschuss", "Ein Schuss nach dem Verstellen, um die Korrektur zu bestätigen. Er sollte im [[streukreis|Streukreis]] um den neuen Zielpunkt liegen. Liegt er weit daneben, obwohl die Waffe ruhig lag, Drehrichtung, [[klickwert|Klickwert]] und [[montage|Montage]] prüfen."),
         en=("Confirmation shot", "A shot after adjusting to confirm the correction. It should land inside the [[streukreis|group size]] around the new target point. If it is far off although the rifle was steady, check turning direction, [[klickwert|click value]] and [[montage|mount]].")),
    dict(id="oelschuss", cat="grund",
         de=("Ölschuss und kalter Lauf", "Der erste Schuss aus einem frisch gereinigten oder geölten Lauf trifft oft anders als die folgenden: Ölreste und blanker Stahl ändern Reibung und Gasdruck. Deshalb nach der Reinigung trocken durchziehen und vor dem Einschießen ein bis zwei Schuss abgeben, die nicht gewertet werden. Verwandt ist der <b>Kaltschuss</b>: der erste Schuss aus einem kalten Lauf. Für die Jagd ist genau er entscheidend – prüfe ab und zu, wo der erste Schuss des Tages sitzt."),
         en=("Clean-bore shot and cold bore", "The first shot from a freshly cleaned or oiled barrel often hits differently from the following ones: oil residue and bare steel change friction and gas pressure. So dry the bore after cleaning and fire one or two fouling shots that don’t count before zeroing. Related is the <b>cold-bore shot</b>: the first shot from a cold barrel. For hunting this is exactly the one that matters – check now and then where the first shot of the day lands.")),
    # --- Zielfernrohr
    dict(id="zielfernrohr", cat="zf", fig="scope",
         de=("Aufbau eines Zielfernrohrs", "Vorne das Objektiv, hinten das Okular mit Dioptrienausgleich, dazwischen das Mittelrohr (meist 30 oder 34 mm) mit den [[tuerme|Türmen]]: oben Höhe, rechts Seite, links bei vielen Modellen die [[parallaxe|Parallaxe]]. Am Vergrößerungsring stellst du den Zoom ein. Die Position des [[absehen|Absehens]] im Strahlengang bestimmt die [[bildebenen|Bildebene]]."),
         en=("Parts of a riflescope", "At the front the objective, at the back the eyepiece with diopter adjustment, in between the main tube (usually 30 or 34 mm) with the [[tuerme|turrets]]: elevation on top, windage on the right, [[parallaxe|parallax]] on the left on many models. The magnification ring sets the zoom. Where the [[absehen|reticle]] sits in the optical path decides the [[bildebenen|focal plane]].")),
    dict(id="moa", cat="zf", fig="moa",
         de=("MOA – Winkelminute", "Eine Winkelminute (Minute of Angle) ist 1/60 Grad. Auf 100 m entspricht das 2,91 cm, auf 200 m 5,82 cm – der Abstand wächst mit der Entfernung. Zielfernrohre mit MOA-Verstellung haben meist 1/4 MOA je Klick, also rund 0,73 cm auf 100 m. Manche Hersteller rechnen mit „Inch per 100 Yards“ (2,78 cm auf 100 m), das ist etwas weniger als eine echte MOA."),
         en=("MOA – minute of angle", "A minute of angle is 1/60 of a degree. At 100 m that is 2.91 cm, at 200 m 5.82 cm – the size grows with distance. Scopes with MOA adjustment usually have 1/4 MOA per click, about 0.73 cm at 100 m. Some makers use “inch per 100 yards” (2.78 cm at 100 m), slightly less than a true MOA.")),
    dict(id="mrad", cat="zf",
         de=("mrad – Milliradiant", "Ein tausendstel Radiant. Auf 100 m sind das 10 cm, auf 300 m 30 cm. Mit 0,1 mrad je Klick verstellt ein Klick also 1 cm auf 100 m – das rechnet sich leicht im Kopf. 1 mrad entspricht 3,44 [[moa|MOA]]. Wichtig ist, dass [[absehen|Absehen]] und [[tuerme|Türme]] dieselbe Einheit haben."),
         en=("mrad – milliradian", "One thousandth of a radian. At 100 m that is 10 cm, at 300 m 30 cm. With 0.1 mrad per click one click moves 1 cm at 100 m – easy mental maths. 1 mrad equals 3.44 [[moa|MOA]]. What matters is that [[absehen|reticle]] and [[tuerme|turrets]] use the same unit.")),
    dict(id="klickwert", cat="zf",
         de=("Klickwert", "Wie weit ein Klick am Turm den Treffpunkt verschiebt, als Winkel. Üblich sind 0,1 mrad (1 cm auf 100 m) oder 1/4 MOA (0,73 cm auf 100 m). Rechnung: Klicks = Abweichung in cm ÷ (Klickwert in cm auf 100 m × Entfernung ÷ 100). Beispiel: 6 cm tief auf 100 m bei 0,1 mrad → 6 Klicks hoch."),
         en=("Click value", "How far one click on the turret moves the point of impact, as an angle. Common are 0.1 mrad (1 cm at 100 m) or 1/4 MOA (0.73 cm at 100 m). Formula: clicks = offset in cm ÷ (click value in cm at 100 m × distance ÷ 100). Example: 6 cm low at 100 m with 0.1 mrad → 6 clicks up.")),
    dict(id="tuerme", cat="zf",
         de=("Türme, Drehrichtung und Nullstellung", "Der Höhenturm verschiebt den Treffpunkt nach oben oder unten, der Seitenturm nach rechts oder links. Die Pfeile (U/Up, R) zeigen, in welche Richtung sich der <b>Treffpunkt</b> bewegt. Nach dem Einschießen lässt sich bei vielen Türmen die Skala auf null setzen, ohne die Einstellung zu ändern. Eine <b>Nullstopp</b>-Funktion verhindert, unter den eingeschossenen Wert zu drehen."),
         en=("Turrets, direction and zero reset", "The elevation turret moves the point of impact up or down, the windage turret right or left. The arrows (U/Up, R) show which way the <b>point of impact</b> moves. After zeroing, many turrets let you reset the scale to zero without changing the setting. A <b>zero stop</b> prevents turning below the zeroed value.")),
    dict(id="bildebenen", cat="zf", fig="planes",
         de=("Erste und zweite Bildebene", "In der <b>ersten Bildebene</b> (FFP) wächst das [[absehen|Absehen]] mit der Vergrößerung mit. Seine Abstände (z. B. 1 [[mrad|mrad]] zwischen zwei Punkten) stimmen dadurch bei jeder Vergrößerung. In der <b>zweiten Bildebene</b> (SFP) bleibt das Absehen immer gleich groß, das Ziel wird größer. Die Abstände stimmen dann nur bei einer Vergrößerung, meist der höchsten. Auf der Drückjagd schätzen viele die SFP, weil das Absehen bei kleiner Vergrößerung gut sichtbar bleibt."),
         en=("First and second focal plane", "In the <b>first focal plane</b> (FFP) the [[absehen|reticle]] grows with magnification, so its spacings (e.g. 1 [[mrad|mrad]] between dots) are correct at every magnification. In the <b>second focal plane</b> (SFP) the reticle always stays the same size while the target grows; spacings are only correct at one magnification, usually the highest. For driven hunts many prefer SFP because the reticle stays clearly visible at low magnification.")),
    dict(id="absehen", cat="zf", fig="reticles",
         de=("Absehen", "Die Zielmarke im Zielfernrohr. Im deutschsprachigen Raum verbreitet ist das <b>Absehen 4</b>: drei dicke Balken und ein feines Fadenkreuz in der Mitte. Ein <b>Leuchtpunkt</b> hilft in der Dämmerung. Absehen mit [[mrad|mrad]]- oder [[moa|MOA]]-Teilung (z. B. Mil-Dot) erlauben Haltepunktkorrekturen und Entfernungsschätzung, sofern [[bildebenen|Bildebene]] und Vergrößerung passen."),
         en=("Reticle", "The aiming mark in the scope. Common in German-speaking countries is the <b>No. 4 reticle</b>: three thick posts and a fine crosshair in the centre. An <b>illuminated dot</b> helps at dusk. Reticles with [[mrad|mrad]] or [[moa|MOA]] marks (e.g. Mil-Dot) allow holdover and range estimation, provided [[bildebenen|focal plane]] and magnification match.")),
    dict(id="parallaxe", cat="zf",
         de=("Parallaxe", "Liegen Zielbild und Absehen nicht in derselben Ebene, wandert das Absehen auf dem Ziel, wenn du den Kopf bewegst. Jagdzielfernrohre sind meist auf 100 m parallaxefrei eingestellt. Auf anderen Entfernungen hilft ein Parallaxeausgleich oder eine immer gleiche Kopfhaltung mit dem Auge mittig hinter dem Okular."),
         en=("Parallax", "If the target image and the reticle are not in the same plane, the reticle moves on the target when you move your head. Hunting scopes are usually parallax-free at 100 m. At other distances a parallax adjustment helps, or a consistent head position with the eye centred behind the eyepiece.")),
    dict(id="augenabstand", cat="zf",
         de=("Augenabstand", "Der Abstand zwischen Okular und Auge, bei dem das Bild voll ausgeleuchtet ist, meist 8 bis 10 cm. Ist er zu kurz, droht beim Rückstoß ein Cut an der Augenbraue („Zielfernrohrbiss“). Montiere das Zielfernrohr so, dass du in Schussposition ohne Kopfverrenken ein randscharfes, schattenfreies Bild hast."),
         en=("Eye relief", "The distance between eyepiece and eye at which the image is fully lit, usually 8 to 10 cm. If it is too short, recoil can cut the eyebrow (“scope bite”). Mount the scope so that in shooting position you get a full, shadow-free image without straining your neck.")),
    dict(id="montage", cat="zf",
         de=("Montage und Montagehöhe", "Die Montage verbindet Zielfernrohr und Waffe. Schrauben mit dem vom Hersteller angegebenen Drehmoment anziehen – zu locker wandert die Treffpunktlage, zu fest kann das Mittelrohr leiden. Die <b>Montagehöhe</b> ist der Abstand zwischen Laufachse und Zielfernrohrmitte. Sie bestimmt, wie die Flugbahn die Visierlinie kreuzt, und gehört in jeden Ballistikrechner."),
         en=("Mount and sight height", "The mount connects scope and rifle. Tighten screws to the torque the maker specifies – too loose and the point of impact wanders, too tight and the tube can suffer. <b>Sight height</b> is the distance between bore axis and scope centre. It decides how the trajectory crosses the line of sight and belongs in every ballistic calculator.")),
    # --- Ballistik
    dict(id="v0", cat="ball",
         de=("v0 – Mündungsgeschwindigkeit", "Die Geschwindigkeit des Geschosses an der Mündung in m/s. Sie hängt von Laborierung, [[lauflaenge|Lauflänge]] und [[temperatur|Pulvertemperatur]] ab. Höhere v0 bedeutet flachere Flugbahn und weniger Windabdrift. Herstellerangaben gelten für einen Testlauf; der eigene Lauf kann deutlich abweichen."),
         en=("Muzzle velocity", "The speed of the bullet at the muzzle in m/s. It depends on the load, [[lauflaenge|barrel length]] and [[temperatur|powder temperature]]. Higher velocity means a flatter trajectory and less wind drift. Factory figures apply to a test barrel; your own barrel can differ noticeably.")),
    dict(id="bc", cat="ball",
         de=("Ballistischer Koeffizient (BC)", "Ein Maß dafür, wie gut ein Geschoss den Luftwiderstand überwindet. Je höher der BC, desto langsamer verliert das Geschoss Geschwindigkeit, desto flacher die Flugbahn und desto weniger [[wind|Wind]]abdrift. Angaben gibt es nach verschiedenen Modellen (G1, G7); vergleiche nur Werte desselben Modells."),
         en=("Ballistic coefficient (BC)", "A measure of how well a bullet overcomes air resistance. The higher the BC, the slower the bullet loses speed, the flatter the trajectory and the less [[wind|wind]] drift. Values are given for different models (G1, G7); only compare values of the same model.")),
    dict(id="gasgesetz", cat="ball",
         de=("Luftdichte und ideales Gasgesetz", "Der Luftwiderstand hängt von der Luftdichte ab. Nach dem idealen Gasgesetz gilt ρ = p ÷ (R<sub>s</sub> · T) mit R<sub>s</sub> = 287 J/(kg·K) für trockene Luft. Bei 15 °C und 1013 hPa sind das 1,225 kg/m³. Wärmer oder höher gelegen heißt dünnere Luft: bei 30 °C rund 5 % weniger, auf 1000 m Höhe rund 10 % weniger. Das Geschoss bremst dann weniger ab und trifft auf weite Entfernung höher. Auf 100 m spielt das praktisch keine Rolle, ab etwa 300 m schon."),
         en=("Air density and the ideal gas law", "Air resistance depends on air density. By the ideal gas law ρ = p ÷ (R<sub>s</sub> · T) with R<sub>s</sub> = 287 J/(kg·K) for dry air. At 15 °C and 1013 hPa that is 1.225 kg/m³. Warmer or higher up means thinner air: about 5 % less at 30 °C, about 10 % less at 1000 m altitude. The bullet slows down less and hits higher at long range. At 100 m this hardly matters, from about 300 m it does.")),
    dict(id="temperatur", cat="ball",
         de=("Pulvertemperatur", "Warmes Pulver verbrennt schneller, Gasdruck und [[v0|v0]] steigen. Je nach Pulver ändert sich die v0 um grob 0,5 bis 1,5 m/s pro Grad. Wer im Sommer einschießt und im Winter jagt, sollte vor der Saison kontrollieren. Patronen nicht in der prallen Sonne oder auf dem heißen Lauf liegen lassen."),
         en=("Powder temperature", "Warm powder burns faster, raising pressure and [[v0|muzzle velocity]]. Depending on the powder, velocity changes by roughly 0.5 to 1.5 m/s per degree. If you zero in summer and hunt in winter, check before the season. Don’t leave cartridges in direct sun or on a hot barrel.")),
    dict(id="wind", cat="ball", fig="wind",
         de=("Wind", "Seitenwind versetzt das Geschoss. Entscheidend ist nicht die Flugzeit, sondern die Verzögerung gegenüber einem Flug im Vakuum: Abdrift ≈ Windgeschwindigkeit × (Flugzeit − Entfernung ÷ [[v0|v0]]). Beispiel .308 Win mit v0 ≈ 820 m/s und 3 m/s Wind genau von der Seite: auf 100 m rund 1,5 cm, auf 300 m rund 13 cm. Nach der <b>Uhrzeitmethode</b> wirkt Wind von 3 oder 9 Uhr voll, von 1, 5, 7 und 11 Uhr etwa halb, von 2, 4, 8 und 10 Uhr fast voll. Zum Einschießen einen windstillen Tag wählen."),
         en=("Wind", "Crosswind pushes the bullet sideways. What matters is not the flight time but the delay compared with flight in a vacuum: drift ≈ wind speed × (flight time − distance ÷ [[v0|muzzle velocity]]). Example .308 Win at about 820 m/s with 3 m/s full-value wind: roughly 1.5 cm at 100 m, roughly 13 cm at 300 m. With the <b>clock method</b>, wind from 3 or 9 o’clock is full value, from 1, 5, 7 and 11 o’clock about half, from 2, 4, 8 and 10 o’clock almost full. Choose a calm day for zeroing.")),
    dict(id="schraeg", cat="ball",
         de=("Bergauf und bergab", "Beim Schuss steil bergauf oder bergab wirkt die Schwerkraft nur auf die waagrechte Entfernung. Das Geschoss trifft deshalb höher, als die gemessene Schrägentfernung vermuten lässt. Faustregel: mit der waagrechten Entfernung rechnen (Schrägentfernung × cos Winkel). Bei 30° sind das 87 %."),
         en=("Uphill and downhill", "When shooting steeply up or down, gravity only acts over the horizontal distance. The bullet therefore hits higher than the measured slant range suggests. Rule of thumb: use the horizontal distance (slant range × cos angle). At 30° that is 87 %.")),
    # --- Lauf & Munition
    dict(id="lauf", cat="waffe",
         de=("Lauf und Laufschwingungen", "Beim Schuss schwingt der Lauf wie eine Peitsche. Wo er gerade steht, wenn das Geschoss die Mündung verlässt, bestimmt die Treffpunktlage. Alles, was diese Schwingung ändert, verschiebt den Treffpunkt: andere Laborierung, [[schalldaempfer|Schalldämpfer]], Druck auf den Lauf, Zusatzgewicht. Ein <b>freischwingender</b> Lauf berührt den Schaft nicht und schießt dadurch gleichmäßiger. Deshalb gehört auch das Smartphone nie an den Lauf."),
         en=("Barrel and barrel harmonics", "When firing, the barrel whips like a lash. Where it is in that motion when the bullet leaves the muzzle decides the point of impact. Anything that changes the vibration shifts the point of impact: a different load, a [[schalldaempfer|suppressor]], pressure on the barrel, extra weight. A <b>free-floating</b> barrel doesn’t touch the stock and shoots more consistently. That is also why the smartphone never goes on the barrel.")),
    dict(id="laufwaerme", cat="waffe",
         de=("Laufwärme und Flimmern", "Mit jedem Schuss wird der Lauf wärmer; viele Läufe wandern dabei mit der Treffpunktlage. Über dem heißen Lauf flimmert die Luft und verzerrt das Zielbild. Zwischen den [[gruppe|Gruppen]] den Lauf abkühlen lassen, bis er sich mit der Hand nur noch handwarm anfühlt. Bei Jagdwaffen mit dünnem Lauf geht das schneller als man denkt."),
         en=("Barrel heat and mirage", "With every shot the barrel gets warmer; many barrels shift their point of impact as they heat up. Hot air above the barrel shimmers and distorts the image. Let the barrel cool between [[gruppe|groups]] until it only feels lukewarm to the touch. With thin hunting barrels this happens sooner than you think.")),
    dict(id="drall", cat="waffe", fig="twist",
         de=("Drall", "Die Züge im Lauf versetzen das Geschoss in Drehung und stabilisieren es. Die <b>Dralllänge</b> gibt an, auf welcher Strecke das Geschoss eine volle Umdrehung macht, z. B. 1:11″ = eine Umdrehung auf 11 Zoll (279 mm). Lange, schwere Geschosse brauchen einen schnelleren (kürzeren) Drall; eine alte Faustregel dafür ist die Greenhill-Formel. Bei Rechtsdrall wandert das Geschoss auf weite Entfernung leicht nach rechts (<b>Drallabweichung</b>) – auf 100 m sind das nur Millimeter."),
         en=("Twist", "The rifling spins the bullet and stabilises it. The <b>twist rate</b> states the distance over which the bullet makes one full turn, e.g. 1:11″ = one turn in 11 inches (279 mm). Long, heavy bullets need a faster (shorter) twist; an old rule of thumb for this is the Greenhill formula. With right-hand twist the bullet drifts slightly right at long range (<b>spin drift</b>) – at 100 m only millimetres.")),
    dict(id="lauflaenge", cat="waffe",
         de=("Lauflänge", "Ein längerer Lauf gibt dem Pulver mehr Zeit, das Geschoss zu beschleunigen: mehr [[v0|v0]], etwas flachere Flugbahn. Wie viel das ausmacht, hängt stark vom Kaliber ab – bei kurzen Kalibern wenig, bei Magnumkalibern mehr. Kürzere Läufe sind handlicher und mit [[schalldaempfer|Schalldämpfer]] beliebt."),
         en=("Barrel length", "A longer barrel gives the powder more time to accelerate the bullet: more [[v0|muzzle velocity]], a slightly flatter trajectory. How much depends strongly on the calibre – little for short cartridges, more for magnums. Shorter barrels are handier and popular with a [[schalldaempfer|suppressor]].")),
    dict(id="schalldaempfer", cat="waffe",
         de=("Schalldämpfer", "Ein Schalldämpfer ändert Gewicht und Schwingung am Laufende und damit meist die Treffpunktlage, oft um einige Zentimeter. Deshalb immer in der Konfiguration einschießen, in der gejagt wird, und nach jedem Abschrauben und Wiederaufsetzen kontrollieren."),
         en=("Suppressor", "A suppressor changes weight and vibration at the end of the barrel and so usually the point of impact, often by several centimetres. Always zero in the configuration you hunt with, and check again after removing and refitting it.")),
    dict(id="laborierung", cat="waffe",
         de=("Laborierung und Los", "Die <b>Laborierung</b> ist die genaue Zusammensetzung einer Patrone: Geschoss, Gewicht, Pulver, Ladung. Jede Laborierung hat ihre eigene Treffpunktlage, deshalb nach einem Wechsel neu einschießen. Ein <b>Los</b> ist eine Fertigungscharge; auch zwischen Losen derselben Patrone kann es kleine Unterschiede geben. Wer genau sein will, kauft für eine Saison Munition aus einem Los."),
         en=("Load and lot", "The <b>load</b> is the exact make-up of a cartridge: bullet, weight, powder, charge. Every load has its own point of impact, so re-zero after a change. A <b>lot</b> is a production batch; even lots of the same cartridge can differ slightly. If you want to be precise, buy a season’s ammunition from one lot.")),
]

# ---------------------------------------------------------------- Seite

PAGE = {
    "de": {
        "path": "wissen/index.html", "url": "https://nullpunkt.pro/wissen/", "other": "https://nullpunkt.pro/en/knowledge/",
        "title": "Wissen zum Einschießen: MOA, mrad, Bildebenen, Absehen, GEE, Drall | Nullpunkt",
        "desc": "Einschießen von A bis Z: Ölschuss, MOA und mrad mit Zeichnung, Klickwert, erste und zweite Bildebene, Absehen, GEE, Wind, Luftdichte, Lauf und Drall – kurz und verständlich erklärt.",
        "h1": "Wissen zum Einschießen", "lead": "Die wichtigsten Begriffe rund um Zielfernrohr, Ballistik und Lauf – kurz erklärt, mit Zeichnungen. Tippe einen Begriff an oder suche.",
        "search": "Begriff suchen …", "none": "Kein Begriff gefunden.", "back": "← Zur App", "app": "/", "switch": "English", "toc": "Alle Begriffe",
        "top": "nach oben", "cta": "Jetzt einschießen mit Nullpunkt", "foot": "Alle Angaben sind Richtwerte zur Orientierung. Maßgeblich sind die Angaben der Hersteller von Waffe, Optik und Munition.",
        "imprint": "Impressum", "privacy": "Datenschutz", "lang": "de",
    },
    "en": {
        "path": "en/knowledge/index.html", "url": "https://nullpunkt.pro/en/knowledge/", "other": "https://nullpunkt.pro/wissen/",
        "title": "Zeroing knowledge: MOA, mrad, focal planes, reticles, zero range, twist | Nullpunkt",
        "desc": "Zeroing from A to Z: clean-bore shot, MOA and mrad with drawing, click value, first and second focal plane, reticles, optimal zero, wind, air density, barrel and twist – short and clear.",
        "h1": "Zeroing knowledge", "lead": "The key terms around riflescopes, ballistics and barrels – explained briefly, with drawings. Tap a term or search.",
        "search": "Search a term …", "none": "No term found.", "back": "← To the app", "app": "/en/", "switch": "Deutsch", "toc": "All terms",
        "top": "back to top", "cta": "Zero your rifle with Nullpunkt", "foot": "All figures are guide values. The specifications of the makers of rifle, optics and ammunition take precedence.",
        "imprint": "Legal notice (German)", "privacy": "Privacy (German)", "lang": "en",
    },
}

TITLES = {lang: {e["id"]: e[lang][0] for e in ENTRIES} for lang in ("de", "en")}


def links(text, lang):
    def rep(m):
        target, label = m.group(1), m.group(2) or TITLES[lang][m.group(1)]
        assert target in TITLES[lang], target
        return f'<a href="#{target}">{label}</a>'
    return re.sub(r"\[\[([a-z0-9]+)(?:\|([^\]]+))?\]\]", rep, text)


def plain(text):
    return html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"\[\[[a-z0-9]+\|?([^\]]*)\]\]", r"\1", text)))


def build(lang):
    P = PAGE[lang]
    toc = "".join(
        f'<li><a href="#{e["id"]}" data-term="{html.escape(e[lang][0].lower())}">{e[lang][0]}</a></li>'
        for e in sorted(ENTRIES, key=lambda e: e[lang][0].lower())
    )
    sections = []
    for cat, names in CATS.items():
        cards = []
        for e in [x for x in ENTRIES if x["cat"] == cat]:
            title, body = e[lang]
            fig = ""
            if e.get("fig"):
                fn, labels = FIGS[e["fig"]]
                fig = f'<figure class="kb-fig">{fn(labels[lang])}</figure>'
            search = html.escape(f"{title} {plain(body)}".lower())
            cards.append(f'<article class="card kb-entry" id="{e["id"]}" data-search="{search}"><h3>{title}</h3><p>{links(body, lang)}</p>{fig}</article>')
        sections.append(f'<section class="kb-cat" data-cat="{cat}"><h2>{names[lang]}</h2>{"".join(cards)}</section>')

    ld = {
        "@context": "https://schema.org", "@type": "DefinedTermSet", "name": P["h1"], "inLanguage": lang, "url": P["url"],
        "hasDefinedTerm": [{"@type": "DefinedTerm", "name": e[lang][0], "description": plain(e[lang][1]), "url": f'{P["url"]}#{e["id"]}'} for e in ENTRIES],
    }
    import json
    ld_json = json.dumps(ld, ensure_ascii=False, indent=1)

    return f"""<!doctype html>
<html lang="{lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{P['title']}</title>
  <meta name="description" content="{P['desc']}">
  <link rel="canonical" href="{P['url']}">
  <link rel="alternate" hreflang="de" href="https://nullpunkt.pro/wissen/">
  <link rel="alternate" hreflang="en" href="https://nullpunkt.pro/en/knowledge/">
  <meta name="theme-color" content="#121614">
  <meta property="og:type" content="article">
  <meta property="og:url" content="{P['url']}">
  <meta property="og:title" content="{P['h1']} – Nullpunkt">
  <meta property="og:description" content="{P['desc']}">
  <meta property="og:image" content="https://nullpunkt.pro/assets/icon-512.png">
  <link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/icon-180.png">
  <link rel="stylesheet" href="/css/app.css">
  <script type="application/ld+json">
{ld_json}
  </script>
</head>
<body class="kb">
<main>
  <header class="bar-top"><a class="btn ghost small" href="{P['app']}">{P['back']}</a><a class="link" href="{P['other']}" hreflang="{'en' if lang == 'de' else 'de'}">{P['switch']}</a></header>
  <header class="top" id="top">
    <h1 class="brand">Null<span>punkt</span></h1>
    <h2 class="kb-title">{P['h1']}</h2>
    <p class="muted">{P['lead']}</p>
  </header>
  <div class="kb-search">
    <input type="search" id="kbq" placeholder="{P['search']}" aria-label="{P['search']}" autocomplete="off">
  </div>
  <nav class="card kb-toc" aria-label="{P['toc']}"><p class="label">{P['toc']}</p><ul>{toc}</ul></nav>
  <p class="muted" id="kbnone" hidden>{P['none']}</p>
  {''.join(sections)}
  <a class="btn primary" href="{P['app']}">{P['cta']}</a>
  <p class="muted small">{P['foot']}</p>
  <nav class="links"><a href="#top">{P['top']}</a><a href="/impressum.html">{P['imprint']}</a><a href="/datenschutz.html">{P['privacy']}</a></nav>
</main>
<script>
  // Schnellsuche: Karten und Inhaltsverzeichnis nach Suchbegriff filtern
  (function () {{
    var q = document.getElementById('kbq');
    var cards = [].slice.call(document.querySelectorAll('.kb-entry'));
    var toc = [].slice.call(document.querySelectorAll('.kb-toc li'));
    var cats = [].slice.call(document.querySelectorAll('.kb-cat'));
    var none = document.getElementById('kbnone');
    q.addEventListener('input', function () {{
      var s = q.value.trim().toLowerCase();
      var hits = 0;
      cards.forEach(function (c) {{ var on = !s || c.dataset.search.indexOf(s) >= 0; c.hidden = !on; if (on) hits++; }});
      toc.forEach(function (li) {{ li.hidden = !!s && !document.getElementById(li.firstChild.getAttribute('href').slice(1)).dataset.search.includes(s); }});
      cats.forEach(function (c) {{ c.hidden = !c.querySelector('.kb-entry:not([hidden])'); }});
      none.hidden = hits > 0;
    }});
  }})();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    for lang in ("de", "en"):
        out = ROOT / PAGE[lang]["path"]
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(build(lang), encoding="utf-8", newline="\n")
        print(out.relative_to(ROOT), len(ENTRIES), "Begriffe")
