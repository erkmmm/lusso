#!/usr/bin/env python3
"""Builds the Google Ads Editor import files for the Lusso search campaign.

Every keyword here came out of content_keywords with a MEASURED volume and a
measured CPC - none were invented, which is the standing rule for this account.
The volume figures are national Australian, but note that these are all
geo-qualified or "near me" terms, so unlike a generic head term ("venetian
blinds", 12,100) the national number IS substantially the local number: nobody
outside the region searches "blinds gold coast".

Run:  python3 generate.py
"""
import csv, sys

CAMPAIGN = "Lusso - Search - GC & Brisbane"
BASE = "https://www.lusso.com.au/"

# Each ad group points at the page that already ranks for its terms, rather
# than one generic /quote page. Message match is most of Quality Score, and
# these pages already exist, already carry the enquiry form, and already carry
# the first-touch attribution script that records gclid into web_enquiries.

# ad_group | keyword | national volume | semrush cpc estimate (AUD)
#
# SHUTTERS ARE GONE. See README - Lusso does not sell plantation or timber
# shutters (references/Business-facts.md, confirmed 12 Aug 2026), and the site's
# own targeting ruling says commercial shutter terms "buy enquiries that cannot
# be fulfilled and waste fitting time". That is an SEO ruling; at $6-8 a click
# it applies far harder to paid. 15 keywords removed, including the two most
# expensive ad groups in the first draft.
RAW = """
Blinds - Gold Coast|blinds gold coast|1000|6.05
Blinds - Gold Coast|roller blinds gold coast|590|6.16
Blinds - Gold Coast|vertical blinds gold coast|480|3.32
Blinds - Gold Coast|window blinds gold coast|390|6.05
Blinds - Gold Coast|custom blinds gold coast|390|4.44
Blinds - Gold Coast|blinds gold coast qld|320|6.05
Blinds - Gold Coast|venetian blinds gold coast|320|3.00
Blinds - Gold Coast|roller blinds gold coast australia|260|6.05
Blinds - Gold Coast|block out blinds gold coast|140|10.72
Blinds - Brisbane|blinds brisbane|1000|5.40
Blinds - Brisbane|roller blinds brisbane|590|5.06
Blinds - Brisbane|venetian blinds brisbane|480|3.55
Blinds - Brisbane|window blinds brisbane|390|5.42
Blinds - Brisbane|blockout roller blinds brisbane|390|5.03
Blinds - Brisbane|custom blinds brisbane|390|4.95
Blinds - Brisbane|vertical blinds brisbane|390|2.89
Blinds - Brisbane|indoor blinds brisbane|320|7.55
Blinds - Brisbane|roman blinds brisbane|320|3.73
Blinds - Brisbane|timber venetian blinds brisbane|210|3.21
Blinds - Brisbane|custom roman blinds brisbane|210|4.51
Outdoor Blinds - Gold Coast|outdoor blinds gold coast|1000|6.19
Outdoor Blinds - Gold Coast|outdoor blinds gold coast qld|210|6.19
Outdoor Blinds - Brisbane|outdoor blinds brisbane|1000|7.00
Outdoor Blinds - Brisbane|outdoor shade blinds brisbane|320|7.00
Outdoor Blinds - Brisbane|outdoor roller blinds brisbane|210|5.30
Outdoor Blinds - Brisbane|brisbane outdoor blinds|140|7.00
Outdoor Blinds - Brisbane|outdoor blinds brisbane northside|110|8.43
Awnings - Brisbane|awnings brisbane|480|4.08
Awnings - Brisbane|awnings brisbane qld|210|3.90
Awnings - Brisbane|retractable awnings brisbane|210|3.20
Curtains - Gold Coast|curtains and blinds gold coast|260|7.09
Curtains - Gold Coast|sheer curtains gold coast|170|6.93
Curtains - Gold Coast|curtains gold coast qld|170|6.24
Curtains - Gold Coast|curtains gold coast australia|90|6.24
Curtains - Gold Coast|curtain gold coast|90|6.24
Curtains - Brisbane|curtains brisbane|720|4.99
Curtains - Brisbane|custom curtains brisbane|320|7.70
Curtains - Brisbane|curtains and blinds brisbane|320|7.17
Curtains - Brisbane|curtains brisbane qld|320|5.96
Curtains - Brisbane|custom made curtains brisbane|260|5.97
Curtains - Brisbane|sheer curtains brisbane|260|5.58
High Intent - Near Me|blinds near me|3600|4.82
High Intent - Near Me|curtain blinds near me|880|4.09
High Intent - Near Me|roller blinds near me|590|4.51
High Intent - Near Me|curtain and blinds near me|480|4.36
High Intent - Near Me|blinds and curtains near me|390|4.83
High Intent - Near Me|blinds store near me|390|4.82
High Intent - Near Me|window blinds near me|390|3.73
High Intent - Near Me|vertical blinds near me|260|2.95
""".strip().splitlines()

