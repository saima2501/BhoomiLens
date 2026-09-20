"""Validation Lambda — invoked by Step Functions after Bedrock extraction.

Input event shape (from Step Functions):
{
  "record_id": "01HXY...",
  "document_id": "9b5c...",
  "extracted": { ... ExtractedRecord fields ... },
  "ocr_confidence": 0.92,
  "extraction_confidence": 0.88
}

Output shape (goes back into Step Functions Choice + persistence):
{
  "record_id": "...",
  "validation_status": "AUTO_APPROVED" | "NEEDS_REVIEW" | "HIGH_RISK",
  "overall_confidence": 92.4,
  "validation_score": 0.85,
  "validation_flags": [ ... ],
  "reference_matched": true,
  "reference_id": "REF-117-2-rampur"
}

The Lambda writes nothing to DynamoDB directly — persistence is the next
state in the Step Functions workflow (a separate Lambda with narrower IAM).
This keeps the validator pure and easy to reason about.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Iterable, Optional

import boto3
from boto3.dynamodb.conditions import Attr, Key

from backend.shared.confidence import (
    ConfidencePolicy,
    compute_overall_confidence,
    decide_status,
    policy_from_env,
)
from backend.shared.models import ExtractedRecord
from backend.shared.normalization import normalize_id, normalize_place
from backend.shared.validators import validate

logger = logging.getLogger()
logger.setLevel(logging.INFO)

_dynamodb = boto3.resource("dynamodb")
REFERENCE_TABLE = os.environ["REFERENCE_TABLE"]
RECORDS_TABLE = os.environ["RECORDS_TABLE"]


def _reference_lookup(khasra_norm: str, village_norm: str) -> Optional[dict]:
    """Look up the reference row by (khasra_number, village_norm)."""
    table = _dynamodb.Table(REFERENCE_TABLE)
    try:
        resp = table.get_item(Key={
            "khasra_number": khasra_norm,
            "village_norm": village_norm,
        })
    except Exception:
        logger.exception("Reference lookup failed for %s / %s", khasra_norm, village_norm)
        return None
    return resp.get("Item")


def _duplicate_lookup(
    khasra_norm: str,
    village_norm: str,
    exclude_record_id: Optional[str],
) -> Iterable[dict]:
    """Query GSI3 for approved records with the same Khasra+village.

    GSI3 partition key: validation_status. Sort key: updated_at.
    We query both AUTO_APPROVED and HUMAN_APPROVED partitions with a
    filter expression. For a 4-day MVP a bounded filter is fine; if this
    ever grows past ~1000 approved records per Khasra region we would
    move to a denormalized (khasra_village, updated_at) GSI.
    """
    table = _dynamodb.Table(RECORDS_TABLE)
    seen: list[dict] = []
    for status in ("AUTO_APPROVED", "HUMAN_APPROVED"):
        try:
            resp = table.query(
                IndexName="GSI3",
                KeyConditionExpression=Key("validation_status").eq(status),
                FilterExpression=(
                    Attr("khasra_number").eq(khasra_norm)
                    & Attr("village_norm").eq(village_norm)
                ),
                Limit=25,
            )
        except Exception:
            logger.exception("Duplicate lookup failed for %s / %s / %s",
                             khasra_norm, village_norm, status)
            continue
        for item in resp.get("Items", []):
            if exclude_record_id and item.get("record_id") == exclude_record_id:
                continue
            seen.append(item)
    return seen


def _coerce_float(x: Any) -> Optional[float]:
    if x is None:
        return None
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def handler(event: dict, _context) -> dict:
    logger.info("Validation event: %s", json.dumps(event, default=str)[:2000])

    # Step Functions stores the extraction Lambda output at $.extraction
    # (resultPath='$.extraction'), so the nested path is:
    #   event["extraction"]["extracted"], event["extraction"]["ocr_confidence"], …
    # We fall back to the top-level keys for direct invocations / test events.
    _extraction = event.get("extraction") or {}
    extracted_payload = (
        event.get("extracted")
        or _extraction.get("extracted")
        or {}
    )
    record = ExtractedRecord.from_dict(extracted_payload)
    ocr_confidence = _coerce_float(
        event.get("ocr_confidence") or _extraction.get("ocr_confidence")
    )
    extraction_confidence = _coerce_float(
        event.get("extraction_confidence") or _extraction.get("extraction_confidence")
    )
    record_id = event.get("record_id") or _extraction.get("record_id")

    policy: ConfidencePolicy = policy_from_env()

    # Normalize identifiers before storing so GSI queries are consistent.
    if record.khasra_number:
        record.khasra_number = normalize_id(record.khasra_number)

    result = validate(
        record,
        reference_lookup=_reference_lookup,
        duplicate_lookup=_duplicate_lookup,
        ocr_confidence=ocr_confidence,
        current_record_id=record_id,
    )

    overall = compute_overall_confidence(
        ocr_confidence=ocr_confidence,
        extraction_confidence=extraction_confidence,
        validation_score=result.validation_score,
        policy=policy,
    )
    status = decide_status(
        overall_confidence=overall,
        validation=result,
        policy=policy,
    )

    output = {
        "record_id": record_id,
        "document_id": event.get("document_id"),
        "validation_status": status,
        "overall_confidence": overall,
        "validation_score": result.validation_score,
        "validation_flags": [f.to_dict() for f in result.flags],
        "reference_matched": result.reference_matched,
        "reference_id": result.reference_id,
        "extracted": {
            **extracted_payload,
            "khasra_number": record.khasra_number,
            "village_norm": normalize_place(record.village) if record.village else None,
        },
        "ocr_confidence": ocr_confidence,
        "extraction_confidence": extraction_confidence,
    }
    logger.info(
        "Validated record_id=%s status=%s confidence=%.2f flags=%d",
        record_id, status, overall, len(result.flags),
    )
    return output
