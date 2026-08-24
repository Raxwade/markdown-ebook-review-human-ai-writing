# Markdown Compatibility Specification

Status: normative  
Profile version: 1  
Parser baseline: CommonMark 0.31.2 and markdown-it 15

This document defines what Markdown Ebook Review — Human–AI Writing promises to render. “All Markdown” is not a finite standard because Markdown has incompatible dialects. The guaranteed profile is the 23 CommonMark syntax families, with raw HTML deliberately disabled, plus the four user-visible GitHub Flavored Markdown (GFM) extensions.

The same profile applies to the live preview and exported EPUB. A construct marked supported must retain the same meaning in both paths and produce well-formed XHTML.

## Guaranteed syntax

| # | Syntax family | Status | Required behavior |
|---:|---|---|---|
| 1 | Thematic breaks | Supported | Render as a horizontal rule. |
| 2 | ATX headings | Supported | Render levels 1–6; levels 1–2 can split chapters according to `mdepub.splitLevel`. |
| 3 | Setext headings | Supported | `=` renders level 1 and `-` level 2; both participate in chapter splitting. |
| 4 | Indented code blocks | Supported | Preserve literal text and whitespace. |
| 5 | Fenced code blocks | Supported | Backtick and tilde fences preserve literal text and expose the language as a CSS class. Syntax highlighting is not promised. |
| 6 | HTML blocks | Rejected safely | Escape and display as text; never execute or inject them. |
| 7 | Link-reference definitions | Supported | Resolve full, collapsed, and shortcut references without displaying the definition. |
| 8 | Paragraphs | Supported | Render as reflowable paragraphs. |
| 9 | Blank lines | Supported | Separate blocks without creating visible content. |
| 10 | Block quotes | Supported | Preserve nesting and inline formatting. |
| 11 | List items | Supported | Preserve tight, loose, and nested items. |
| 12 | Lists | Supported | Render ordered and unordered lists, including non-1 ordered starts. |
| 13 | Backslash escapes | Supported | Escaped punctuation remains literal. |
| 14 | Character and entity references | Supported | Decode valid references and emit XML-safe characters. |
| 15 | Code spans | Supported | Preserve literal inline code and exclude it from compatibility rewriting. |
| 16 | Emphasis and strong emphasis | Supported | Render CommonMark emphasis and strong syntax. |
| 17 | Links | Supported | Render inline and reference links; reject unsafe URI schemes. |
| 18 | Images | Supported | Render inline and reference images; package supported local assets for EPUB. |
| 19 | URI and email autolinks | Supported | Render angle-bracket URI and email forms as links. |
| 20 | Raw inline HTML | Rejected safely | Escape and display as text; never execute or inject it. |
| 21 | Hard line breaks | Supported | Support both two trailing spaces and a trailing backslash. |
| 22 | Soft line breaks | Supported | Preserve a reflowable soft break rather than forcing `<br />`. |
| 23 | Textual content | Supported | Escape text correctly for XHTML. |
| 24 | GFM tables | Supported | Render header, body, and column alignment. |
| 25 | GFM task-list items | Supported | Render checked and unchecked states as inert, accessible ebook markers. |
| 26 | GFM strikethrough | Supported | Accept both `~text~` and `~~text~~`. |
| 27 | GFM extended autolinks | Supported | Link `www.` forms, bare domains, scheme URLs, and email addresses. |

Raw block and inline HTML are two conformance entries for one raw-HTML capability. They share the same rejection policy. In capability terms, the profile has 26 groups: 25 rendered groups and one explicit safe exception.

## Author-friendly compatibility

The following narrowly scoped corrections are intentional extensions for human- and AI-written manuscripts:

| Input | Interpreted as |
|---|---|
| `##Heading` | `## Heading` |
| `** padded **` | `**padded**` |
| `__ padded __` | `__padded__` |

Corrections do not run inside inline or fenced code and never change the number of source lines. A bare `##` is already a valid empty heading and therefore has no visible label.

## HTML policy

Raw HTML is not a supported escape hatch. EPUB chapters use XML-syntax XHTML, while untrusted HTML can be malformed, execute scripts, introduce event handlers, or behave differently across reading systems.

Use these Markdown forms instead:

| Unsupported source | Supported source |
|---|---|
| `<img src="cover.png" alt="Cover">` | `![Cover](cover.png)` |
| `<a href="https://example.com">Label</a>` | `[Label](https://example.com)` |
| `<br>` | End the Markdown line with two spaces or `\` |
| `<href>Label</href>` | `[Label](url)`; `<href>` is not a valid HTML element. |

`<script>`, `<iframe>`, forms, inline event handlers, and arbitrary embedded applications are never executed.

## Ebook asset behavior

Local Markdown images support SVG, PNG, JPEG, WebP, and GIF. They are packaged into the EPUB and their paths are rewritten. Missing local images produce a warning and retain their alternative text. Remote images remain external and are not guaranteed to work offline.

## Not part of profile version 1

These constructs receive no special extension semantics unless a later profile version adopts them explicitly; another standard Markdown rule can still interpret part of the same source:

- Footnotes and endnotes
- Definition lists
- Mathematics and LaTeX delimiters
- Mermaid or other executable diagram languages
- Wiki links such as `[[Page]]`
- Emoji shortcodes such as `:smile:`
- Heading attribute or ID extensions
- Arbitrary third-party markdown-it plugin syntax

Fenced `mermaid` or language-tagged code is still a valid fenced code block; only diagram execution and syntax highlighting are outside the promise.

## Conformance requirements

Automated tests must contain at least one positive case for every supported family and negative cases for raw HTML, unsafe URI schemes, code-isolation boundaries, and unadopted syntax. Tests must verify:

1. Semantic XHTML elements from fragment rendering.
2. Well-formed complete XHTML chapters.
3. Matching preview and export semantics, allowing preview-only source attributes.
4. Chapter and table-of-contents behavior for both ATX and Setext headings.
5. Local image packaging and path rewriting.
6. No author-friendly rewriting inside inline or fenced code.
7. Raw HTML remains escaped and cannot create active elements.

Changes to the promised profile require updates to this specification, its conformance matrix, the README, architecture documentation, and regression tests in the same change.
