"""Rights and provenance checks. Missing values are rejected, never filled in."""

from __future__ import annotations

RIGHTS_BASIS = ("isibuko-owned", "commercially-licensed")


def _text(value) -> str:
    return str(value or "").strip()


def _rights(row: dict) -> dict:
    nested = row.get("rights")
    return nested if isinstance(nested, dict) else {}


def record_kind(row: dict) -> str:
    rights = _rights(row)
    return str(rights.get("recordKind") or row.get("recordKind") or "")


def rights_problems(row: dict) -> list[str]:
    rights = _rights(row)
    consent = row.get("consent") if isinstance(row.get("consent"), dict) else {}
    provenance = row.get("provenance") if isinstance(row.get("provenance"), dict) else {}
    reasons: list[str] = []
    basis = rights.get("rightsBasis", row.get("licence"))
    if basis not in RIGHTS_BASIS:
        reasons.append("Licence is not isibuko-owned or commercially-licensed.")
    if not _text(rights.get("rightsHolder") or row.get("rightsHolder")):
        reasons.append("A rights holder is missing.")
    if not _text(rights.get("agreementReference") or row.get("agreementReference")):
        reasons.append("A licence or agreement reference is missing.")
    scope = rights.get("agreementScope", row.get("agreementScope"))
    if scope == "product-use":
        reasons.append("A product-use licence is not an AI-training licence.")
    elif scope != "ai-training":
        reasons.append("The agreement scope must say ai-training. It was not assumed.")
    if "commercialTraining" in rights:
        commercial = rights.get("commercialTraining")
    elif "commercialTraining" in row:
        commercial = row.get("commercialTraining")
    else:
        commercial = None
    if commercial is None:
        reasons.append("Commercial training permission is missing. A product-use or commercial-use flag is not an AI-training grant.")
    elif commercial is not True:
        reasons.append("Commercial training is not permitted.")
    consent_id = _text(rights.get("consentId") or consent.get("consentId"))
    if not consent_id:
        reasons.append("A consent record id is missing.")
    allows_training = rights.get("allowsTraining", consent.get("allowsTraining") if "allowsTraining" in consent else None)
    if allows_training is not True:
        reasons.append("Training consent is missing or not granted.")
    if "allowsPersonImagery" in rights:
        person = rights.get("allowsPersonImagery")
    elif "allowsPersonImagery" in consent:
        person = consent.get("allowsPersonImagery")
    else:
        person = None
    if person is not True and person is not False:
        reasons.append("Person-imagery permission is missing. Garment permission does not include it.")
    consent_basis = consent.get("rights")
    if consent_basis and basis in RIGHTS_BASIS and consent_basis != basis:
        reasons.append("Consent rights do not match the licence.")
    if allows_training is True and commercial is False:
        reasons.append("Training consent contradicts the commercial-training permission.")
    source = _text(rights.get("source") or provenance.get("source"))
    acquired = _text(rights.get("acquired") or provenance.get("acquired"))
    method = _text(rights.get("method") or provenance.get("method"))
    if not source or not acquired:
        reasons.append("Provenance needs a source and an acquired date.")
    if not method:
        reasons.append("The acquisition method is missing.")
    merchant = _text(rights.get("merchant") or row.get("merchantName"))
    if not merchant:
        reasons.append("The merchant is missing.")
    if record_kind(row) not in ("synthetic-fixture", "real"):
        reasons.append("The record must say whether it is a synthetic fixture or a real sample.")
    return reasons


def admission_status(row: dict) -> dict:
    from dataset_gate import problems

    gaps = rights_problems(row)
    structural = [reason for reason in problems(row) if reason not in gaps]
    kind = record_kind(row)
    reviewer = _text(row.get("reviewer"))
    annotator = _text(row.get("annotator"))
    untouched = not _text(row.get("sku")) and not row.get("category") and row.get("licence") in (None, "", "unreviewed") and not _text(_rights(row).get("rightsBasis"))
    if untouched:
        return {"status": "draft", "label": "Draft", "reasons": ["Nothing has been recorded yet."]}
    if gaps:
        return {"status": "rights-incomplete", "label": "Rights incomplete", "reasons": gaps}
    if structural:
        return {"status": "rejected", "label": "Rejected", "reasons": structural}
    if kind == "synthetic-fixture":
        return {"status": "rejected", "label": "Rejected", "reasons": ["Synthetic fixture cannot enter a training run."]}
    if not reviewer:
        return {"status": "awaiting-independent-review", "label": "Awaiting independent review", "reasons": ["An independent reviewer has not been named."]}
    if reviewer == annotator:
        return {"status": "rejected", "label": "Rejected", "reasons": ["The reviewer must be a different person from the annotator."]}
    if row.get("admitted") is True and row.get("review") == "approved":
        return {"status": "admitted", "label": "Admitted", "reasons": []}
    if row.get("review") == "approved":
        return {"status": "eligible-for-admission", "label": "Eligible for admission", "reasons": ["An independent reviewer approved the row. Admission has not been recorded."]}
    return {
        "status": "awaiting-independent-review",
        "label": "Awaiting independent review",
        "reasons": ["The form is complete. It is not approved and it is not admitted."],
    }