# Held back on purpose - see README. Bidding on something you don't sell is the
# fastest way to waste a budget, so these need a yes before they go in.
EXCLUDED_PENDING_REVIEW = [
    ("ALL plantation / timber / general shutter terms", 13430, 6.35,
     "Lusso does not sell plantation or timber shutters - it sells Thermalite "
     "polymer shutters. Business-facts.md, confirmed 12 Aug 2026, and the site's "
     "own targeting ruling: commercial shutter terms 'buy enquiries that cannot "
     "be fulfilled and waste fitting time'. 15 keywords, two whole ad groups."),
    ("roller shutters gold coast", 390, 5.89,
     "Roller/security shutters are not a Lusso product line at all."),
    ("Motorised Blinds ad group", 10480, 2.44,
     "Real product and the cheapest clicks in the set, but there is no landing "
     "page for it and Jett dropped the motorisation push on 2026-11-03. Held "
     "out rather than pointed at a mismatched page."),
]

CPC_CAP = 9.00   # ceiling, not a bid: protects against the $13+ outliers

# ── Negative keywords ────────────────────────────────────────────────────────
# This list is where ad quality is actually won. Every term here is a search
# that looks relevant, costs $5-8 a click, and cannot become a job worth having:
# someone wanting a $40 Kmart blind, a repair, a DIY kit, or a job 900km away.
NEGATIVES_PHRASE = [
    # Price-shoppers and the wrong end of the market
    "cheap", "cheapest", "budget", "discount", "bargain", "clearance", "sale",
    "second hand", "used", "free", "wholesale", "factory direct",
    # Retailers - they want a shop, not a measure and install
    "kmart", "spotlight", "ikea", "bunnings", "target", "big w", "amazon",
    "temu", "ebay", "gumtree", "aliexpress", "costco",
    # DIY and self-install
    "diy", "do it yourself", "self install", "how to install", "how to make",
    "kit", "off the shelf", "ready made", "cut to size",
    # Service work, which does not pay for the van
    "repair", "repairs", "fix", "fixing", "broken", "replacement parts",
    "spare parts", "restring", "re string", "cord", "chain replacement",
    "cleaning", "clean", "dry cleaning",
    # Jobs and suppliers, not customers
    "jobs", "job vacancies", "careers", "hiring", "salary", "wholesaler",
    "supplier", "supply only", "manufacturer", "manufacturing", "trade price",
    # Wrong product entirely
    "car", "caravan", "campervan", "boat", "shed", "garage door", "security door",
    "fly screen", "flyscreen", "insect screen", "window tint", "tinting",
    "glass replacement", "double glazing", "window cleaning",
    # Education / research with no purchase intent
    "what is", "meaning", "definition", "history", "wikipedia", "images",
    "pictures", "ideas", "diagram", "template", "pdf",
    # Out of area - the geo targeting should catch these, but search intent
    # beats location more often than people expect
    "sydney", "melbourne", "perth", "adelaide", "darwin", "hobart", "canberra",
    "newcastle", "wollongong", "cairns", "townsville", "toowoomba", "nz",
    "new zealand", "uk", "usa",
    # Rentals and landlords - almost always the cheapest possible option
    "rental", "rental property", "landlord", "real estate agent",
    # Products Lusso does not sell. These are the most important negatives in
    # the file: without them a phrase match on "blinds brisbane" happily serves
    # "plantation shutters blinds brisbane" at $7 a click for an enquiry that
    # cannot be fulfilled. Ziptrak is a competitor brand; Lusso fits ZipScreen.
    "plantation", "plantation shutters", "timber shutter", "timber shutters",
    "shutter", "shutters", "ziptrak", "roller shutter", "security shutter",
    "security screen", "louvre", "louver",
]

