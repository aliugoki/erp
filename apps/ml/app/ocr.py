"""Invoice extraction (Chunk 6.4).

`extract_invoice(data, content_type)` pulls text from the upload — pdfplumber for PDFs (uses the
embedded text layer, exact), pytesseract for scanned images — then parses common invoice fields with
robust regexes. This is a heuristic extractor for typical line-item invoices, not a trained document
model; it targets the contract shape {vendor, date, lineItems[], total, taxAmount}. Unrecognised
fields come back null/empty rather than guessed.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field

_AMOUNT = r"([\d][\d,]*\.\d{2})"
_DATE = re.compile(r"(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})")
_TOTAL = re.compile(r"(?<!sub)total\s*:?\s*\$?\s*" + _AMOUNT, re.IGNORECASE)
_TAX = re.compile(r"(?:tax|vat)\s*:?\s*\$?\s*" + _AMOUNT, re.IGNORECASE)
_LINE_ITEM = re.compile(r"^(?P<desc>.+?)\s+(?P<qty>\d+)\s+\$?" + _AMOUNT + r"\s*$")


@dataclass
class LineItem:
    description: str
    quantity: int
    unitPrice: float


@dataclass
class InvoiceExtract:
    vendor: str | None = None
    date: str | None = None
    total: float | None = None
    taxAmount: float | None = None
    lineItems: list[LineItem] = field(default_factory=list)


def _to_float(s: str) -> float:
    return float(s.replace(",", ""))


def extract_text(data: bytes, content_type: str | None, filename: str | None = None) -> str:
    is_pdf = (content_type or "").endswith("pdf") or (filename or "").lower().endswith(".pdf")
    if is_pdf:
        import pdfplumber

        with pdfplumber.open(io.BytesIO(data)) as pdf:
            return "\n".join((page.extract_text() or "") for page in pdf.pages)
    # Image → OCR.
    import pytesseract
    from PIL import Image

    return pytesseract.image_to_string(Image.open(io.BytesIO(data)))


def parse_invoice(text: str) -> InvoiceExtract:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    result = InvoiceExtract()

    if lines:
        result.vendor = lines[0]

    date_match = _DATE.search(text)
    if date_match:
        result.date = date_match.group(1)

    totals = _TOTAL.findall(text)
    if totals:
        result.total = _to_float(totals[-1])  # the grand total (last 'total', excluding 'subtotal')
    tax = _TAX.search(text)
    if tax:
        result.taxAmount = _to_float(tax.group(1))

    for ln in lines:
        m = _LINE_ITEM.match(ln)
        if m and not re.search(r"(?:sub)?total|tax|vat", ln, re.IGNORECASE):
            result.lineItems.append(
                LineItem(description=m.group("desc").strip(), quantity=int(m.group("qty")), unitPrice=_to_float(m.group(3)))
            )
    return result


def extract_invoice(data: bytes, content_type: str | None, filename: str | None = None) -> InvoiceExtract:
    return parse_invoice(extract_text(data, content_type, filename))
