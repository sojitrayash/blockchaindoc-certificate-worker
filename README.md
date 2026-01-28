# BlockchainDoc Certificate Worker

A flexible background worker service that processes document jobs by generating PDF certificates from HTML templates and implementing **LegitDoc blockchain verification**. Supports multiple deployment modes (polling service, SQS consumer, AWS Lambda) and storage backends (local filesystem, AWS S3).

## Overview

This worker processes document jobs through the following pipeline:
1. Receive job notification (database polling, SQS message, or Lambda trigger)
2. Fetch job's associated template and data from database
3. Render HTML template with provided data
4. Convert rendered HTML to PDF using html-pdf
5. **LegitDoc Phase 1**: Calculate SHA3-256 hash H(d), document fingerprint DI, and H(DI)
6. Store PDF using configured storage driver (local or S3)
7. Update database and wait for frontend to sign H(DI) with issuer's private key
8. **LegitDoc Phase 2**: Process signatures from frontend, calculate Merkle leaf L = H(SI)
9. **LegitDoc Phase 3**: Build batch Merkle tree and return MRI to frontend for blockchain anchoring

### LegitDoc Blockchain Integration

Implements the complete LegitDoc algorithm:
- **H(d) = SHA3-256(d)** - Document hash
- **DI = H(d) + Ed + Ei** - Document fingerprint with expiry timestamps
- **SI = S(H(DI))** - Issuer signature (frontend signing with private key)
- **L = H(SI)** - Merkle leaf value
- **MRI = MerkleRoot(L1...Ln)** - Batch intermediate Merkle root
- **MRU = MerkleRoot(MRI1...MRIk)** - Ultimate root (anchored on blockchain)

See [LegitDoc Implementation Walkthrough](./docs/legitdoc-walkthrough.md) for details.

### QR v2 (Self-contained Verification + Preview)

When `VERIFY_BASE_URL` is configured, the worker generates **QR v2** codes that open your verification page directly (phone camera/lens). For best compatibility with scanners/redirects, the payload is placed in a **query param**:

`https://your-verify-portal/verify?p=<compressed-payload>`

The verifier also supports the older fragment style:

`https://your-verify-portal/verify#<compressed-payload>`

If you want the QR to point to the site root (e.g. `http://localhost:8080/?p=...`) and have the web app redirect internally to `/verify`, set:

- `VERIFY_QR_BASE_URL=http://localhost:8080/`

Optional QR render tuning (to make QR less "dense" visually and easier to scan/print):
- `QR_STYLE` (default: `classic` for standalone PNGs, `transparent` for embedded PDFs) - preset style (`classic` | `dark`/`inverted`/`reference` | `transparent`)
- `QR_PNG_WIDTH` (default `768`) - generated QR image pixel width
- `QR_PDF_PNG_WIDTH` (default `1536`) - QR image pixel width used when embedding into PDFs
- `QR_MARGIN` (default `8`) - quiet zone around QR
- `QR_DARK_COLOR` (default `#000000`) and `QR_LIGHT_COLOR` (default `#ffffff`)

Notes:
- `QR_DARK_COLOR`/`QR_LIGHT_COLOR` override `QR_STYLE`.
- For transparent backgrounds use `QR_STYLE=transparent` (equivalent to `QR_LIGHT_COLOR=#00000000`).

Recommended for colored certificate backgrounds (yellow/gradient):
- Keep embedded PDF QR transparent: `QR_STYLE=transparent` (or `QR_LIGHT_COLOR=#00000000`)
- Use a larger quiet zone: `QR_MARGIN=8`

Clutter note:
- QR “density” mostly comes from payload size. The worker compacts Merkle proofs by removing unused `position` fields (keeps only sibling hashes) to reduce QR size.

Key points:
- The QR payload includes `v: 2`, `templateId`, a `templateHash` (keccak256 of template HTML), a `fields` snapshot (only keys from `template.parameters`), and `fieldsHash` (keccak256 of canonical JSON over `{ templateId, templateHash, fields }`).
- The verification portal should fetch **only the template** by `templateId` (allowed), validate `templateHash`, then regenerate the preview from `fields` (do **not** fetch certificate/job data from DB for preview).
- Existing on-chain / Merkle proof verification fields (`MRI/MRU`, `MPI/MPU`, `SI`, `txHash`, etc.) remain in the QR payload.

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   PostgreSQL    │◄────────│   SQS Queue     │ (optional)
│    Database     │         └────────┬────────┘
└────────┬────────┘                  │
         │                           │
         ▼                           ▼
