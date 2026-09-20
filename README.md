# BhoomiLens

**AI-Powered Land Record Digitization, Validation & Verification Platform**

> Traditional OCR only digitizes a document. BhoomiLens goes one step further: it extracts land information, checks its consistency against reference records, identifies uncertainty, routes suspicious records to human reviewers, and guides the user toward official-source verification.

---
## 🚀 Live Demo
https://bhoomi-lens-omega.vercel.app

**Demo Credentials**
- Username: `demo@bhoomilens.local`
- Password: `BhoomiLens@Demo2026!`

## What BhoomiLens is (and is not)

BhoomiLens is a **hackathon MVP** for the AWS Bharat Builds Tour / First Commit hackathon. It is a serious AWS-native prototype that separates four concerns most "land record AI" demos conflate:

1. **Information extraction** — OCR + structured field extraction
2. **Consistency / validation** — deterministic checks against a reference registry
3. **Document-integrity signals** — hash, duplicate, metadata (best-effort)
4. **Official-source verification** — a link to the correct state land-record portal for the final human verification step

**BhoomiLens does not claim a document is authentic.** It reports whether the extracted data is *consistent* with a reference dataset, and hands off to a human reviewer + the official portal for final verification.

---

## Architecture (high level)

```
User (browser)
   └── AWS Amplify (Next.js)
         └── Amazon Cognito ── auth ──▶ API Gateway
                                          │
                                          ├── Upload Lambda ──▶ S3 (documents)
                                          │                       │
                                          │                       └── EventBridge
                                          │                             │
                                          │                             ▼
                                          │                       Step Functions
                                          │                             │
                                          │       ┌─────────────────────┼───────────────────────┐
                                          │       ▼                     ▼                       ▼
                                          │   OCR Worker         Bedrock Extract         Validation Lambda
                                          │   (Lambda / ECR)      (Claude)                (deterministic rules)
                                          │       │                     │                       │
                                          │       └─────────────────────┴────── DynamoDB ◀──────┘
                                          │
                                          ├── Records / Review Lambda ──▶ DynamoDB
                                          └── Dashboard Lambda ──▶ DynamoDB
```

See **`docs/ARCHITECTURE.md`** for the detailed diagram, service breakdown, and IAM boundaries.

---

## Repository layout

```
bhoomilens/
├── README.md                       ← you are here
├── .gitignore
├── docs/                           ← architecture, plans, decisions
│   ├── ARCHITECTURE.md
│   ├── PLAN.md
│   ├── BEDROCK_MODEL_SELECTION.md
│   ├── VALIDATION_RULES.md
│   ├── API.md
│   ├── COST.md
│   └── DEMO_SCRIPT.md
├── infrastructure/                 ← AWS CDK (TypeScript)  [next batch]
├── backend/
│   ├── lambdas/
│   │   ├── validation/handler.py
│   │   ├── upload/handler.py        [next batch]
│   │   ├── extraction/handler.py    [next batch]
│   │   ├── review/handler.py        [next batch]
│   │   └── dashboard/handler.py     [next batch]
│   ├── shared/
│   │   ├── models.py                (dataclasses / schema)
│   │   ├── normalization.py         (units, whitespace, unicode)
│   │   ├── validators.py            (deterministic rules)
│   │   └── confidence.py            (weighted risk score)
│   └── requirements.txt
├── ocr/                            ← Docker OCR worker  [next batch]
├── prompts/
│   └── extraction_prompt.txt
├── data/
│   ├── reference_registry.json     (SYNTHETIC — clearly labeled)
│   ├── test_scenarios.json         (ground truth for evaluation)
│   └── state_portals.json          (state → official public portal URL)
├── scripts/                        [next batch]
│   ├── seed_reference_data.py
│   ├── evaluate.py
│   └── deploy.sh
├── frontend/                       ← Next.js  [next batch]
└── tests/
    ├── test_validation.py
    └── test_normalization.py
```

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| AWS account | active | services below |
| AWS CLI | v2.x | `aws configure` — access key + region |
| Node.js | 20.x LTS | Frontend + CDK |
| Python | 3.12 | Lambda + validation + tests |
| Docker Desktop | latest | OCR worker container build |
| AWS CDK | 2.x | `npm i -g aws-cdk` |
| Amplify CLI | latest | `npm i -g @aws-amplify/cli` (only if not using Amplify Hosting via CDK) |
| jq | any | reference-data seeding |

**Region:** default to `ap-south-1` (Mumbai) — India-focused workload, Bedrock availability must be verified (see `docs/BEDROCK_MODEL_SELECTION.md`).

**Bedrock model access:** you must enable model access in the Bedrock console **before** deploying. Steps below.

---

## First-time configuration

### 1. Clone and install

```bash
git clone <your-repo-url> bhoomilens
cd bhoomilens

# Backend
cd backend && python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
cd ..

# Infrastructure (added in next batch)
cd infrastructure && npm install && cd ..

# Frontend (added in next batch)
cd frontend && npm install && cd ..
```

