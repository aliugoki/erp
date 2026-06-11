"""Invoice extraction tests (Chunk 6.4). Pure parser on known text + the real pdfplumber path on the
committed sample PDF fixture (deterministic — PDFs carry an exact text layer, no OCR uncertainty).
The embedding/search path is covered by ml-search-e2e.sh (it needs the baked model).
"""
from __future__ import annotations

from pathlib import Path

from app.ocr import extract_invoice, parse_invoice

FIXTURE = Path(__file__).parent / "fixtures" / "sample_invoice.pdf"

SAMPLE_TEXT = """ACME SUPPLIES LTD
Invoice #INV-2026-001
Date: 2026-03-15
Description Qty Price
Widget A 2 1000.00
Gadget B 5 500.00
Subtotal: 4500.00
Tax: 450.00
Total: 4950.00"""


def test_parse_fields():
    r = parse_invoice(SAMPLE_TEXT)
    assert r.vendor == "ACME SUPPLIES LTD"
    assert r.date == "2026-03-15"
    assert r.total == 4950.00  # grand total, not the 4500 subtotal
    assert r.taxAmount == 450.00


def test_parse_line_items():
    r = parse_invoice(SAMPLE_TEXT)
    assert len(r.lineItems) == 2
    assert r.lineItems[0].description == "Widget A"
    assert r.lineItems[0].quantity == 2
    assert r.lineItems[0].unitPrice == 1000.00
    assert r.lineItems[1].description == "Gadget B"
    assert r.lineItems[1].quantity == 5


def test_extract_from_pdf_fixture():
    data = FIXTURE.read_bytes()
    r = extract_invoice(data, "application/pdf", "sample_invoice.pdf")
    assert r.vendor == "ACME SUPPLIES LTD"
    assert r.total == 4950.00
    assert r.taxAmount == 450.00
    assert len(r.lineItems) == 2