┌────────────────────────────────────────┐
│         Certificate Worker             │
│  Modes: Polling | SQS Consumer | Lambda│
└────────┬───────────────────────────────┘
         │
         ├──► Template Rendering
         ├──► PDF Generation (html-pdf)
         ├──► LegitDoc Crypto (SHA3-256, DI, H(DI))
         ├──► Signature Processing (L = H(SI))
         ├──► Merkle Tree Building (MRI)
         ├──► Storage Driver (Local/S3)
         └──► Database Update
```

## Deployment Modes

### 1. Polling Mode (Default)
Continuously polls database for pending jobs.

**Best for:** Development, small-scale deployments, dedicated servers

**Configuration:**
```bash
WORKER_MODE=polling
STORAGE_DRIVER=local  # or s3
```

**Start:**
```bash
npm run start:polling
```

### 2. SQS Consumer Mode
Long-polls SQS queue for job messages and processes them.

**Best for:** Event-driven architectures, microservices, scalable deployments

**Configuration:**
```bash
WORKER_MODE=sqs
STORAGE_DRIVER=s3
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/account-id/queue-name
```

**SQS Message Format:**
```json
{
  "jobId": "uuid-of-job-to-process",
  "action": "generate_certificate"
}
```

**Start:**
```bash
npm run start:sqs
```

### 3. Lambda Function Mode
Serverless function triggered by SQS events.

**Best for:** AWS-native deployments, auto-scaling, pay-per-use

**Configuration:** See [serverless.yml](file:///Users/bhaskar/projects/blockchaindoc-certificate-worker/serverless.yml)

**Deploy:**
```bash
npm run deploy:lambda
```

## Storage Drivers

### Local Filesystem
Stores PDFs in local directory structure.

**Configuration:**
```bash
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=./storage  # Default
```

**Folder Structure:**
```
storage/
└── certificates/
    └── {tenantId}/
        └── {batchId}/
            └── {jobId}.pdf
```

**Test:**
```bash
npm run test:local-storage
```

### AWS S3
Uploads PDFs to S3 bucket with encryption.

**Configuration:**
```bash
STORAGE_DRIVER=s3
S3_BUCKET_NAME=your-bucket-name
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=us-east-1
```

**S3 Structure:**
```
s3://bucket-name/
└── certificates/
    └── {tenantId}/
        └── {batchId}/
            └── {jobId}.pdf