### 2. Configure AWS credentials

```bash
aws configure
# AWS Access Key ID:      <your key>
# AWS Secret Access Key:  <your secret>
# Default region name:    ap-south-1
# Default output format:  json
```

Verify:

```bash
aws sts get-caller-identity
```

### 3. Enable Bedrock model access

Bedrock models are **opt-in per account per region**. Before deploy:

1. Open the AWS Console → Amazon Bedrock → *Model access*
2. Choose the region you deploy to (start with `ap-south-1`; fall back to `us-east-1` if the required models are unavailable there — see `docs/BEDROCK_MODEL_SELECTION.md`)
3. Request access for the models chosen in `docs/BEDROCK_MODEL_SELECTION.md` (typically Anthropic Claude Haiku + Sonnet)
4. Wait for `Access granted` status (usually seconds; occasionally hours)
5. Verify from CLI:

   ```bash
   aws bedrock list-foundation-models \
     --region ap-south-1 \
     --by-inference-type ON_DEMAND \
     --query "modelSummaries[?providerName=='Anthropic'].[modelId,modelLifecycle.status]" \
     --output table
   ```

   Only models with `ACTIVE` status may be used. Do **not** hardcode a `LEGACY` model.

### 4. Environment variables

Copy the template and fill in values after your first CDK deploy (values become available then):

```bash
cp .env.example .env
```

`.env` (example — do not commit real values):

```bash
# --- AWS ---
AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=123456789012

# --- Resources (populated after `cdk deploy`) ---
DOCUMENTS_BUCKET=bhoomilens-documents-<account-id>-<region>
RECORDS_TABLE=bhoomilens-records
AUDIT_TABLE=bhoomilens-audit
REFERENCE_TABLE=bhoomilens-reference
API_ENDPOINT=https://xxxx.execute-api.ap-south-1.amazonaws.com/prod
COGNITO_USER_POOL_ID=ap-south-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_IDENTITY_POOL_ID=ap-south-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# --- Bedrock (verify ACTIVE at deploy time) ---
BEDROCK_MODEL_ID_PRIMARY=<verified-active-model-id>
BEDROCK_MODEL_ID_FALLBACK=<verified-active-model-id>
BEDROCK_REGION=ap-south-1

# --- OCR ---
OCR_MODE=paddleocr         # options: paddleocr | tesseract | textract-english-only
OCR_LANGUAGES=hi,en

# --- Confidence policy (Section 12) ---
CONFIDENCE_WEIGHT_OCR=0.40
CONFIDENCE_WEIGHT_EXTRACTION=0.30
CONFIDENCE_WEIGHT_VALIDATION=0.30
THRESHOLD_AUTO_APPROVE=90
THRESHOLD_NEEDS_REVIEW=70
```

`.env` is git-ignored. Never commit real credentials.

### 5. Seed the reference registry

```bash
python scripts/seed_reference_data.py --file data/reference_registry.json --table $REFERENCE_TABLE --region $AWS_REGION
```

This uploads ~100–500 **synthetic** records to DynamoDB. The records are clearly flagged `"source": "SYNTHETIC_DEMO"`.

---

## Deployment

> The CDK stacks land in the next batch. This section documents the intended commands so you can wire them up as soon as `infrastructure/` exists.

```bash
# 1. Bootstrap CDK (once per account+region)
cd infrastructure
npx cdk bootstrap aws://$AWS_ACCOUNT_ID/$AWS_REGION

# 2. Deploy in order (stacks are decomposed)
npx cdk deploy BhoomiLens-Storage     # S3, DynamoDB tables, ECR repo
npx cdk deploy BhoomiLens-Auth        # Cognito user pool + client + identity pool
npx cdk deploy BhoomiLens-Workflow    # Step Functions + EventBridge rule + OCR Lambda + Validation Lambda + Extraction Lambda
npx cdk deploy BhoomiLens-Api         # API Gateway + REST Lambdas (upload/review/dashboard/audit)
npx cdk deploy BhoomiLens-Frontend    # Amplify Hosting

# 3. Push OCR container to ECR (first time)
cd ../ocr
./build_and_push.sh

# 4. Seed reference data
cd ..
python scripts/seed_reference_data.py --table bhoomilens-reference

# 5. Create the first reviewer user in Cognito
aws cognito-idp admin-create-user \
  --user-pool-id $COGNITO_USER_POOL_ID \
  --username reviewer@example.com \
  --user-attributes Name=email,Value=reviewer@example.com Name=email_verified,Value=true \
  --temporary-password 'ChangeMe!2026'
```

Outputs from `cdk deploy` — API endpoint, user pool ID, client ID, bucket name — must be copied into `.env` and `frontend/.env.local`.

---

## Local development

**Backend — run one Lambda handler locally:**

