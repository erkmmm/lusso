#!/usr/bin/env python3
"""Microsoft Advertising bulk-upload file for the Lusso search campaign.

Built against Microsoft's OWN downloaded template (ms-official-template.csv),
not a guessed schema. Two earlier hand-rolled attempts imported 0 rows and
reported 0 errors, which is what Microsoft does when it does not recognise the
shape of the file. What was wrong, for the record:

  - invented `Id` / `Parent Id` columns. Microsoft links children to parents by
    Campaign/Ad Group NAME; those columns do not exist.
  - an invented `Format Version` first row. Not part of this format.
  - `Budget Type = DailyBudgetStandard`. The real value is `Daily`.
  - campaign negatives written to a `Keyword` column. They go in `Negative`.
  - `Responsive Search Ad` rows. This format has `Text Ad` and
    `Expanded Text Ad`; there is no RSA type and no Headline 1-15 columns.
  - ad groups missing required fields (Ad Group Type, Search Default Bid,
    Payment Model, Search/Content Network).

The header is taken verbatim from the template so column matching cannot fail.

Everything is PAUSED. The account also has no payment method, so nothing can
spend even if a status were wrong.

Two settings are now in the file rather than left to the UI:
  - Campaign Radius Criterion for Gold Coast and Brisbane.
  - Campaign LocationIntent Criterion = PeopleIn. This is the "Presence, not
    presence-or-interest" setting, and getting it wrong is the single most
    common way a local budget is spent nationwide.
"""
import csv, re, sys, pathlib

CAMPAIGN   = "Lusso - Search - GC and Brisbane"
WEBSITE    = "lusso.com.au"
BASE       = "https://www.lusso.com.au/"
DAILY_BUDGET = "20"
TIME_ZONE  = "(GMT+10:00) Brisbane"
CPC_CAP    = 9.00

HERE     = pathlib.Path(__file__).resolve().parent
TEMPLATE = HERE / "ms-official-template.csv"
SRC      = HERE.parent / "google-ads" / "generate.py"

# Service area. Byron Bay to Brisbane is the confirmed corridor; two radii over
# the dense ends of it, which is where the keywords are geo-qualified anyway.
RADII = [("Gold Coast", -28.0167, 153.4000, 35),
         ("Brisbane",   -27.4698, 153.0251, 30)]


def load_google():
    s = SRC.read_text()
    raw = re.search(r'RAW = """(.*?)"""', s, re.S).group(1)
    kws = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        ag, kw, vol, cpc = line.split("|")
        kws.append((ag, kw, int(vol), float(cpc)))
    groups = re.search(r'AD_GROUPS = \{(.*?)\n\}\n', s, re.S).group(1)
    meta = {}
    for m in re.finditer(r'"([^"]+)":\s*\{\s*"url":\s*"([^"]+)",\s*"path":\s*\("([^"]+)",\s*"([^"]+)"\),\s*'
                         r'"headlines":\s*\[(.*?)\],\s*"descriptions":\s*\[(.*?)\],', groups, re.S):
        ag, url, p1, p2, heads, descs = m.groups()
        meta[ag] = {"url": url, "p1": p1, "p2": p2,
                    "headlines": re.findall(r'"([^"]+)"', heads),
                    "descriptions": re.findall(r'"([^"]+)"', descs)}
    common_h = re.findall(r'"([^"]+)",\s*#', re.search(r'COMMON_HEADLINES = \[(.*?)\]', s, re.S).group(1))
    common_d = re.findall(r'"([^"]+)"', re.search(r'COMMON_DESCRIPTIONS = \[(.*?)\]', s, re.S).group(1))
    # Strip comment lines BEFORE parsing. The comment above NEGATIVES_PHRASE
    # quotes "blinds brisbane" as an example of what the shutter negatives
    # protect — and a naive regex pulled that quoted example in as a negative,
    # which would have blocked one of the campaign's best keywords. Python
    # itself never saw it (comments are comments); only this re-parse did.
    _blk  = re.search(r'NEGATIVES_PHRASE = \[(.*?)\n\]', s, re.S).group(1)
    _code = "\n".join(l for l in _blk.splitlines() if not l.strip().startswith('#'))
    negs  = re.findall(r'"([^"]+)"', _code)
    return kws, meta, common_h, common_d, negs


