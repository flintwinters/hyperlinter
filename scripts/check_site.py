"""Validate crawlable metadata and navigation for the static project website."""
import json
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.tags = []
        self.text = {"title": [], "h1": [], "script": [], "pre": []}
        self.current = None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        self.tags.append((tag, attributes))
        if tag in ("title", "h1", "pre") or (tag == "script" and attributes.get("type") == "application/ld+json"):
            self.current = tag

    def handle_endtag(self, tag):
        if tag == self.current:
            self.current = None

    def handle_data(self, data):
        if self.current:
            self.text[self.current].append(data)


def check_site(root):
    site = root / "docs"
    page = Page((site / "index.html").read_text())
    title = "typie hyperlinter"
    canonical = "https://flintwinters.github.io/hyperlinter/"
    require = lambda condition, message: condition or fail(message)
    require(" ".join("".join(page.text["title"]).split()) == title, "Incorrect page title.")
    require(sum(tag == "h1" for tag, _ in page.tags) == 1, "Use one primary heading.")
    require(" ".join(" ".join(page.text["h1"]).split()) == title, "Incorrect primary heading.")
    metadata = {attrs.get("name", attrs.get("property")): attrs.get("content")
                for tag, attrs in page.tags if tag == "meta"}
    require(bool(metadata.get("description")), "Missing search description.")
    require("index, follow" in metadata.get("robots", "") and "noindex" not in metadata["robots"], "Page must allow indexing.")
    require(metadata.get("og:title") == title and metadata.get("twitter:title") == title, "Sharing titles must match.")
    require(metadata.get("og:url") == canonical, "Sharing URL must be canonical.")
    require(any(tag == "link" and attrs.get("rel") == "canonical" and attrs.get("href") == canonical
                for tag, attrs in page.tags), "Missing canonical URL.")
    require(any(tag == "html" and attrs.get("lang") == "en" for tag, attrs in page.tags), "Missing document language.")
    require(any(tag == "meta" and attrs.get("name") == "viewport" for tag, attrs in page.tags), "Missing mobile viewport.")
    schema = json.loads("".join(page.text["script"]))
    require(schema.get("@context") == "https://schema.org", "Incorrect structured-data context.")
    require({item["@type"] for item in schema["@graph"]} == {"WebSite", "SoftwareSourceCode"}, "Missing project structured data.")
    require(all(item["name"] == title and item["url"] == canonical for item in schema["@graph"]), "Structured data must match the page.")
    ids = {attrs["id"] for _, attrs in page.tags if "id" in attrs}
    for tag, attrs in page.tags:
        href = attrs.get("href")
        if tag not in ("a", "link") or not href:
            continue
        url = urlsplit(href)
        if url.scheme or url.netloc:
            continue
        if url.fragment:
            require(url.fragment in ids, f"Broken navigation: {href}")
        if url.path and url.path != "./":
            require((site / url.path).is_file(), f"Missing linked asset: {href}")
    sitemap = ElementTree.parse(site / "sitemap.xml")
    locations = [item.text for item in sitemap.findall(".//{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
    require(locations == [canonical], "Sitemap must list the canonical page.")
    require((site / ".nojekyll").is_file(), "Static Pages publishing requires .nojekyll.")
    require('content="noindex, follow"' in (site / "404.html").read_text(), "Do not index the error page.")


def fail(message):
    raise ValueError(message)