# ── Responsive search ads ────────────────────────────────────────────────────
# Brand facts are load-bearing and constrained: Lusso was founded in 2004, is
# family-owned, and SUPPLIES, MEASURES AND INSTALLS made-to-measure furnishings.
# It does NOT manufacture - no "our workrooms", no "we make". Google rating is
# 4.9 from 36 reviews. No shopfront address (service-area business).
COMMON_HEADLINES = [
    "Family Owned Since 2004",       # 23
    "Rated 4.9 Stars on Google",     # 26
    "Free Measure & Quote",          # 20
    "Made to Measure, Installed",    # 26
    "Byron Bay to Brisbane",        # 22
    "We Measure. We Install.",       # 23
]
COMMON_DESCRIPTIONS = [
    "Family owned since 2004. We measure, supply and install - one team, start to finish.",
    "Rated 4.9 stars by 36 local customers. Book a free measure and quote today.",
]

AD_GROUPS = {
    "Blinds - Gold Coast": {
        "url": "blinds-gold-coast.html", "path": ("blinds", "gold-coast"),
        "headlines": ["Blinds on the Gold Coast", "Custom Blinds, Measured Free",
                      "Roller, Venetian & Vertical", "Gold Coast Blind Specialists"],
        "descriptions": ["Custom blinds measured and installed across the Gold Coast. Free quote, no pressure.",
                         "Roller, venetian, vertical and blockout blinds. Measured at your place, fitted by us."],
    },
    "Blinds - Brisbane": {
        "url": "blinds-brisbane.html", "path": ("blinds", "brisbane"),
        "headlines": ["Blinds in Brisbane", "Custom Blinds, Measured Free",
                      "Roller, Roman & Venetian", "Brisbane Blind Specialists"],
        "descriptions": ["Custom blinds measured and installed across Brisbane. Free quote, no pressure.",
                         "Roller, roman, venetian and vertical blinds. Measured at your place, fitted by us."],
    },
    "Outdoor Blinds - Gold Coast": {
        "url": "outdoor-blinds-gold-coast.html", "path": ("outdoor-blinds", "gold-coast"),
        "headlines": ["Outdoor Blinds Gold Coast", "Shade That Handles the Sun",
                      "Alfresco & Patio Blinds", "ZipScreen Track Guided"],
        "descriptions": ["Outdoor and alfresco blinds built for Queensland sun. Measured and installed.",
                         "ZipScreen track-guided and roller outdoor blinds. Free measure and quote."],
    },
    "Outdoor Blinds - Brisbane": {
        "url": "outdoor-blinds-brisbane.html", "path": ("outdoor-blinds", "brisbane"),
        "headlines": ["Outdoor Blinds Brisbane", "Shade That Handles the Sun",
                      "Alfresco & Patio Blinds", "ZipScreen Track Guided"],
        "descriptions": ["Outdoor blinds built for Queensland sun. Measured and installed across Brisbane.",
                         "ZipScreen track-guided and roller outdoor blinds. Free measure and quote."],
    },
    "Awnings - Brisbane": {
        "url": "awnings-brisbane.html", "path": ("awnings", "brisbane"),
        "headlines": ["Awnings in Brisbane", "Folding Arm & Straight Drop",
                      "Retractable Awnings", "Measured & Installed by Us"],
        "descriptions": ["Folding arm and straight-drop awnings, measured and installed across Brisbane.",
                         "Retractable awnings fitted by our own installers. Book a free measure and quote."],
    },
    "Curtains - Gold Coast": {
        "url": "curtains-gold-coast.html", "path": ("curtains", "gold-coast"),
        "headlines": ["Curtains on the Gold Coast", "Sheers, S-Fold & Blockout",
                      "Made to Measure Curtains", "Measured at Your Place"],
        "descriptions": ["Sheer, S-fold, pinch pleat and blockout curtains. Measured at home, installed by us.",
                         "Made-to-measure curtains across the Gold Coast. Book a free measure and quote."],
    },
    "Curtains - Brisbane": {
        "url": "curtains-brisbane.html", "path": ("curtains", "brisbane"),
        "headlines": ["Curtains in Brisbane", "Sheers, S-Fold & Blockout",
                      "Made to Measure Curtains", "Measured at Your Place"],
        "descriptions": ["Sheer, S-fold, pinch pleat and blockout curtains. Measured at home, installed by us.",
                         "Made-to-measure curtains across Brisbane. Book a free measure and quote."],
    },
    "High Intent - Near Me": {
        "url": "curtains-and-blinds-near-me.html", "path": ("free-measure", "quote"),
        "headlines": ["Blinds & Curtains Near You", "Free In-Home Measure",
                      "We Come to You", "Gold Coast & Brisbane"],
        "descriptions": ["We come to you, measure up and quote on the spot. Gold Coast and Brisbane.",
                         "Family owned, rated 4.9 stars. Book a free in-home measure today."],
    },
}