def main():
    cols = next(csv.reader(open(TEMPLATE)))          # verbatim template header
    kws, meta, common_h, common_d, negs = load_google()

    rows, errs = [], []
    def row(**kw):
        bad = [k for k in kw if k not in cols]
        if bad: errs.append(f"column not in template: {bad}")
        r = {c: "" for c in cols}; r.update(kw); rows.append(r)

    row(Type="Campaign", Status="Paused", Campaign=CAMPAIGN, Website=WEBSITE,
        **{"Domain Language": "English", "Bid Strategy Type": "EnhancedCpc",
           "Budget Type": "Daily", "Budget": DAILY_BUDGET, "Time Zone": TIME_ZONE})

    # Presence only — people physically in the area, not merely searching about it.
    row(Type="Campaign LocationIntent Criterion", Campaign=CAMPAIGN, Target="PeopleIn")
    for _name, lat, lon, km in RADII:
        row(Type="Campaign Radius Criterion", Campaign=CAMPAIGN,
            Radius=str(km), Unit="km", Latitude=str(lat), Longitude=str(lon))

    # Negatives. The term goes in `Negative`, not `Keyword` — that alone broke
    # the previous attempts' most valuable 118 rows.
    for n in negs:
        row(Type="Campaign Negative Keyword", Status="Active",
            Campaign=CAMPAIGN, Negative=n)

    ad_groups = []
    for ag, *_ in kws:
        if ag not in ad_groups: ad_groups.append(ag)

    for ag in ad_groups:
        m = meta[ag]
        group_kws = [k for k in kws if k[0] == ag]
        default_bid = min(sum(k[3] for k in group_kws) / len(group_kws), CPC_CAP)
        row(Type="Ad Group", Status="Paused", Campaign=CAMPAIGN,
            **{"Ad Group": ag, "Ad Group Type": "SearchStandard",
               "Bid Strategy Type": "InheritFromParent", "Language": "english",
               "End Date": "none", "Search Network": "on", "Content Network": "off",
               "Search Default Bid": f"{default_bid:.2f}",
               "Content Default Bid": f"{default_bid:.2f}", "Payment Model": "Cpc"})

        # Expanded Text Ad: 3 titles (30 chars each), 2 descriptions (90 each).
        heads = (m["headlines"] + common_h)
        descs = (m["descriptions"] + common_d)
        t1, t2, t3 = heads[0], heads[1], heads[4] if len(heads) > 4 else heads[2]
        for label, v, lim in (("Title Part 1", t1, 30), ("Title Part 2", t2, 30),
                              ("Title Part 3", t3, 30),
                              ("Text", descs[0], 90), ("Text Part 2", descs[1], 90)):
            if len(v) > lim: errs.append(f"[{ag}] {label} {len(v)}>{lim}: {v!r}")
        row(Type="Expanded Text Ad", Status="Paused", Campaign=CAMPAIGN,
            **{"Ad Group": ag, "Title Part 1": t1, "Title Part 2": t2,
               "Title Part 3": t3, "Text": descs[0], "Text Part 2": descs[1],
               "Path 1": m["p1"], "Path 2": m["p2"], "Final Url": BASE + m["url"]})

        for _ag, kw, _vol, cpc in group_kws:
            for match in ("Exact", "Phrase"):
                row(Type="Keyword", Status="Paused", Campaign=CAMPAIGN,
                    **{"Ad Group": ag, "Keyword": kw, "Match Type": match,
                       "Bid": f"{min(cpc, CPC_CAP):.2f}",
                       "Bid Strategy Type": "InheritFromParent"})

    with open("bulk-upload.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader(); w.writerows(rows)

    import collections
    c = collections.Counter(r["Type"] for r in rows)
    print(f"bulk-upload.csv — {len(cols)} columns (verbatim from Microsoft's template)\n")
    for k in ["Campaign", "Campaign LocationIntent Criterion", "Campaign Radius Criterion",
              "Campaign Negative Keyword", "Ad Group", "Expanded Text Ad", "Keyword"]:
        print(f"  {k:<34} {c[k]:>4}")
    print(f"  {'TOTAL':<34} {len(rows):>4}")
    kwrows = [r for r in rows if r["Type"] == "Keyword"]
    print(f"\n  shutter keywords        {sum(1 for r in kwrows if 'shutter' in r['Keyword'].lower())} (must be 0)")
    print(f"  shutter negatives       {sum(1 for r in rows if r['Type']=='Campaign Negative Keyword' and 'shutter' in r['Negative'].lower())}")
    print(f"  all entities paused     {all(r['Status']=='Paused' for r in rows if r['Type'] in ('Campaign','Ad Group','Keyword','Expanded Text Ad'))}")
    if errs:
        print("\nERRORS:"); [print("  " + e) for e in dict.fromkeys(errs)]
        return 1
    print("\n  no schema or length errors")
    return 0

sys.exit(main())