```bash
cd backend
python -m pytest tests/ -v
python -m backend.lambdas.validation.handler   # if you wire up a __main__ block for local invoke
```

**Frontend — run Next.js dev server:**

```bash
cd frontend
cp .env.example .env.local     # fill in Cognito + API values
npm run dev                    # http://localhost:3000
```

Log in as the reviewer user you created above. First login prompts for a permanent password.

---

## Testing

```bash
# Unit tests for validation + normalization + confidence
python -m pytest tests/ -v

# Offline evaluation of the validation engine against ground-truth scenarios
python scripts/evaluate.py
```

Current measured results (recorded from this repo, `python scripts/evaluate.py`):

```
Scenarios:       15
Flag accuracy:   15/15  (100.0%)
Status accuracy: 15/15  (100.0%)
```

Unit tests: **66/66 passing**. The evaluation harness above exercises the
deterministic validation engine against 15 ground-truth scenarios in
`data/test_scenarios.json` — from a clean English record to Hindi records,
duplicate Khasras, bigha/katha unit conversion, and reviewer-correction flows.

**Only real measured numbers are reported here and on the dashboard.**
End-to-end accuracy of OCR + Bedrock extraction can only be measured once
the AWS stack is deployed and the pipeline runs against real documents.

---

## Data honesty

- Reference registry (`data/reference_registry.json`) is **synthetic**. Every record contains `"source": "SYNTHETIC_DEMO"` and never claims to represent a real citizen.
- State portal mapping (`data/state_portals.json`) contains **public government URLs** for manual verification. BhoomiLens does not scrape, bypass CAPTCHA, or automate government portal logins.
- No DILRMP integration.
- No claim of "document authentic" — only "data consistent" or "possible inconsistency, needs verification".

---

## Common operations

### Add a new state portal mapping

Edit `data/state_portals.json`, then either redeploy the config Lambda or push the file to S3 config prefix (see `docs/API.md`).

### Reset a stuck record

```bash
python scripts/requeue_record.py --record-id LR00117
```

### View a document's audit trail

```bash
aws dynamodb query \
  --table-name bhoomilens-audit \
  --key-condition-expression "record_id = :r" \
  --expression-attribute-values '{":r":{"S":"LR00117"}}' \
  --scan-index-forward false
```

---

## Costs

See `docs/COST.md`. Rough on-demand estimate for the hackathon demo footprint (~50 documents/day, 5 reviewers):

| Service | Est. monthly |
|---|---|
| Bedrock (Claude Haiku) | ~$1–3 |
| Lambda | ~$0 (free tier) |
| DynamoDB on-demand | ~$0 (free tier) |
| S3 | ~$0.10 |
| API Gateway | ~$0 (free tier) |
| Step Functions | ~$0 (free tier) |
| Amplify Hosting | ~$0.20 |
| ECR | ~$0.10 |
| **Total** | **< $5/month for the demo footprint** |

Set a **billing alarm at $20** before deploying (see `docs/COST.md`).

---

## Security

- Cognito for all API access
- S3 bucket private, `BlockPublicAcls=true`, presigned URLs for reads
- Least-privilege IAM per Lambda
- All secrets via env vars — no hardcoded credentials
- CloudWatch logs for every Lambda + Step Functions execution
- CORS restricted to Amplify domain

See `docs/ARCHITECTURE.md` for the full boundary review.

---

## Contributing / development strategy

Follow the phased build in `docs/PLAN.md`:

1. Deploy the minimal AWS skeleton (empty stacks, resources exist)
2. Get **one** document through S3 → EventBridge → Step Functions → OCR → Bedrock → DynamoDB
3. Implement validation
4. Implement review queue + correction + revalidation
5. Build the polished frontend
6. Add the official-source mapping
7. Test failure scenarios
8. Deploy and polish

Do not build features in parallel that depend on an untested architecture.

---

## Demo

See `docs/DEMO_SCRIPT.md` for the 3-minute demo flow. TL;DR:

1. Upload one deliberately-broken land record (area mismatch)
2. Watch Step Functions execute in the AWS Console
3. Record shows up in Review Queue with `NEEDS_REVIEW`
4. Reviewer opens side-by-side view, sees the flagged area
5. Reviewer corrects `5.2 hectare → 2.5 hectare`
6. Revalidation runs → status flips to `AUTO_APPROVED`
7. Audit trail shows the human correction
8. Click "Open Official Source" → correct state portal opens in a new tab

---

## Known limitations

- OCR quality on Hindi handwriting is imperfect — records fall back to `NEEDS_REVIEW` with low confidence
- No automatic government API lookup (out of scope; not authorized)
- No cadastral map overlay (P2)
- Only English + Hindi tested; other Indian languages best-effort
- Reference registry is synthetic; production would need authorized LRMS/DILRMP integration
- No cryptographic authenticity check unless the document already carries a signature/QR

---

## License

TBD by the team. Do not publish real citizen data under any circumstances.
