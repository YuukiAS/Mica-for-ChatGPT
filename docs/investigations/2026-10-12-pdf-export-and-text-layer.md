# PDF export and text-layer investigation

Date: 2026-10-12

Browser surface: isolated Playwright Chromium for the print source, actual generated PDF, and PDF.js 5.6.205 text layer

Independent extraction: `pdfplumber`

## Scope and evidence boundary

This investigation covers Mica's local PDF export after the Highlighter milestone. The exporter consumes only a settled, durable `AnswerDocument` plus Mica-owned highlight records. It does not scrape ChatGPT independently, accept provisional streaming output, create screenshot PDFs, upload answer content, or mutate the server conversation.

The browser fixture uses a local ChatGPT-derived answer containing prose, inline math, display math, a cross-page highlighted passage, a quote, and code. It proves the deterministic export, viewer, and selection behavior. It does not claim that an authenticated current ChatGPT conversation was exported; that remains part of the final HUMAN_ONLY current-site acceptance boundary.

## Chosen implementation

- `pdf-export-model.ts` serializes supported `AnswerDocument` blocks into one ordered print model. Unknown or opaque interactive blocks reject the export instead of being guessed.
- Highlight anchors resolve against the exact source version and span first, then by a unique quote plus prefix/suffix context. Ambiguous or missing anchors remain unresolved.
- Mathematical runs use visible TeX source as the print fallback. This preserves searchable and selectable text even when browser print cannot reproduce the original KaTeX or MathJax glyph tree faithfully.
- The export page is an extension-owned A4 print surface. Browser print creates the PDF with real text; no answer screenshot is used.
- The content script sends the model only after a trusted toolbar action. The service worker accepts only supported ChatGPT tabs, stores the model in `chrome.storage.session`, opens one extension export page, and deletes the model on first read or any failed tab-open path.
- The generated document is local-only. There is no server upload, persistent conversation copy, request interception, or reusable export token.

## Confirmed behavior

- The actual generated PDF is A4, tagged, contains no JavaScript, and spans two pages in the cross-page fixture.
- PDF.js renders a real text layer. Trusted pointer events select `Before x+1 after` continuously across prose, inline mathematics, and prose.
- Display mathematics `E=mc^2` remains selectable.
- `pdfplumber` independently extracts both `Before x+1 after` and `E=mc^2` from the same PDF.
- Yellow cross-math and mint cross-page highlights survive into the print model and rendered PDF.
- The background fixture rejects unsupported origins and forged consumers, enforces one-time consumption, and proves failed page creation removes the temporary payload.
- Five distinct visual artifacts bind the preview, two rendered pages, pointer selection, and display-math selection to the acceptance record.

## Rejected alternatives

- Screenshot PDF: rejected because it cannot satisfy selectable/searchable text or continuous math selection.
- Independent DOM scraping in the PDF feature: rejected because `ChatGPTAdapter` must remain the sole `AnswerDocument` producer.
- Exporting streaming snapshots: rejected because their content identity is provisional.
- Reconstructing complex mathematics as images: rejected because that breaks the text-layer gate.
- Guessing unsupported rich/interactive blocks: rejected because it can misrepresent hidden state or security-sensitive UI.

## Verification artifacts

- `output/pdf/mica-answer-export-sample.pdf`
- `results/mica-product-system-rebuild/pdf-evidence/pdf-export-fixture.json`
- `results/mica-product-system-rebuild/pdf-evidence/pdf-background.json`
- `results/mica-product-system-rebuild/pdf-evidence/pdf-render-1.png`
- `results/mica-product-system-rebuild/pdf-evidence/pdf-render-2.png`
- `results/mica-product-system-rebuild/pdf-evidence/pdfjs-pointer-selection.png`
- `results/mica-product-system-rebuild/pdf-evidence/pdfjs-display-math-selection.png`

The final Milestone B verdict remains candidate-bound and must be produced by acceptance validator 1.5.0 plus the same independent reviewer. The focused evidence currently supports:

```text
PDF_TEXT_SEARCH_SELECT=PASS
WEB_HIGHLIGHT_CROSS_MATH_TO_PDF=PASS
ACTUAL_PDF_VIEWER_REVIEW=PENDING_INDEPENDENT_REVIEW
```
