#!/usr/bin/env python3
"""Static checks for the course site (stdlib only).

Usage:
  python3 tools/check.py                 check every page that exists
  python3 tools/check.py docs/04-context.html ...   check the given pages
  python3 tools/check.py --all           also require completeness (manifest, requirement anchors, links)
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
REQS = ROOT / "notes" / "requirements.md"

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
PROSE_TAGS = {"p", "li", "dd", "blockquote", "figcaption"}
SKIP_TAGS = {"script", "style", "pre", "table", "nav", "summary"}
SKIP_CLASSES = {"diagram", "trace", "flow", "options", "loop-map", "kicker"}

BANNED_WORDS = [
    r"delv(?:e|es|ed|ing)", r"tapestr(?:y|ies)", r"testaments?", r"underscor(?:e|es|ed|ing)",
    r"leverag(?:e|es|ed|ing)", r"landscapes?", r"seamless(?:ly)?", r"robust(?:ly)?",  # "robustness" stays: it is a metric name in the owner's spec
    r"foster(?:s|ed|ing)?", r"navigat(?:e|es|ed|ing)", r"load-bearing", r"spines?", r"structural(?:ly)?",
]
BANNED_RE = re.compile(r"\b(" + "|".join(BANNED_WORDS) + r")\b", re.I)
BANNED_PHRASES = [r"it'?s important to note", r"it is important to note", r"in today'?s fast-paced world",
                  # owner rules: no filler, no hype
                  r"here'?s the thing", r"here is the thing", r"\blet['’]s\b", r"\blet us\b", r"it turns out",
                  r"\bthree details matter", r"\bthis matters because", r"\bin this chapter,? we\b",
                  r"\bpowerful\b", r"\bcrucial\b", r"\bessential(?:ly)?\b", r"\bmagic(?:al)?\b",
                  r"game[- ]chang", r"\bsimply\b", r"\bkey (?:insight|idea|takeaway|point)s?\b",
                  r"\bdive (?:in|into|deep)\b", r"\bunlock", r"\bsupercharg", r"\bthe bottom line\b"]
PHRASE_RE = re.compile("|".join(BANNED_PHRASES), re.I)

CLOSING = ["running-example", "design-checkpoint", "what-goes-wrong", "you-decide", "check-yourself", "takeaways", "going-deeper"]
CHECKPOINT_PAGES = {"04-context.html", "09-coding-agents.html", "11-human-in-the-loop.html", "14-architectures.html", "16-evaluation.html"}
# Required closing sections per page (default: full skeleton for numbered chapters).
SKELETON_OVERRIDES = {
    "15-reliability.html": ["running-example", "you-decide", "check-yourself", "takeaways"],
    "17-case-studies.html": ["takeaways"],
    "17b-comparison.html": [],
    "20-exercises.html": [],
    "21-design-brief.html": [],
}
CALLOUTS_OPTIONAL = {"17-case-studies.html", "17b-comparison.html", "20-exercises.html", "21-design-brief.html"}
NOT_CHAPTERS = {"index.html", "questions.html", "glossary.html"}
PROSE_EXEMPT = {"glossary.html"}


def load_manifest():
    src = (DOCS / "assets" / "chapters.js").read_text(encoding="utf-8")

    def block(name):
        m = re.search(r"/\*%s\*/(.*?)/\*END\*/" % name, src, re.S)
        if not m:
            raise SystemExit("chapters.js: missing /*%s*/ ... /*END*/ block" % name)
        return json.loads(m.group(1))

    return block("PARTS"), block("CHAPTERS")


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []  # (tag, attrs dict, line)
        self.errors = []
        self.ids = {}
        self.links = []  # (href, line)
        self.scripts = []
        self.external = []
        self.widgets = []
        self.classes = set()
        self.sections = []  # ids of <section> direct in main, in order
        self.h1 = ""
        self.kicker = ""
        self.loop_map = None
        self.textareas = []
        self.labels = set()
        self.tables = []  # (has_caption, line)
        self.code_blocks = []  # (lines, line)
        self.h2_outside_section = []
        self.imgs_without_alt = []
        self.blocks = []  # prose blocks (strings)
        self.visible = []  # all visible text, for banned words
        self._buf = None
        self._buf_depth = None
        self._capture = None  # 'h1' / 'kicker'
        self._code_text = None
        self._table_stack = []

    # helpers
    def _in(self, tags=(), classes=()):
        for tag, attrs, _ in self.stack:
            if tag in tags:
                return True
            if classes and set(attrs.get("class", "").split()) & set(classes):
                return True
        return False

    def handle_starttag(self, tag, attrs_list):
        attrs = {k: (v or "") for k, v in attrs_list}
        line = self.getpos()[0]
        cls = attrs.get("class", "").split()
        self.classes.update(cls)
        if "id" in attrs:
            if attrs["id"] in self.ids:
                self.errors.append("line %d: duplicate id '%s'" % (line, attrs["id"]))
            self.ids[attrs["id"]] = line
        if tag == "a" and "href" in attrs:
            self.links.append((attrs["href"], line))
        if tag == "script" and "src" in attrs:
            self.scripts.append((attrs["src"], "defer" in attrs, line))
        if tag in ("script", "link", "img") and re.match(r"^(https?:)?//", attrs.get("src", attrs.get("href", ""))):
            self.external.append((tag, line))
        if tag == "img" and "alt" not in attrs:
            self.imgs_without_alt.append(line)
        if "data-widget" in attrs:
            self.widgets.append((attrs["data-widget"], line))
        if tag == "section" and self.stack and self.stack[-1][0] == "main":
            self.sections.append(attrs.get("id", ""))
            if not attrs.get("id"):
                self.errors.append("line %d: <section> in main without an id" % line)
        if tag == "h2" and not self._in(tags=("section", "article")) and "id" not in attrs:
            self.h2_outside_section.append(line)
        if tag == "h1":
            self._capture = "h1"
        if "kicker" in cls:
            self._capture = "kicker"
        if "loop-map" in cls:
            self.loop_map = attrs.get("data-focus", "")
        if tag == "textarea":
            self.textareas.append((attrs.get("id", ""), line))
        if tag == "label" and attrs.get("for"):
            self.labels.add(attrs["for"])
        if tag == "table":
            self._table_stack.append([False, line, "compare" in cls])
        if tag == "caption" and self._table_stack:
            self._table_stack[-1][0] = True
        if tag == "code" and self.stack and self.stack[-1][0] == "pre":
            self._code_text = []
        # inline code inside prose: keep a placeholder word so sentences stay intact
        if tag == "code" and self._buf is not None and not self._in(tags=("pre",)):
            self._buf.append(" X ")
        if tag in VOID:
            return
        self.stack.append((tag, attrs, line))
        if tag in PROSE_TAGS and self._buf is None and not self._in(tags=SKIP_TAGS, classes=SKIP_CLASSES):
            self._buf = []
            self._buf_depth = len(self.stack)

    def handle_startendtag(self, tag, attrs_list):
        self.handle_starttag(tag, attrs_list)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        line = self.getpos()[0]
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append("line %d: stray </%s>" % (line, tag))
            return
        if self.stack[-1][0] != tag:
            open_tags = [t for t, _, _ in self.stack]
            if tag in open_tags:
                while self.stack and self.stack[-1][0] != tag:
                    t, _, l = self.stack.pop()
                    self.errors.append("line %d: <%s> opened on line %d is not closed before </%s>" % (line, t, l, tag))
            else:
                self.errors.append("line %d: stray </%s> (open: <%s>)" % (line, tag, self.stack[-1][0]))
                return
        t, attrs, l = self.stack.pop()
        if self._buf is not None and len(self.stack) < self._buf_depth:
            text = "".join(self._buf)
            if text.strip():
                self.blocks.append(text)
            self._buf = None
            self._buf_depth = None
        if tag == "code" and self._code_text is not None:
            n = len("".join(self._code_text).strip("\n").splitlines())
            self.code_blocks.append((n, l))
            self._code_text = None
        if tag == "table" and self._table_stack:
            has_caption, tline, is_compare = self._table_stack.pop()
            self.tables.append((has_caption, tline, is_compare))
        if tag == "h1" or (self._capture == "kicker" and "kicker" in attrs.get("class", "")):
            self._capture = None

    def handle_data(self, data):
        if self._code_text is not None:
            self._code_text.append(data)
        if self._in(tags=("script", "style")):
            return
        self.visible.append(data)
        if self._capture == "h1":
            self.h1 += data
        elif self._capture == "kicker":
            self.kicker += data
        if self._buf is not None and not self._in(tags=("code",)):
            self._buf.append(data)

    def close(self):
        super().close()
        for t, _, l in self.stack:
            if t not in ("html", "body", "head"):
                self.errors.append("line %d: <%s> never closed" % (l, t))


SENT_SPLIT = re.compile(r"(?<=[.!?])[\"”’)]*\s+(?=[A-Z0-9\"“(])")
WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’\-./]*")


def syllables(word):
    w = word.lower().strip(".,;:!?'\"()")
    if len(w) <= 3:
        return 1
    w = re.sub(r"(?:[^laeiouy]es|ed|[^laeiouy]e)$", "", w)
    w = re.sub(r"^y", "", w)
    return max(1, len(re.findall(r"[aeiouy]{1,2}", w)))


def grade_level(blocks):
    """Flesch-Kincaid grade over prose blocks (rough, for warnings only)."""
    words = sents = syl = 0
    for b in blocks:
        b = re.sub(r"\s+", " ", b).strip()
        for snt in SENT_SPLIT.split(b):
            ws = WORD.findall(snt)
            if not ws:
                continue
            sents += 1
            words += len(ws)
            syl += sum(syllables(w) for w in ws)
    if not words:
        return 0.0
    return 0.39 * words / sents + 11.8 * syl / words - 15.59


def prose_stats(blocks):
    sentences = []
    for b in blocks:
        b = re.sub(r"\s+", " ", b.replace("**", "")).strip()
        for s in SENT_SPLIT.split(b):
            n = len(WORD.findall(s))
            if n:
                sentences.append(n)
    if not sentences:
        return 0, 0, 0.0, 0.0
    total = sum(sentences)
    avg = total / len(sentences)
    long_share = 100.0 * sum(1 for n in sentences if n > 30) / len(sentences)
    return total, len(sentences), avg, long_share


_parsed = {}


def parse(path):
    if path not in _parsed:
        p = Page()
        p.feed(path.read_text(encoding="utf-8"))
        p.close()
        _parsed[path] = p
    return _parsed[path]


def check_page(path, chapters, strict_links):
    name = path.name
    p = parse(path)
    errors = list(p.errors)
    warnings = []
    raw = path.read_text(encoding="utf-8")

    # marks and banned words
    if "—" in raw:
        errors.append("em-dash found %d time(s)" % raw.count("—"))
    if "§" in raw:
        errors.append("section sign found")
    if " – " in raw:
        errors.append("spaced en-dash used as a dash")
    text = " ".join(p.visible)
    for m in sorted(set(x.lower() for x in BANNED_RE.findall(text))):
        errors.append("banned word: %s" % m)
    for m in PHRASE_RE.findall(text):
        errors.append("banned phrase: %s" % m)

    # prose metrics
    words, nsent, avg, long_share = prose_stats(p.blocks)
    grade = grade_level(p.blocks)
    stats = "words=%d sentences=%d avg=%.1f long=%.1f%% grade=%.1f" % (words, nsent, avg, long_share, grade)
    if name not in PROSE_EXEMPT and nsent >= 20 and grade > 9.0:
        warnings.append("reading grade %.1f is above 9: use plainer words or explain terms" % grade)
    if name not in PROSE_EXEMPT and nsent >= 20:
        if avg > 14.0 or long_share > 5.0:
            errors.append("prose too dense (%s); target avg<=13, long<=3%%" % stats)
        elif avg > 13.0 or long_share > 3.0:
            warnings.append("prose above target (%s)" % stats)

    # code blocks
    for n, line in p.code_blocks:
        if n > 20:
            errors.append("line %d: code block has %d lines (max 20)" % (line, n))

    # external resources, images
    for tag, line in p.external:
        errors.append("line %d: external <%s> resource (no CDNs)" % (line, tag))
    for line in p.imgs_without_alt:
        errors.append("line %d: <img> without alt" % line)

    # labels and tables
    for tid, line in p.textareas:
        if not tid or tid not in p.labels:
            errors.append("line %d: textarea without id or matching <label for>" % line)
    for has_caption, line, is_compare in p.tables:
        if is_compare and not has_caption:
            errors.append("line %d: table.compare without <caption>" % line)
    for line in p.h2_outside_section:
        errors.append("line %d: <h2> outside a section and without an id" % line)

    # scripts: order and registration
    srcs = [s for s, _, _ in p.scripts]
    for s, deferred, line in p.scripts:
        if not deferred:
            errors.append("line %d: script %s must use defer" % (line, s))
    if name != "404.html":
        for need in ("assets/chapters.js", "assets/site.js"):
            if need not in srcs:
                errors.append("missing script %s" % need)
        if "assets/chapters.js" in srcs and "assets/site.js" in srcs and srcs.index("assets/chapters.js") > srcs.index("assets/site.js"):
            errors.append("chapters.js must load before site.js")
    for wname, line in p.widgets:
        wsrc = "assets/widgets/%s.js" % wname
        wfile = DOCS / wsrc
        if wsrc not in srcs:
            errors.append("line %d: widget '%s' needs <script defer src=\"%s\">" % (line, wname, wsrc))
        if not wfile.exists():
            errors.append("line %d: widget file %s does not exist" % (line, wsrc))
            continue
        wcode = wfile.read_text(encoding="utf-8")
        if not re.search(r"AC\.widgets\[['\"]%s['\"]\]\s*=" % re.escape(wname), wcode):
            errors.append("widget file %s does not register AC.widgets['%s']" % (wsrc, wname))
        wcss = "assets/widgets/%s.css" % wname
        if (DOCS / wcss).exists() and ('href="%s"' % wcss) not in raw:
            errors.append("widget '%s' has %s but the page does not link it" % (wname, wcss))
        if "AC.stepper(" in wcode:
            st = "assets/widgets/stepper.js"
            if st not in srcs:
                errors.append("widget '%s' uses AC.stepper but the page does not load %s" % (wname, st))
            elif wsrc in srcs and srcs.index(st) > srcs.index(wsrc):
                errors.append("stepper.js must load before %s" % wsrc)

    # chapter skeleton
    entry = next((c for c in chapters if c["file"] == name), None)
    if name not in NOT_CHAPTERS:
        if entry is None:
            errors.append("page not listed in assets/chapters.js")
        else:
            want_h1 = entry["title"]
            if p.h1.strip() != want_h1:
                errors.append("h1 '%s' does not match chapters.js title '%s'" % (p.h1.strip(), want_h1))
            want_kicker = "%s · %s" % (entry["label"], entry["partTitle"])
            if re.sub(r"\s+", " ", p.kicker).strip() != want_kicker:
                errors.append("kicker '%s' should be '%s'" % (re.sub(r"\s+", " ", p.kicker).strip(), want_kicker))
        if "lede" not in p.classes:
            errors.append("missing p.lede")
        if p.loop_map is None:
            errors.append("missing div.loop-map")
        elif not p.loop_map.strip():
            errors.append("loop-map needs data-focus")
        required = SKELETON_OVERRIDES.get(name)
        if required is None:
            required = ["running-example", "what-goes-wrong", "you-decide", "check-yourself", "takeaways"]
        required = list(required)
        if name in CHECKPOINT_PAGES:
            required.append("design-checkpoint")
        for sid in required:
            if sid not in p.sections:
                errors.append("missing <section id=\"%s\">" % sid)
        present = [s for s in p.sections if s in CLOSING]
        order = [s for s in CLOSING if s in present]
        if present != order:
            errors.append("closing sections out of order: %s (expected %s)" % (present, order))
        if present:
            first = p.sections.index(present[0])
            stray = [s for s in p.sections[first:] if s not in CLOSING]
            if stray:
                errors.append("content sections after the closing sections: %s" % stray)
        if name not in CALLOUTS_OPTIONAL:
            for c in ("reduce", "analogy"):
                if not re.search(r'class="callout %s' % c, raw):
                    errors.append("needs at least one callout.%s" % c)

    # links
    for href, line in p.links:
        if re.match(r"^[a-z][a-z0-9+.-]*:", href, re.I) or href.startswith("//"):
            continue
        target, _, anchor = href.partition("#")
        tpath = path if not target else (path.parent / target)
        if target and not tpath.exists():
            (errors if strict_links else warnings).append("line %d: link to missing page %s" % (line, target))
            continue
        if anchor:
            tp = parse(tpath) if tpath != path else p
            if anchor not in tp.ids:
                (errors if (strict_links or tpath == path) else warnings).append(
                    "line %d: link to missing anchor %s" % (line, href))

    return errors, warnings, stats


def global_checks(parts, chapters):
    errors = []
    files = [c["file"] for c in chapters]
    for f in files:
        if not (DOCS / f).exists():
            errors.append("chapters.js lists %s but it does not exist" % f)
    for f in sorted(DOCS.glob("*.html")):
        if f.name not in files and f.name not in NOT_CHAPTERS and f.name != "404.html":
            errors.append("%s is not listed in chapters.js" % f.name)
    for extra in ("index.html", "questions.html", "glossary.html"):
        if not (DOCS / extra).exists():
            errors.append("missing %s" % extra)
    if (DOCS / "index.html").exists():
        home_links = {h.partition("#")[0] for h, _ in parse(DOCS / "index.html").links}
        for f in files + ["questions.html", "glossary.html"]:
            if f not in home_links:
                errors.append("index.html course map does not link %s" % f)
    if REQS.exists():
        for ref in sorted(set(re.findall(r"([a-z0-9-]+\.html)#([a-z0-9-]+)", REQS.read_text(encoding="utf-8")))):
            page, anchor = ref
            fp = DOCS / page
            if not fp.exists():
                errors.append("requirement anchor %s#%s: page missing" % ref)
            elif anchor not in parse(fp).ids:
                errors.append("requirement anchor %s#%s: id missing" % ref)
    return errors


def main(argv):
    strict = "--all" in argv
    args = [a for a in argv if not a.startswith("--")]
    parts, chapters = load_manifest()
    part_titles = {pt["id"]: pt["title"] for pt in parts}
    for c in chapters:
        c["partTitle"] = part_titles[c["part"]]
    pages = [Path(a).resolve() for a in args] if args else sorted(DOCS.glob("*.html"))
    total_err = 0
    for path in pages:
        if not path.exists():
            print("MISSING %s" % path)
            total_err += 1
            continue
        errors, warnings, stats = check_page(path, chapters, strict)
        status = "OK  " if not errors else "FAIL"
        print("%s %-32s %s" % (status, path.name, stats))
        for e in errors:
            print("     error: %s" % e)
        for w in warnings:
            print("     warn:  %s" % w)
        total_err += len(errors)
    if strict:
        g = global_checks(parts, chapters)
        for e in g:
            print("GLOBAL error: %s" % e)
        total_err += len(g)
    print("\n%d error(s)" % total_err)
    return 1 if total_err else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