```

**Test:**
```bash
npm run test:s3-storage
```

## Installation

1. **Clone and navigate:**
   ```bash
   cd blockchaindoc-certificate-worker
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and set your configuration (see [Configuration](#configuration))

## Usage

### Development - Polling Mode (Local Storage)

```bash
# Set environment
WORKER_MODE=polling
STORAGE_DRIVER=local

# Run
npm run dev:polling
```

### Development - SQS Mode (S3 Storage)

```bash
# Set environment
WORKER_MODE=sqs
STORAGE_DRIVER=s3
SQS_QUEUE_URL=your-queue-url

# Run
npm run dev:sqs
```

### Production - Lambda Deployment

```bash
# Deploy to AWS Lambda
npm run deploy:lambda

# Remove from AWS
npm run remove:lambda
```

## Configuration

### Environment Variables

| Variable | Description | Default | Required For |
|----------|-------------|---------|--------------|
| `NODE_ENV` | Environment | `development` | All |
| `WORKER_MODE` | Deployment mode | `polling` | All |
| `STORAGE_DRIVER` | Storage backend | `local` | All |
| **Database** ||||
| `DB_HOST` | PostgreSQL host | `localhost` | All |
| `DB_PORT` | PostgreSQL port | `5432` | All |
| `DB_NAME` | Database name | - | All |
| `DB_USER` | Database user | - | All |
| `DB_PASSWORD` | Database password | - | All |
| **AWS (S3/SQS)** ||||
| `AWS_ACCESS_KEY_ID` | AWS access key | - | S3, SQS, Lambda |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | - | S3, SQS, Lambda |
| `AWS_REGION` | AWS region | `us-east-1` | S3, SQS, Lambda |
| **S3 Storage** ||||
| `S3_BUCKET_NAME` | S3 bucket | - | S3 driver |
| **Local Storage** ||||
| `STORAGE_LOCAL_PATH` | Local storage path | `./storage` | Local driver |
| **SQS** ||||
| `SQS_QUEUE_URL` | SQS queue URL | - | SQS mode, Lambda |
| `SQS_MAX_MESSAGES` | Messages per poll | `1` | SQS mode |
| `SQS_WAIT_TIME_SECONDS` | Long poll duration | `20` | SQS mode |
| `SQS_VISIBILITY_TIMEOUT` | Message visibility | `300` | SQS mode |
| **Polling** ||||
| `WORKER_POLL_INTERVAL` | Poll interval (ms) | `10000` | Polling mode |
| `WORKER_CONCURRENT_JOBS` | Concurrent jobs | `5` | Polling mode |
| **Logging** ||||
| `LOG_LEVEL` | Log level | `info` | All |

## Lambda Deployment Guide

### Prerequisites

1. Install Serverless Framework:
   ```bash
   npm install -g serverless
   ```

2. Configure AWS credentials:
   ```bash
   aws configure
   ```

### Deployment

1. **Update serverless.yml**
   - Set environment variables
   - Configure VPC if database is in VPC
   - Adjust resource limits (memory, timeout)

2. **Deploy:**
   ```bash
   npm run deploy:lambda
   ```

3. **Verify:**
   - Check Lambda function in AWS Console
   - Verify SQS trigger is connected
   - Check CloudWatch logs

4. **Send test message:**
   ```bash
   aws sqs send-message \
     --queue-url YOUR_QUEUE_URL \
     --message-body '{"jobId":"test-job-id"}'
   ```

5. **Monitor:**
   - CloudWatch Logs for execution logs
   - SQS queue for failed messages
   - DLQ for permanently failed messages

### Cleanup

```bash
npm run remove:lambda
```

## Troubleshooting

### Worker not processing jobs (Polling Mode)

1. Check database connection
2. Verify jobs with `status='Pending'` exist
3. Check logs: `logs/error.log`

### Worker not processing messages (SQS Mode)

1. Verify `SQS_QUEUE_URL` is correct
2. Check AWS credentials and permissions
3. Test SQS queue accessibility
4 Verify message format matches expected structure

### PDF generation fails

1. Ensure html-pdf dependencies are installed
2. Check memory limits
3. Verify HTML template is valid

### Storage errors

**Local:**
- Check write permissions for `STORAGE_LOCAL_PATH`
- Ensure disk space available

**S3:**
- Verify AWS credentials
- Check bucket exists and is accessible
- Ensure IAM permissions include `s3:PutObject`
- Verify AWS region matches bucket region

### Lambda issues

1. **Cold start timeouts:**
   - Increase Lambda timeout in serverless.yml
   - Consider provisioned concurrency

2. **Database connection errors:**
   - Ensure Lambda is in same VPC as database
   - Check security groups allow database access

3. **Memory errors:**
   - Increase `memorySize` in serverless.yml
   - Monitor CloudWatch metrics

## Testing

```bash
# Test PDF generation
npm run test:pdf

# Test hash calculation
npm run test:hash

# Test local storage
npm run test:local-storage

# Test S3 storage (requires AWS credentials)
npm run test:s3-storage
```

## Project Structure

```
src/
├── config/
│   └── database.js              # Database connection
├── models/
│   ├── DocumentJob.js           # Job model
│   ├── DocumentTemplate.js      # Template model
│   ├── DocumentBatch.js         # Batch model
│   └── Tenant.js                # Tenant model
├── services/
│   ├── jobService.js            # Job database operations
│   ├── templateService.js       # Template rendering
│   ├── pdfService.js            # PDF generation
│   └── sqsService.js            # SQS integration
├── storage/
│   ├── StorageInterface.js      # Storage base class
│   ├── LocalStorage.js          # Local filesystem driver
│   ├── S3Storage.js             # AWS S3 driver
│   └── StorageFactory.js        # Driver factory
├── utils/
│   ├── logger.js                # Winston logger
│   └── hashCalculator.js        # SHA-256 hashing
├── tests/
│   ├── test-pdf-generation.js   # PDF test
│   ├── test-hash.js             # Hash test
│   ├── test-local-storage.js    # Local storage test
│   └── test-s3-storage.js       # S3 storage test
├── worker.js                    # Main worker logic
├── lambda.js                    # Lambda handler
└── index.js                     # Entry point
```

## License

ISC