HEADLINE_MAX, DESC_MAX, PATH_MAX = 30, 90, 15


def main():
    errors = []

    # ── keywords.csv ─────────────────────────────────────────────────────────
    rows, total_vol, weighted = [], 0, 0.0
    for line in RAW:
        ag, kw, vol, cpc = line.split("|")
        vol, cpc = int(vol), float(cpc)
        bid = min(cpc, CPC_CAP)
        total_vol += vol
        weighted += cpc * vol
        for match in ("Exact", "Phrase"):
            rows.append({
                "Campaign": CAMPAIGN, "Ad Group": ag, "Keyword": kw,
                "Criterion Type": match, "Max CPC": f"{bid:.2f}", "Status": "Enabled",
            })
    with open("keywords.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["Campaign", "Ad Group", "Keyword",
                                          "Criterion Type", "Max CPC", "Status"])
        w.writeheader(); w.writerows(rows)

    # ── negative-keywords.csv ────────────────────────────────────────────────
    with open("negative-keywords.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["Campaign", "Keyword", "Criterion Type"])
        w.writeheader()
        for n in NEGATIVES_PHRASE:
            w.writerow({"Campaign": CAMPAIGN, "Keyword": n,
                        "Criterion Type": "Campaign Negative Phrase"})

    # ── responsive-search-ads.csv ────────────────────────────────────────────
    maxh = 15
    fields = (["Campaign", "Ad Group", "Final URL", "Path 1", "Path 2"]
              + [f"Headline {i}" for i in range(1, maxh + 1)]
              + [f"Description {i}" for i in range(1, 5)])
    with open("responsive-search-ads.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for ag, cfg in AD_GROUPS.items():
            heads = cfg["headlines"] + COMMON_HEADLINES
            descs = cfg["descriptions"] + COMMON_DESCRIPTIONS
            for h in heads:
                if len(h) > HEADLINE_MAX:
                    errors.append(f"[{ag}] headline {len(h)}>{HEADLINE_MAX}: {h!r}")
            for d in descs:
                if len(d) > DESC_MAX:
                    errors.append(f"[{ag}] description {len(d)}>{DESC_MAX}: {d!r}")
            for p in cfg["path"]:
                if len(p) > PATH_MAX:
                    errors.append(f"[{ag}] path {len(p)}>{PATH_MAX}: {p!r}")
            if len(heads) < 3: errors.append(f"[{ag}] needs >=3 headlines")
            if len(descs) < 2: errors.append(f"[{ag}] needs >=2 descriptions")
            row = {"Campaign": CAMPAIGN, "Ad Group": ag, "Final URL": BASE + cfg["url"],
                   "Path 1": cfg["path"][0], "Path 2": cfg["path"][1]}
            for i, h in enumerate(heads[:maxh], 1): row[f"Headline {i}"] = h
            for i, d in enumerate(descs[:4], 1):   row[f"Description {i}"] = d
            w.writerow(row)

    blended = weighted / total_vol
    print(f"keywords.csv              {len(rows):>4} rows  ({len(RAW)} keywords x Exact+Phrase)")
    print(f"negative-keywords.csv     {len(NEGATIVES_PHRASE):>4} rows")
    print(f"responsive-search-ads.csv {len(AD_GROUPS):>4} rows")
    print(f"\nvolume-weighted CPC estimate: ${blended:.2f}")
    print(f"held back pending review:     {len(EXCLUDED_PENDING_REVIEW)}")
    if errors:
        print("\nVALIDATION FAILED:"); [print("  " + e) for e in errors]; sys.exit(1)
    print("\nall headline/description/path lengths within Google limits")


if __name__ == "__main__":
    main()
