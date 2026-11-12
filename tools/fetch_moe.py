"""Download MOE (教育部) stroke XML for every character in words.csv into data/<HEX>.xml.

These bundled files make the default word list load fast; characters a teacher adds later are
fetched on demand through the class's Apps Script. Files are stored verbatim (CC BY-NC-ND 3.0 TW).
Existing files are skipped.
"""
import csv, io, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (stroke-practice; school use)"}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8")

def word_list():
    text = open(os.path.join(ROOT, "words.csv"), encoding="utf-8").read()
    return [r.get("字", "").strip() for r in csv.DictReader(io.StringIO(text.lstrip("\ufeff")))]

def moe_xml(ch):
    html = get("https://stroke-order.learningweb.moe.edu.tw/dictView.jsp?ID=%d" % ord(ch))
    m = re.search(r'xml\[\d+\]=(".*?");\s*$', html, re.M)
    return json.loads(m.group(1)).strip() if m else None

def main():
    missing = []
    for ch in dict.fromkeys(c for c in word_list() if len(c) == 1):
        path = os.path.join(ROOT, "data", "%X.xml" % ord(ch))
        if os.path.exists(path): continue
        xml = moe_xml(ch)
        if xml and "<Stroke>" in xml:
            open(path, "w", encoding="utf-8").write(xml + "\n"); print("saved", ch)
        else:
            missing.append(ch)
        time.sleep(0.5)  # be polite to the MOE server
    if missing: print("no MOE data for:", "".join(missing))

if __name__ == "__main__":
    main()
