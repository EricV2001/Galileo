---
name: agent-scraper
description: Scrape websites and extract clean content using crawl4ai. Use for web scraping tasks, content extraction, article reading, data gathering, and any task that needs clean text from web pages. Prefer this over agent-browser for read-only scraping — it's faster and produces LLM-friendly markdown.
allowed-tools: Bash(crawl4ai:*),Bash(python3:*)
---

# Web Scraping with Crawl4ai

Crawl4ai extracts clean, LLM-friendly markdown from web pages. It handles JavaScript rendering, removes boilerplate (nav, ads, footers), and outputs structured content.

## Quick start

```bash
# Scrape a single page
crawl4ai https://example.com

# Scrape and save to file
crawl4ai https://example.com -o output.md

# Scrape with custom output format
crawl4ai https://example.com --format markdown
```

## Common patterns

### Scrape and summarize

```bash
# Get clean content, then process it
crawl4ai https://news.ycombinator.com -o /tmp/page.md
cat /tmp/page.md
# Now summarize or extract what you need from the markdown
```

### Scrape multiple pages

```bash
# Scrape several URLs
for url in "https://example.com/page1" "https://example.com/page2"; do
  crawl4ai "$url" -o "/tmp/$(echo $url | md5sum | cut -c1-8).md"
done
```

### Extract specific content with CSS selectors

```bash
# Target specific page sections
crawl4ai https://example.com --css-selector "article" -o /tmp/article.md
crawl4ai https://example.com --css-selector ".main-content" -o /tmp/content.md
```

### Handle JavaScript-heavy pages

```bash
# Wait for dynamic content to load
crawl4ai https://example.com --wait-for "css:.loaded"

# Execute JS before extraction
crawl4ai https://example.com --js-code "window.scrollTo(0, document.body.scrollHeight)"
```

## Options

```bash
crawl4ai <url>                           # Basic scrape
crawl4ai <url> -o <file>                 # Save output to file
crawl4ai <url> --format markdown         # Output as markdown (default)
crawl4ai <url> --format raw_markdown     # Raw markdown without cleaning
crawl4ai <url> --format html             # Raw HTML
crawl4ai <url> --css-selector <selector> # Extract specific elements
crawl4ai <url> --wait-for <condition>    # Wait before extracting
crawl4ai <url> --js-code <code>          # Run JS before extracting
crawl4ai <url> --headless false          # Show browser (debugging)
crawl4ai <url> --verbose                 # Detailed logging
```

## When to use crawl4ai vs agent-browser

| Task | Tool |
|------|------|
| Read article content | crawl4ai |
| Extract data from pages | crawl4ai |
| Scrape multiple pages | crawl4ai |
| Fill forms, click buttons | agent-browser |
| Interactive web apps | agent-browser |
| Login-protected content | agent-browser (login) then crawl4ai |
| Screenshots | agent-browser |

## Python API (for advanced use)

```python
import asyncio
from crawl4ai import AsyncWebCrawler

async def scrape(url):
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url)
        print(result.markdown)

asyncio.run(scrape("https://example.com"))
```
