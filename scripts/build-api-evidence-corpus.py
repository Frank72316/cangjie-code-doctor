"""Extract verbatim method documentation from the pinned runtime standard library."""
import hashlib
import json
import pathlib
import re
import sys

base = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "tmp")
dest = pathlib.Path("docs/experiments/2026-11-26-api-evidence")
rev = "c6aa169ce8c6aaeb65cb1262bddb3700aebe8cb9"
upstream = "https://github.com/cangjielanguage/cangjie_runtime"
sources = {
    "structs": ("core/core_package_api/core_package_structs", {"String", "Array", "Duration"}),
    "collections": ("collection/collection_package_api/collection_package_class", {"ArrayList", "HashSet", "HashMap"}),
    "convert": ("convert/convert_package_api/convert_package_interfaces", {"Parsable"}),
    "enums": ("core/core_package_api/core_package_enums", {"Option"}),
}
documents, checksums = [], {}
for alias, (path, allowed) in sources.items():
    source = "std/doc/libs/std/" + path + ".md"
    raw = (base / ("mechanism-" + alias + ".md")).read_bytes()
    checksums[source] = hashlib.sha256(raw).hexdigest()
    lines = raw.decode("utf-8").splitlines()
    owner = extension = ""
    for i, line in enumerate(lines):
        if line.startswith("## "):
            match = re.match(r"## (?:struct|class|interface|enum) (\w+)", line)
            owner = match[1] if match else ""
            extension = ""
        if owner not in allowed:
            continue
        if line.startswith("### "):
            extension = line if line.startswith("### extend") else ""
        in_int64 = owner == "Parsable" and extension.startswith("### extend Int64 ")
        if not (line.startswith("### ") and not extension and owner != "Parsable" or
                in_int64 and line.startswith("#### ")):
            continue
        # Keep a signature and contiguous description. Exclude examples and long parameter lists.
        end = i + 1
        while end < len(lines) and not lines[end].startswith(("#", "示例", "<!--")):
            if sum(len(x)+1 for x in lines[i:end+1]) > 650:
                break
            end += 1
        while end > i + 1 and not lines[end-1].strip():
            end -= 1
        text = "\n".join(lines[i:end])
        if "```cangjie" not in text:
            continue
        title = "Int64" if in_int64 else owner
        link = f"{upstream}/blob/{rev}/{source}#L{i+1}-L{end}"
        documents.append(dict(id=f"{alias}-{i+1}", title=title, section=line.lstrip("# "),
                              url=link, text=text))
corpus = dict(schemaVersion=1, sdkVersion="1.0.5", snapshotId="runtime-api-mechanism-1",
              sourceRevision=rev, documents=documents)
payload = (json.dumps(corpus, ensure_ascii=False, separators=(",", ":"))+"\n").encode()
assert len(documents) <= 512 and len(payload) < 262144
(dest / "corpus.json").write_bytes(payload)
manifest = dict(repository=upstream, revision=rev, sourceSha256=checksums,
                corpusSha256=hashlib.sha256(payload).hexdigest(), entries=len(documents))
(dest / "sources.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n", encoding="utf-8")
print(len(documents), "API entries,", len(payload), "UTF-8 bytes")
